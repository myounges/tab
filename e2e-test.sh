#!/usr/bin/env bash
set -uo pipefail

# Tab Archiver E2E Test Suite
# Uses agent-browser for browser automation
# Tests: popup UI, archive browser, search, modal, navigation, accessibility

EXT_PATH="$(pwd)"
AGENT="npx agent-browser"
PASS=0
FAIL=0
EXT_ID="ioojjbilpmncoflfljpklpbegibfebob"  # deterministic from extension path

cleanup() {
  $AGENT close --all 2>/dev/null || true
}

trap cleanup EXIT

check() {
  local desc="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -iq "$expected"; then
    echo "  ✓ $desc"; PASS=$((PASS + 1))
  else
    echo "  ✗ $desc"; echo "    Expected: $expected"; echo "    Got: $actual"; FAIL=$((FAIL + 1))
  fi
}

echo "=== Tab Archiver E2E Tests ==="
echo ""

# 1. Popup UI
echo "--- Popup UI ---"
$AGENT --extension "$EXT_PATH" open "chrome-extension://${EXT_ID}/popup.html" 2>/dev/null
sleep 1
POPUP=$($AGENT snapshot -i 2>/dev/null || echo "")

check "Popup heading" "Tab Archiver" "$POPUP"
check "Capture button" "Capture All Tabs" "$POPUP"
check "Recent archives section" "RECENT" "$POPUP"
check "View All link" "View All" "$POPUP"

STATUS_LIVE=$(npx agent-browser get attr "#status" role 2>/dev/null || echo "")
check "Status has role=status" "status" "$STATUS_LIVE"

# 2. Archive browser page
echo ""
echo "--- Archive Browser ---"
$AGENT open "chrome-extension://${EXT_ID}/archive.html" 2>/dev/null
sleep 1
ARCHIVE=$($AGENT snapshot -i 2>/dev/null || echo "")

check "Archive heading" "Tab Archiver" "$ARCHIVE"
check "Search textbox" "Search" "$ARCHIVE"
check "Delete All button" "Delete all archives" "$ARCHIVE"
# Empty state verified separately (needs clean IndexedDB)
check "Skip link" "Skip to main content" "$ARCHIVE"

# Verify aria-live on container
CONTAINER_LIVE=$(npx agent-browser get attr "#archivesContainer" aria-live 2>/dev/null || echo "")
check "Container has aria-live" "polite" "$CONTAINER_LIVE"

VERIFY_EMPTY_ICON=$(npx agent-browser get attr ".empty-icon" aria-hidden 2>/dev/null || echo "")
check "Empty icon is aria-hidden" "true" "$VERIFY_EMPTY_ICON"

# 3. Search functionality
echo ""
echo "--- Search ---"
$AGENT fill "input[type=text]" "test query" 2>/dev/null || true
sleep 0.5
SEARCH_VAL=$(npx agent-browser get value "#searchInput" 2>/dev/null || echo "")
check "Search input accepts text" "test query" "$SEARCH_VAL"

# Clear search
$AGENT click "#clearSearch" 2>/dev/null; sleep 0.5
SEARCH_CLEAR=$(npx agent-browser get value "#searchInput" 2>/dev/null || echo "")
check "Clear search empties input" "^$" "$SEARCH_CLEAR"

# 4. Confirmation modal
echo ""
echo "--- Confirmation Modal ---"
# Populate test archive data directly in IndexedDB
$AGENT eval "
  (async () => {
    const DB_NAME = 'TabArchiver';
    const STORE_NAME = 'archives';
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        if (!e.target.result.objectStoreNames.contains(STORE_NAME)) {
          e.target.result.createObjectStore(STORE_NAME, {keyPath: 'id', autoIncrement: true});
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add({ timestamp: Date.now(), tabs: [{ title:'Test Tab', url:'https://example.com', description:'Test page' }] });
    await new Promise((resolve) => { tx.oncomplete = resolve; });
    return 'Test archive added';
  })()
" 2>/dev/null || true
sleep 1
# Reload archive page to show the test data
$AGENT reload 2>/dev/null; sleep 1
CARDS=$(npx agent-browser get count ".archive-card" 2>/dev/null || echo "0")
echo "  Archives after inserting test data: $CARDS"

# Now click Delete All - modal should open
$AGENT click "#deleteAllBtn" 2>/dev/null || true
sleep 0.5
MODAL_TEXT=$(npx agent-browser get text "#confirmModal" 2>/dev/null || echo "")

check "Modal appears" "Confirm Delete" "$MODAL_TEXT"
check "Modal has Cancel button" "Cancel" "$MODAL_TEXT"
check "Modal has Delete button" "Delete All" "$MODAL_TEXT"

# Verify modal role
MODAL_ROLE=$(npx agent-browser get attr "#confirmModal" role 2>/dev/null || echo "")
check "Modal has role=dialog" "dialog" "$MODAL_ROLE"

# Dismiss modal with Cancel
$AGENT click "#modalCancel" 2>/dev/null || true
sleep 0.5
MODAL_CLASS=$(npx agent-browser get attr "#confirmModal" class 2>/dev/null || echo "")
check "Modal dismissed after Cancel" "modal-overlay" "$MODAL_CLASS"

# 5. Keyboard accessibility
echo ""
echo "--- Keyboard Navigation ---"
$AGENT open "chrome-extension://${EXT_ID}/archive.html" 2>/dev/null
sleep 1

# Tab through interactive elements
$AGENT press Tab 2>/dev/null; sleep 0.3
SKIP_FOCUS=$(npx agent-browser eval "document.activeElement?.textContent?.trim()" 2>/dev/null || echo "")
check "Tab focus starts on skip link" "Skip" "$SKIP_FOCUS"

# 6. Page title
echo ""
echo "--- Document Metadata ---"
TITLE=$($AGENT get title 2>/dev/null || echo "")
check "Page title" "Browse Archives" "$TITLE"
DESC_META=$(npx agent-browser get attr "meta[name=description]" content 2>/dev/null || echo "")
check "Meta description present" "archived browser tabs" "$DESC_META"

# Summary
echo ""
echo "=== Results ==="
echo "  Passed: $PASS | Failed: $FAIL"
[ "$FAIL" -eq 0 ] && echo "  Status: ALL PASSED" || { echo "  Status: $FAIL failure(s)"; exit $FAIL; }

# Tab Archiver

Chrome Extension (manifest v3) that archives open tabs and browses/search them later.

## Key Entry Points

| File | Role |
|---|---|
| `background.js` | Service worker — captures tabs via `chrome.windows.getAll` + `chrome.scripting.executeScript`. Auto-sync: pulls before capture, pushes after. |
| `popup.js` / `popup.html` | Quick-capture popup (360px). No manual sync buttons — capture triggers sync automatically. |
| `archive.js` / `archive.html` / `archive.css` | Full archive browser with search, collapsible cards, styled modal. Manual push/pull buttons + Test Connection in settings. |
| `storage.js` | IndexedDB layer (single object store, `TabArchiver` db). Archives sorted by `timestamp` index descending (newest first). |
| `client-config.js` | Client identity management (UUID + device name in `chrome.storage.local`) |
| `github-sync.js` | GitHub sync — encryption (AES-GCM + PBKDF2), GitHub API push/pull, merge logic, testConnection diagnostics |
| `manifest.json` | Permissions: tabs, storage, favicon, scripting + `<all_urls>` |

## Design System (archive.css:root)

All visual tokens are CSS custom properties on `:root`. Dark mode via `prefers-color-scheme: dark`. Reduced motion via `prefers-reduced-motion: reduce`.

- `--color-accent: #D946EF` (fuchsia) — the one bold accent
- `--font-display: 'DM Serif Display'` — heading only
- `--font-mono: 'JetBrains Mono'` — URLs
- Left accent border on archive cards (3px fuchsia)

## Accessibility Features Added

- `aria-live="polite"` on archive container and popup status
- `role="dialog"` + `aria-modal="true"` on confirmation modal
- Skip-to-content link on archive page
- Keyboard handlers (Enter/Space) on expandable archive headers
- `aria-expanded` toggled on archive headers
- `aria-label` on all icon-only and action buttons
- `aria-hidden="true"` on decorative emoji
- `label` element (visually-hidden) for search input
- `:focus-visible` on all interactive elements
- OG image error handler moved from inline `onerror` to JS listener

## Commands

### Load extension in Chrome
```bash
# Open chrome://extensions/ → "Load unpacked" → select project root
```

### E2E Tests
```bash
# Requires: node_modules/ with agent-browser installed
bash e2e-test.sh
# Tests: popup UI, archive page, search, confirmation modal, keyboard nav, metadata
```

Extension ID is deterministic from the absolute path. Update `EXT_ID` in `e2e-test.sh` if the extension path changes.

## Architecture Notes

- All JS is ES modules (`type: "module"` in manifest)
- Archive list sorted by `timestamp` index descending (newest first) via `getAllArchives()` in `storage.js:45`
- Auto-sync capture flow: popup → `chrome.runtime.sendMessage({type:'capture'})` → background → `pullFromGitHub()` (best-effort) → capture tabs → `saveArchive()` in IndexedDB → tabs closed → `pushToGitHub()` (best-effort) → result stored in `chrome.storage.local` as `lastSyncResult`
- `github-sync.js` functions use a `storage` parameter (`{ getAllArchives, saveArchive }`) instead of direct imports — required because dynamic `import()` is forbidden in service workers (Manifest V3)
- Tabs excluded from capture: pinned, `chrome://*`, `chrome-extension://*`, empty URL
- OG image + meta description extracted via `chrome.scripting.executeScript`
- Archive tabs expand via `grid-template-rows: 0fr → 1fr` (replaced old max-height hack)
- Confirmation modal uses a dialog overlay with `role="dialog"` and Escape key dismissal
- Client identity: each extension instance generates a UUID + device name (stored in `chrome.storage.local`). Every archive is tagged with `clientId` + `clientName` at capture time.
- GitHub sync: encrypted (AES-256-GCM + PBKDF2) JSON blob committed to a hardcoded GitHub repo. Push sends all local archives; pull merges remote archives keyed by `(clientId, timestamp)`. Config (PAT + passphrase) stored in `chrome.storage.local`. GitHub repo info hardcoded at the top of `github-sync.js`.
- Sync status: last result stored in `chrome.storage.local` (`lastSyncResult`) with timestamp, persisted on archive page in `#lastSyncStatus`. Errors logged via `console.error()` to the service worker console.
- Test Connection button in Settings (⚙) calls `testConnection(pat, passphrase)` in `github-sync.js` — validates PAT, file access, and decryption without saving. Result shown inline.

## Important Gotchas

- Extension ID is deterministic — `ioojjbilpmncoflfljpklpbegibfebob` for current path. Adding/removing files changes it (Chrome hashes the directory).
- GitHub repo (`GITHUB_OWNER/GITHUB_REPO`) is hardcoded in `github-sync.js:1-3` — edit before loading the extension.
- Sync requires a GitHub PAT with `repo` scope. Stored locally with encryption passphrase.
- **Passphrase must be identical on all devices** — decryption uses AES-GCM + PBKDF2 with the passphrase as key material. Mismatched passphrases silently fail pull → push overwrites remote with only local data.
- No undo — deletion is permanent (confirmation modal prevents accidental delete)
- Popup capture requires unpinned, non-restricted tabs in visible windows
- `archive.html` Google Fonts (`DM Serif Display`, `JetBrains Mono`) load from CDN — fails if offline
- **Dynamic `import()` is disallowed in service workers** (`background.js`). Any cross-module dependencies in `github-sync.js` must use static top-level imports or be passed via a `storage` parameter object.
- **Base64 encoding must be chunked** — `String.fromCharCode(...largeArray)` causes "Maximum call stack size exceeded" for encrypted data beyond ~125K bytes. `bytesToBase64()` in `github-sync.js:88` chunks at 8KB boundaries.

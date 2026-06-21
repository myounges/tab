# Tab Archiver

Chrome Extension (manifest v3) that archives open tabs and browses/search them later.

## Key Entry Points

| File | Role |
|---|---|---|
| `background.js` | Service worker — captures tabs via `chrome.windows.getAll` + `chrome.scripting.executeScript` |
| `popup.js` / `popup.html` | Quick-capture popup (360px) |
| `archive.js` / `archive.html` / `archive.css` | Full archive browser with search, collapsible cards, styled modal |
| `storage.js` | IndexedDB layer (single object store, `TabArchiver` db) |
| `client-config.js` | Client identity management (UUID + device name in `chrome.storage.local`) |
| `github-sync.js` | GitHub sync — encryption (AES-GCM + PBKDF2), GitHub API push/pull, merge logic |
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
- Capture flow: popup → `chrome.runtime.sendMessage({type:'capture'})` → background service worker → `saveArchive()` in IndexedDB → tabs closed
- Tabs excluded from capture: pinned, `chrome://*`, `chrome-extension://*`, empty URL
- OG image + meta description extracted via `chrome.scripting.executeScript`
- Archive tabs expand via `grid-template-rows: 0fr → 1fr` (replaced old max-height hack)
- Confirmation modal uses a dialog overlay with `role="dialog"` and Escape key dismissal
- Client identity: each extension instance generates a UUID + device name (stored in `chrome.storage.local`). Every archive is tagged with `clientId` + `clientName` at capture time.
- GitHub sync: encrypted (AES-256-GCM + PBKDF2) JSON blob committed to a hardcoded GitHub repo. Push sends all local archives; pull merges remote archives keyed by `(clientId, timestamp)`. Config (PAT + passphrase) stored in `chrome.storage.local`. GitHub repo info hardcoded at the top of `github-sync.js`.

## Important Gotchas

- Extension ID is deterministic — `ioojjbilpmncoflfljpklpbegibfebob` for current path. Adding/removing files changes it (Chrome hashes the directory).
- GitHub repo (`GITHUB_OWNER/GITHUB_REPO`) is hardcoded in `github-sync.js:1-3` — edit before loading the extension.
- Sync requires a GitHub PAT with `repo` scope. Stored locally with encryption passphrase.
- No undo — deletion is permanent (confirmation modal prevents accidental delete)
- Popup capture requires unpinned, non-restricted tabs in visible windows
- `archive.html` Google Fonts (`DM Serif Display`, `JetBrains Mono`) load from CDN — fails if offline

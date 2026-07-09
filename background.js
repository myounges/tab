import { saveArchive } from './storage.js';
import { getClientInfo } from './client-config.js';
import { pullFromGitHub, pushToGitHub } from './github-sync.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'capture') {
    captureAllTabs()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function captureAllTabs() {
  let syncInfo = { pulled: 0, pushed: false };

  try {
    const result = await pullFromGitHub();
    syncInfo.pulled = result.added;
  } catch {
    // GitHub not configured or unreachable — capture proceeds without sync
  }

  const windows = await chrome.windows.getAll({ populate: true });
  const allTabs = [];
  const tabIdsToClose = [];

  for (const w of windows) {
    for (const t of w.tabs) {
      if (t.pinned) continue;
      if (!t.url || t.url.startsWith('chrome://') || t.url.startsWith('chrome-extension://')) continue;

      const entry = {
        title: t.title || '',
        url: t.url,
        windowId: w.id,
        windowName: w.type === 'normal' ? (w.title || `Window ${w.id}`) : w.type,
        description: '',
        ogImage: '',
      };

      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: t.id },
          func: () => {
            const desc = document.querySelector('meta[name="description"]')?.content || '';
            const og = document.querySelector('meta[property="og:image"]')?.content || '';
            return { description: desc, ogImage: og };
          },
        });
        if (result?.result) {
          entry.description = result.result.description || '';
          entry.ogImage = result.result.ogImage || '';
        }
      } catch {
        // Cannot inject into this tab (e.g. restricted page, no access)
      }

      allTabs.push(entry);
      tabIdsToClose.push(t.id);
    }
  }

  if (allTabs.length === 0) {
    throw new Error('No unpinned tabs to archive.');
  }

  const client = await getClientInfo();
  await saveArchive(allTabs, { clientId: client.id, clientName: client.name });

  try {
    await pushToGitHub();
    syncInfo.pushed = true;
  } catch {
    // Push failure is non-fatal — data is saved locally
  }

  await chrome.tabs.remove(tabIdsToClose);
  return { ok: true, ...syncInfo };
}

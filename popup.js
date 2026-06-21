import { getAllArchives } from './storage.js';
import { pushToGitHub, pullFromGitHub } from './github-sync.js';

const captureBtn = document.getElementById('captureBtn');
const statusEl = document.getElementById('status');
const recentList = document.getElementById('recentList');
const viewAllLink = document.getElementById('viewAll');
const popupPushBtn = document.getElementById('popupPushBtn');
const popupPullBtn = document.getElementById('popupPullBtn');
const popupSyncStatus = document.getElementById('popupSyncStatus');

captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;
  statusEl.textContent = 'Capturing…';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'capture' });
    if (resp.ok) {
      statusEl.textContent = 'Archived successfully!';
    } else {
      statusEl.textContent = `Error: ${resp.error}`;
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
  captureBtn.disabled = false;
  loadRecent();
});

async function loadRecent() {
  const archives = await getAllArchives();
  const recent = archives.slice(0, 5);
  if (recent.length === 0) {
    recentList.innerHTML = '<div class="empty">No archives yet</div>';
    return;
  }
  recentList.innerHTML = recent.map(a => {
    const d = new Date(a.timestamp);
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div class="recent-item"><span>${dateStr}</span><span class="count">${a.tabs.length} tabs</span></div>`;
  }).join('');
}

viewAllLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('archive.html') });
});

popupPushBtn.addEventListener('click', async () => {
  popupPushBtn.disabled = true;
  popupSyncStatus.textContent = 'Pushing…';
  try {
    await pushToGitHub();
    popupSyncStatus.textContent = 'Pushed successfully.';
  } catch (err) {
    popupSyncStatus.textContent = `Push failed: ${err.message}`;
  }
  popupPushBtn.disabled = false;
});

popupPullBtn.addEventListener('click', async () => {
  popupPullBtn.disabled = true;
  popupSyncStatus.textContent = 'Pulling…';
  try {
    const result = await pullFromGitHub();
    if (result.added === 0) {
      popupSyncStatus.textContent = `Up to date (${result.total} on GitHub).`;
    } else {
      popupSyncStatus.textContent = `Pulled ${result.added} new archive(s).`;
    }
    loadRecent();
  } catch (err) {
    popupSyncStatus.textContent = `Pull failed: ${err.message}`;
  }
  popupPullBtn.disabled = false;
});

loadRecent();

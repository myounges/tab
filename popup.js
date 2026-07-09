import { getAllArchives } from './storage.js';

const captureBtn = document.getElementById('captureBtn');
const statusEl = document.getElementById('status');
const recentList = document.getElementById('recentList');
const viewAllLink = document.getElementById('viewAll');

captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;
  statusEl.textContent = 'Capturing…';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'capture' });
    if (resp.ok) {
      const parts = ['Archived successfully!'];
      if (resp.pulled > 0) parts.push(`Pulled ${resp.pulled} from sync.`);
      if (resp.pushed) parts.push('Synced to GitHub.');
      if (resp.pullError) parts.push(`Pull: ${resp.pullError}`);
      if (resp.pushError) parts.push(`Push: ${resp.pushError}`);
      statusEl.textContent = parts.join(' ');
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

loadRecent();

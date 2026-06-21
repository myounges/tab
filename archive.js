import { getAllArchives, deleteArchive } from './storage.js';
import { pushToGitHub, pullFromGitHub, getConfig, saveConfig } from './github-sync.js';
import { getClientInfo, setClientName } from './client-config.js';

const container = document.getElementById('archivesContainer');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const clearSearch = document.getElementById('clearSearch');
const trimBtn = document.getElementById('trimBtn');
const confirmModal = document.getElementById('confirmModal');
const modalMessage = document.getElementById('modalMessage');
const modalConfirm = document.getElementById('modalConfirm');
const modalCancel = document.getElementById('modalCancel');

const syncSettingsBtn = document.getElementById('syncSettingsBtn');
const pushBtn = document.getElementById('pushBtn');
const pullBtn = document.getElementById('pullBtn');
const syncStatus = document.getElementById('syncStatus');
const settingsModal = document.getElementById('settingsModal');
const settingsPat = document.getElementById('settingsPat');
const settingsPassphrase = document.getElementById('settingsPassphrase');
const settingsDeviceName = document.getElementById('settingsDeviceName');
const settingsCancel = document.getElementById('settingsCancel');
const settingsSave = document.getElementById('settingsSave');

let archives = [];
let searchQuery = '';
let tagFilter = '';
let pendingAction = null;

function domainLetter(url) {
  try { return new URL(url).hostname.charAt(0).toUpperCase(); }
  catch { return '?'; }
}

function domainColor(url) {
  const colors = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e','#16a085','#c0392b','#2980b9','#8e44ad','#2c3e50','#d35400','#27ae60'];
  try {
    const domain = new URL(url).hostname;
    let hash = 0;
    for (let i = 0; i < domain.length; i++) hash = domain.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  } catch { return '#999'; }
}

function clientColor(clientId) {
  const colors = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e','#16a085','#c0392b','#2980b9','#8e44ad','#2c3e50','#d35400','#27ae60'];
  if (!clientId) return '#999';
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) hash = clientId.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

async function loadFavicon(img, url) {
  try {
    img.src = await chrome.favicon.getUrl({ pageUrl: url, size: 32 });
  } catch {
    img.style.display = 'none';
  }
}

function showModal(message, action) {
  modalMessage.textContent = message;
  pendingAction = action;
  confirmModal.classList.add('open');
  modalCancel.focus();
}

function hideModal() {
  confirmModal.classList.remove('open');
  pendingAction = null;
}

modalCancel.addEventListener('click', hideModal);
modalConfirm.addEventListener('click', () => {
  const action = pendingAction;
  hideModal();
  if (action) action();
});

confirmModal.addEventListener('click', (e) => {
  if (e.target === confirmModal) hideModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && confirmModal.classList.contains('open')) hideModal();
  if (e.key === 'Escape' && settingsModal.classList.contains('open')) hideSettingsModal();
});

function setSyncStatus(msg, type) {
  syncStatus.textContent = msg;
  syncStatus.className = 'sync-status' + (type ? ' ' + type : '');
}

async function doPush() {
  pushBtn.disabled = true;
  setSyncStatus('Pushing to GitHub…');
  try {
    await pushToGitHub();
    setSyncStatus('Pushed successfully.', 'success');
  } catch (err) {
    setSyncStatus(`Push failed: ${err.message}`, 'error');
  }
  pushBtn.disabled = false;
}

async function doPull() {
  pullBtn.disabled = true;
  setSyncStatus('Pulling from GitHub…');
  try {
    const result = await pullFromGitHub();
    if (result.added === 0) {
      setSyncStatus(`Up to date (${result.total} archives on GitHub).`, 'success');
    } else {
      setSyncStatus(`Pulled ${result.added} new archive(s).`, 'success');
    }
    await loadArchives();
  } catch (err) {
    setSyncStatus(`Pull failed: ${err.message}`, 'error');
  }
  pullBtn.disabled = false;
}

function showSettingsModal() {
  Promise.all([
    getConfig(),
    getClientInfo(),
  ]).then(([config, client]) => {
    settingsPat.value = config ? config.pat : '';
    settingsPassphrase.value = config ? config.passphrase : '';
    settingsDeviceName.value = client ? client.name : 'My Device';
    settingsModal.classList.add('open');
    settingsPat.focus();
  });
}

function hideSettingsModal() {
  settingsModal.classList.remove('open');
}

settingsCancel.addEventListener('click', hideSettingsModal);
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) hideSettingsModal();
});

settingsSave.addEventListener('click', async () => {
  const pat = settingsPat.value.trim();
  const passphrase = settingsPassphrase.value.trim();
  const name = settingsDeviceName.value.trim() || 'My Device';
  if (!pat || !passphrase) {
    setSyncStatus('PAT and passphrase are required.', 'error');
    return;
  }
  try {
    await saveConfig(pat, passphrase);
    await setClientName(name);
    hideSettingsModal();
    setSyncStatus('Settings saved.', 'success');
  } catch (err) {
    setSyncStatus(`Failed to save settings: ${err.message}`, 'error');
  }
});

syncSettingsBtn.addEventListener('click', showSettingsModal);
pushBtn.addEventListener('click', doPush);
pullBtn.addEventListener('click', doPull);

function render() {
  if (archives.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  let html = '';
  for (const a of archives) {
    const archiveTagMatch = !tagFilter || (a.clientName || '').toLowerCase().includes(tagFilter);
    if (!archiveTagMatch) continue;

    let tabsHtml = '';
    for (const t of a.tabs) {
      const match = searchQuery ? (
        t.title.toLowerCase().includes(searchQuery) ||
        t.url.toLowerCase().includes(searchQuery) ||
        (t.description || '').toLowerCase().includes(searchQuery)
      ) : true;

      const color = domainColor(t.url);
      const letter = domainLetter(t.url);

      const ogThumb = t.ogImage
        ? `<img class="tab-thumb" src="${escapeHtml(t.ogImage)}" alt="" loading="lazy" data-thumb="true">`
        : '';

      tabsHtml += `<div class="tab-item ${match ? '' : 'hidden'}">
        <div class="tab-favicon-wrap" style="background:${color}">
          <span class="favicon-letter">${letter}</span>
          <img class="favicon" data-url="${escapeHtml(t.url)}" alt="">
        </div>
        <div class="tab-info">
          <div class="tab-title">${escapeHtml(t.title)}</div>
          <div class="tab-url">${escapeHtml(t.url)}</div>
          ${t.description ? `<div class="tab-desc">${escapeHtml(truncate(t.description, 120))}</div>` : ''}
        </div>
        ${ogThumb}
        <div class="tab-actions">
          <button class="open-btn" data-url="${escapeHtml(t.url)}">Open</button>
        </div>
      </div>`;
    }

    const archiveHasMatch = archiveTagMatch && (!searchQuery || a.tabs.some(t =>
      t.title.toLowerCase().includes(searchQuery) ||
      t.url.toLowerCase().includes(searchQuery) ||
      (t.description || '').toLowerCase().includes(searchQuery)
    ));

    html += `<div class="archive-card" data-archive-id="${a.id}">
      <div class="archive-header" tabindex="0" role="button" aria-expanded="${archiveHasMatch}" aria-label="Toggle archive from ${formatDate(a.timestamp)}">
        <div>
          <div class="date">${formatDate(a.timestamp)}</div>
          <div class="meta">
            <span class="count">${a.tabs.length} tabs</span>
            ${a.clientName ? `<span class="client-badge" style="background:${clientColor(a.clientId)}">${escapeHtml(a.clientName)}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <button class="btn-danger delete-archive-btn" data-id="${a.id}" style="font-size:11px;padding:4px 10px;">Delete</button>
          <span class="toggle-icon ${archiveHasMatch ? 'open' : ''}">▾</span>
        </div>
      </div>
      <div class="archive-tabs ${archiveHasMatch ? 'open' : ''}">
        <div class="tabs-inner">
          ${tabsHtml}
        </div>
      </div>
    </div>`;
  }

  container.innerHTML = html;

  container.querySelectorAll('.favicon').forEach(img => {
    loadFavicon(img, img.dataset.url).catch(() => { img.style.display = 'none'; });
  });

  container.querySelectorAll('[data-thumb="true"]').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; });
  });

  container.querySelectorAll('.archive-header').forEach(h => {
    const toggle = () => {
      const card = h.closest('.archive-card');
      const tabs = card.querySelector('.archive-tabs');
      const icon = h.querySelector('.toggle-icon');
      const isOpen = tabs.classList.toggle('open');
      icon.classList.toggle('open', isOpen);
      h.setAttribute('aria-expanded', isOpen);
    };

    h.addEventListener('click', (e) => {
      if (e.target.closest('.delete-archive-btn')) return;
      toggle();
    });

    h.addEventListener('keydown', (e) => {
      if (e.target.closest('.delete-archive-btn')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  });

  container.querySelectorAll('.open-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.tabs.create({ url: btn.dataset.url, active: false });
    });
  });

  container.querySelectorAll('.delete-archive-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteArchive(Number(btn.dataset.id));
      await loadArchives();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadArchives() {
  archives = await getAllArchives();
  render();
}

function parseSearch(raw) {
  const trimmed = raw.trim().toLowerCase();
  const tagMatch = trimmed.match(/^tag:(\S+)\s*(.*)$/);
  if (tagMatch) {
    tagFilter = tagMatch[1];
    searchQuery = tagMatch[2];
  } else {
    tagFilter = '';
    searchQuery = trimmed;
  }
}

searchInput.addEventListener('input', () => {
  parseSearch(searchInput.value);
  clearSearch.classList.toggle('visible', searchInput.value.length > 0);
  render();
});

clearSearch.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  tagFilter = '';
  clearSearch.classList.remove('visible');
  render();
  searchInput.focus();
});

trimBtn.addEventListener('click', () => {
  const totalTabs = archives.reduce((s, a) => s + a.tabs.length, 0);
  if (totalTabs <= 500) {
    setSyncStatus(`Already under 500 tabs (${totalTabs}).`, 'success');
    return;
  }
  showModal(`Keep only the newest 500 tabs? ${totalTabs - 500} old tab(s) will be removed.`, async () => {
    let keptTabs = 0;
    const toDelete = [];
    for (const a of archives) {
      if (keptTabs + a.tabs.length > 500 && keptTabs > 0) {
        toDelete.push(a.id);
      } else {
        keptTabs += a.tabs.length;
      }
    }
    for (const id of toDelete) await deleteArchive(id);
    setSyncStatus(`Archived — kept ${keptTabs} tabs, removed ${toDelete.length} old archive(s).`, 'success');
    await loadArchives();
  });
});

loadArchives();

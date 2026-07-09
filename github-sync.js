const GITHUB_OWNER = 'myounges';
const GITHUB_REPO = 'tab';
const GITHUB_FILE = 'archives.encrypted';

const STORAGE_KEY = 'githubSync';

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

export async function getConfig() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || null;
}

export async function saveConfig(pat, passphrase) {
  await chrome.storage.local.set({ [STORAGE_KEY]: { pat, passphrase } });
}

export async function clearConfig() {
  await chrome.storage.local.remove(STORAGE_KEY);
}

async function encrypt(data, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );

  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const encoded = new TextEncoder().encode(data);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length);

  return combined;
}

async function decrypt(combined, passphrase) {
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );

  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

async function getGitHubFile(pat) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `GitHub error: ${res.status}`);
  }
  return res.json();
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...new Uint8Array(bytes).subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function putGitHubFile(pat, contentBytes, sha) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`;
  const body = {
    message: `Tab Archiver sync — ${new Date().toLocaleString()}`,
    content: bytesToBase64(contentBytes),
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `GitHub error: ${res.status}`);
  }
  return res.json();
}

export async function pushToGitHub(storage) {
  const config = await getConfig();
  if (!config || !config.pat || !config.passphrase) {
    throw new Error('GitHub not configured. Open settings and enter your PAT and passphrase.');
  }

  const archives = await storage.getAllArchives();

  if (archives.length === 0) {
    return;
  }

  let sha = null;
  try {
    const existing = await getGitHubFile(config.pat);
    if (existing) sha = existing.sha;
  } catch (err) {
    if (!err.message.includes('Not Found')) throw err;
  }

  const json = JSON.stringify(archives);
  const encrypted = await encrypt(json, config.passphrase);
  await putGitHubFile(config.pat, encrypted, sha);
}

export async function pullFromGitHub(storage) {
  const config = await getConfig();
  if (!config || !config.pat || !config.passphrase) {
    throw new Error('GitHub not configured. Open settings and enter your PAT and passphrase.');
  }

  const existing = await getGitHubFile(config.pat);
  if (!existing) {
    return { added: 0, total: 0 };
  }

  const raw = atob(existing.content.replace(/\n/g, ''));
  const encryptedBytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  const json = await decrypt(encryptedBytes, config.passphrase);
  const remoteArchives = JSON.parse(json);

  if (!Array.isArray(remoteArchives)) {
    throw new Error('Invalid archive data on GitHub.');
  }

  const localArchives = await storage.getAllArchives();

  const localKeys = new Set(
    localArchives.map(a => `${a.clientId || ''}:${a.timestamp}`)
  );

  const toAdd = remoteArchives.filter(
    a => !localKeys.has(`${a.clientId || ''}:${a.timestamp}`)
  );

  if (toAdd.length === 0) {
    return { added: 0, total: remoteArchives.length };
  }

  for (const a of toAdd) {
    await storage.saveArchive(a.tabs || [], {
      timestamp: a.timestamp,
      clientId: a.clientId || '',
      clientName: a.clientName || '',
    });
  }

  return { added: toAdd.length, total: remoteArchives.length };
}

export async function testConnection(pat, passphrase) {
  const result = { patValid: false, fileExists: false, decryptSuccess: false, archiveCount: 0, error: '' };

  try {
    const userRes = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${pat}`, 'Accept': 'application/vnd.github.v3+json' },
    });
    if (!userRes.ok) {
      const body = await userRes.json().catch(() => ({}));
      result.error = `PAT invalid: ${body.message || userRes.status}`;
      return result;
    }
    result.patValid = true;
  } catch (e) {
    result.error = `Network error: ${e.message}`;
    return result;
  }

  try {
    const existing = await getGitHubFile(pat);
    if (!existing) {
      result.fileExists = false;
      result.archiveCount = 0;
      return result;
    }
    result.fileExists = true;

    const raw = atob(existing.content.replace(/\n/g, ''));
    const encryptedBytes = Uint8Array.from(raw, c => c.charCodeAt(0));

    try {
      const json = await decrypt(encryptedBytes, passphrase);
      const archives = JSON.parse(json);
      if (Array.isArray(archives)) {
        result.archiveCount = archives.length;
        result.decryptSuccess = true;
      } else {
        result.error = 'Remote file has invalid format.';
      }
    } catch (e) {
      result.error = `Decryption failed: ${e.message}. Check passphrase matches other devices.`;
    }
  } catch (e) {
    if (!result.error) result.error = `GitHub error: ${e.message}`;
  }

  return result;
}

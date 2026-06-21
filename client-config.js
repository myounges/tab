const STORAGE_KEY = 'clientInfo';

export async function getClientInfo() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (result[STORAGE_KEY]) return result[STORAGE_KEY];
  const info = { id: crypto.randomUUID(), name: 'My Device' };
  await chrome.storage.local.set({ [STORAGE_KEY]: info });
  return info;
}

export async function setClientName(name) {
  const info = await getClientInfo();
  info.name = name;
  await chrome.storage.local.set({ [STORAGE_KEY]: info });
}

export async function getClientId() {
  const info = await getClientInfo();
  return info.id;
}

export async function getClientName() {
  const info = await getClientInfo();
  return info.name;
}

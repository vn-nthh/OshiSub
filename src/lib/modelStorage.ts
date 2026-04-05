// Model storage: File System Access API (Chrome/Edge) + IndexedDB fallback (Firefox)

const IDB_DB_NAME = 'oshisub-models';
const IDB_STORE_NAME = 'model-files';
const IDB_VERSION = 1;

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveModelFileIDB(key: string, data: ArrayBuffer): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    tx.objectStore(IDB_STORE_NAME).put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadModelFileIDB(key: string): Promise<ArrayBuffer | null> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readonly');
    const req = tx.objectStore(IDB_STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function checkModelFileExists(
  dirHandle: FileSystemDirectoryHandle | null,
  fileName: string,
  useIDB: boolean
): Promise<boolean> {
  if (useIDB || !dirHandle) {
    const data = await loadModelFileIDB(fileName);
    return data !== null;
  }
  try {
    await dirHandle.getFileHandle(fileName, { create: false });
    return true;
  } catch {
    return false;
  }
}

export async function saveModelFile(
  dirHandle: FileSystemDirectoryHandle | null,
  fileName: string,
  data: ArrayBuffer,
  useIDB: boolean
): Promise<void> {
  if (useIDB || !dirHandle) {
    await saveModelFileIDB(fileName, data);
    return;
  }
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

export async function loadModelFile(
  dirHandle: FileSystemDirectoryHandle | null,
  fileName: string,
  useIDB: boolean
): Promise<ArrayBuffer | null> {
  if (useIDB || !dirHandle) {
    return loadModelFileIDB(fileName);
  }
  try {
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: false });
    const file = await fileHandle.getFile();
    return file.arrayBuffer();
  } catch {
    return null;
  }
}

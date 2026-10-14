// Where the save lives: one record in IndexedDB. Every call fails soft, so a browser that
// blocks storage (some private windows) still plays, just without remembering.
import type { SaveFile } from './save';

const DB_NAME = 'lodger-computer-person';
const STORE = 'saves';
const KEY = 'current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = work(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/** The raw stored save, unparsed, or null if there isn't one (or storage is unavailable). */
export async function readSave(): Promise<unknown | null> {
  try {
    return (await run('readonly', (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

/** True if it was written. */
export async function writeSave(file: SaveFile): Promise<boolean> {
  try {
    await run('readwrite', (s) => s.put(file, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function deleteSave(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch {
    // Nothing to do: there's no save to remove.
  }
}

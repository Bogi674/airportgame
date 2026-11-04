/**
 * Saves in IndexedDB with gzip compression, plus file export and import (docs/BROWSER.md section 6).
 * Everything works offline. If IndexedDB is blocked, saving falls back to file export only.
 */

const DB_NAME = 'airfield-tycoon';
const STORE = 'saves';

export interface SaveHeader {
  id: string;
  name: string;
  seed: string;
  preset: string;
  tick: number;
  cash: number;
  savedAt: number;
  auto: boolean;
  compressed: boolean;
}

interface SaveRecord extends SaveHeader {
  /** Stored as bytes: WebKit refuses Blobs in IndexedDB in some contexts. Older saves hold a Blob or a string. */
  blob: ArrayBuffer | Blob | string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

export async function compress(text: string): Promise<{ blob: Blob; compressed: boolean }> {
  if (typeof CompressionStream === 'undefined') return { blob: new Blob([text]), compressed: false };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return { blob: await new Response(stream).blob(), compressed: true };
}

export async function decompress(blob: Blob, compressed: boolean): Promise<string> {
  if (!compressed) return blob.text();
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function putSave(header: Omit<SaveHeader, 'compressed'>, json: string): Promise<void> {
  const { blob, compressed } = await compress(json);
  const rec: SaveRecord = { ...header, compressed, blob: await blob.arrayBuffer() };
  await tx('readwrite', (s) => s.put(rec));
}

export async function listSaves(): Promise<SaveHeader[]> {
  try {
    const all = (await tx('readonly', (s) => s.getAll())) as SaveRecord[];
    return all
      .map((r) => ({ id: r.id, name: r.name, seed: r.seed, preset: r.preset, tick: r.tick, cash: r.cash, savedAt: r.savedAt, auto: r.auto, compressed: r.compressed }))
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function loadSave(id: string): Promise<unknown> {
  const rec = (await tx('readonly', (s) => s.get(id))) as SaveRecord | undefined;
  if (!rec) throw new Error('Save not found');
  const text = typeof rec.blob === 'string' ? rec.blob : await decompress(rec.blob instanceof Blob ? rec.blob : new Blob([rec.blob]), rec.compressed);
  return JSON.parse(text);
}

export async function deleteSave(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function storageAvailable(): Promise<boolean> {
  try {
    await open();
    return true;
  } catch {
    return false;
  }
}

/** Offers a `.airfield` file download made of the gzip of the JSON save. */
export async function exportToFile(json: string, name: string): Promise<void> {
  const { blob } = await compress(json);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^\w-]+/g, '_')}.airfield`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Reads a `.airfield` file. Plain JSON and gzip are both accepted. */
export async function importFromFile(file: File): Promise<unknown> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gz = head[0] === 0x1f && head[1] === 0x8b;
  return JSON.parse(await decompress(file, gz));
}

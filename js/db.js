// 曲とセットリストをIndexedDBに保存する(オフライン用)。
let dbp;
function open() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('chordstage', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('songs')) d.createObjectStore('songs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('setlists')) d.createObjectStore('setlists', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}
let onChange = () => {};
export const setOnChange = (f) => { onChange = f; }; // 保存・削除のたびに呼ぶ(自動同期のきっかけ)
const w = (p) => p.then((r) => { try { onChange(); } catch {} return r; });
export const allSongs = () => tx('songs', 'readonly', (s) => s.getAll());
export const putSong = (song) => w(tx('songs', 'readwrite', (s) => s.put(song)));
export const deleteSong = (id) => w(tx('songs', 'readwrite', (s) => s.delete(id)));
export const allSetlists = () => tx('setlists', 'readonly', (s) => s.getAll());
export const putSetlist = (set) => w(tx('setlists', 'readwrite', (s) => s.put(set)));
export const deleteSetlist = (id) => w(tx('setlists', 'readwrite', (s) => s.delete(id)));

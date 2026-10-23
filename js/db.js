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
export const allSongs = () => tx('songs', 'readonly', (s) => s.getAll());
export const putSong = (song) => tx('songs', 'readwrite', (s) => s.put(song));
export const deleteSong = (id) => tx('songs', 'readwrite', (s) => s.delete(id));
export const allSetlists = () => tx('setlists', 'readonly', (s) => s.getAll());
export const putSetlist = (set) => tx('setlists', 'readwrite', (s) => s.put(set));
export const deleteSetlist = (id) => tx('setlists', 'readwrite', (s) => s.delete(id));

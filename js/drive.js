// Googleドライブへの手動バックアップ / 復元。
// スコープは drive.file(このアプリが作ったファイルだけに触れる権限)。フォルダ「ChordStage」はアプリが自動で作る。
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3/';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export const getConfig = () => {
  try { return JSON.parse(localStorage.getItem('cs.gdrive') || '{}'); } catch { return {}; }
};
export const saveConfig = (cfg) => localStorage.setItem('cs.gdrive', JSON.stringify({ ...getConfig(), ...cfg }));
export const isConfigured = () => !!getConfig().clientId;
const folderName = () => getConfig().folderName || 'ChordStage';

let gis = null;
export function loadGis() {
  gis ||= new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => resolve();
    s.onerror = () => { gis = null; reject(new Error('Googleのログイン部品を読み込めません(ネットワークを確認してください)')); };
    document.head.append(s);
  });
  return gis;
}

let token = null;
let tokenExp = 0;
// アクセストークンを取得する(初回や期限切れのときだけ、Googleの同意ポップアップが出る)
export async function getToken() {
  if (token && Date.now() < tokenExp - 60000) return token;
  const { clientId } = getConfig();
  if (!clientId) throw new Error('クライアントIDが未設定です');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error) return reject(new Error('ログインに失敗しました: ' + r.error + (r.error_description ? ' ' + r.error_description : '')));
        token = r.access_token;
        tokenExp = Date.now() + (r.expires_in || 3600) * 1000;
        resolve(token);
      },
      error_callback: (e) => reject(new Error('ログインできませんでした(' + (e.type || 'popup') + ')。ポップアップが許可されているか確認してください')),
    });
    client.requestAccessToken({});
  });
}

async function call(url, opts = {}) {
  const t = await getToken();
  const res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
  if (!res.ok) {
    let msg = res.status + '';
    try { const j = await res.json(); msg = (j.error && (j.error.message || j.error.status)) || msg; } catch {}
    if (res.status === 401) token = null;
    throw new Error('Googleドライブのエラー: ' + msg);
  }
  return res;
}

// フォルダを探し、無ければ作る
async function ensureFolder() {
  const q = `name='${folderName().replace(/'/g, "\\'")}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const found = await (await call(API + 'files?fields=files(id,name)&q=' + encodeURIComponent(q))).json();
  if (found.files && found.files.length) return found.files[0].id;
  const made = await (await call(API + 'files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName(), mimeType: FOLDER_MIME }),
  })).json();
  return made.id;
}

export async function backup(songs, setlists = [], deleted = {}) {
  const folder = await ensureFolder();
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const name = `chordstage-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  const content = JSON.stringify({ app: 'chordstage', version: 2, exportedAt: d.toISOString(), songs, setlists, deleted });
  const b = 'cs' + Date.now();
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${b}--`;
  await call('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/related; boundary=' + b },
    body,
  });
  return { name, folder: folderName(), count: songs.length };
}

// フォルダ内のバックアップを新しい順に返す
export async function listBackups() {
  const folder = await ensureFolder();
  const q = `'${folder}' in parents and trashed=false and mimeType!='${FOLDER_MIME}'`;
  const r = await (await call(API + 'files?pageSize=20&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime)&q=' + encodeURIComponent(q))).json();
  return r.files || [];
}

export async function download(id) {
  const res = await call(API + 'files/' + id + '?alt=media');
  return res.json();
}

// ---- 1クリック同期: フォルダ内の「chordstage-sync.json」を読み込み、アプリ側で端末と統合し、統合後の内容を同じファイルへ保存する
const SYNC_NAME = 'chordstage-sync.json';
export async function sync(mergeIncoming, buildPayload) {
  const folder = await ensureFolder();
  const q = `name='${SYNC_NAME}' and '${folder}' in parents and trashed=false`;
  const found = await (await call(API + 'files?fields=files(id)&q=' + encodeURIComponent(q))).json();
  const id = found.files && found.files[0] && found.files[0].id;
  let incoming = null;
  if (id) {
    incoming = await (await call(API + 'files/' + id + '?alt=media')).json();
    await mergeIncoming(incoming);
  }
  const content = JSON.stringify(buildPayload());
  if (id) {
    await call('https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: content,
    });
  } else {
    const b = 'cs' + Date.now();
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: SYNC_NAME, parents: [folder] })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${b}--`;
    await call('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/related; boundary=' + b },
      body,
    });
  }
  return { existed: !!id, folder: folderName() };
}

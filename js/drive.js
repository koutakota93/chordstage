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

// アクセストークン(1時間有効)は端末に覚えておき、アプリを開き直しても、期限内ならログインを求めない
let token = null;
let tokenExp = 0;
try { const t = JSON.parse(localStorage.getItem('cs.gtoken') || 'null'); if (t && t.exp > Date.now() + 60000) { token = t.t; tokenExp = t.exp; } } catch {}
export const hasToken = () => !!token && Date.now() < tokenExp - 60000;
const remember = () => { try { localStorage.setItem('cs.gtoken', JSON.stringify({ t: token, exp: tokenExp })); } catch {} };
// アクセストークンを取得する。同意済みのアカウントなら prompt:'' で、ポップアップは一瞬で閉じる(画面タップの直後に呼ぶ必要がある)
let pending = null;
export function getToken() {
  if (hasToken()) return Promise.resolve(token);
  if (pending) return pending;
  const { clientId, hint } = getConfig();
  if (!clientId) return Promise.reject(new Error('クライアントIDが未設定です'));
  pending = loadGis().then(() => new Promise((resolve, reject) => {
    const fail = (msg, code) => { const e = new Error(msg); e.code = code; reject(e); };
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      prompt: '',
      ...(hint ? { hint } : {}),
      callback: (r) => {
        if (r.error) return fail('ログインに失敗しました: ' + r.error + (r.error_description ? ' ' + r.error_description : ''), 'auth');
        token = r.access_token;
        tokenExp = Date.now() + (r.expires_in || 3600) * 1000;
        remember();
        saveConfig({ authed: true });
        resolve(token);
        if (!hint) fetch(API + 'about?fields=user(emailAddress)', { headers: { Authorization: 'Bearer ' + token } })
          .then((x) => x.json()).then((j) => { if (j.user && j.user.emailAddress) saveConfig({ hint: j.user.emailAddress }); }).catch(() => {});
      },
      error_callback: (e) => fail('ログインできませんでした(' + (e.type || 'popup') + ')。ポップアップが許可されているか確認してください', 'popup'),
    });
    client.requestAccessToken({});
  })).finally(() => { pending = null; });
  return pending;
}

async function call(url, opts = {}) {
  const t = await getToken();
  const res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
  if (!res.ok) {
    let msg = res.status + '';
    try { const j = await res.json(); msg = (j.error && (j.error.message || j.error.status)) || msg; } catch {}
    if (res.status === 401) { token = null; try { localStorage.removeItem('cs.gtoken'); } catch {} }
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

export async function backup(songs, setlists = [], deleted = {}, repertoire = [], yomi = {}) {
  const folder = await ensureFolder();
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const name = `chordstage-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  const content = JSON.stringify({ app: 'chordstage', version: 2, exportedAt: d.toISOString(), songs, setlists, deleted, repertoire, yomi });
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
const bare = (t) => t.replace(/"exportedAt":"[^"]*",?/, '');
export async function sync(mergeIncoming, buildPayload) {
  const folder = await ensureFolder();
  const q = `name='${SYNC_NAME}' and '${folder}' in parents and trashed=false`;
  const found = await (await call(API + 'files?fields=files(id)&q=' + encodeURIComponent(q))).json();
  const id = found.files && found.files[0] && found.files[0].id;
  let remoteText = '';
  if (id) {
    remoteText = await (await call(API + 'files/' + id + '?alt=media')).text();
    await mergeIncoming(JSON.parse(remoteText));
  }
  const content = JSON.stringify(buildPayload());
  let uploaded = true;
  if (id && bare(remoteText) === bare(content)) uploaded = false; // 変更がなければ、書き込まない
  else if (id) {
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
  return { existed: !!id, folder: folderName(), uploaded };
}

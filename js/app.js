import { parseSong, transposeChord, lineLyric, lineTimeline, isRhythmOnly, cleanTitle } from './parser.js';
import * as db from './db.js';
import { rinneToText } from './sites.js';
import * as drive from './drive.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- 設定 ----------
const DEFAULT_KEYS = { next: ['ArrowRight', 'ArrowDown', 'PageDown', 'Enter', ' '], prev: ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'], play: [' '], nextSong: [], prevSong: [] };
const defaults = { autoFit: true, beatSync: true, beatEm: 2, followTempo: true, rangeOn: true, rangeStyle: 'bracket', colorsByTheme: {}, fontSize: 30, keys: DEFAULT_KEYS, lyricScale: 1, chordScale: 1, colors: {}, custom: null, preset: '', theme: 'dark', beatsPerChord: 4, click: false, tapJump: true };
let settings = { ...defaults };
try { Object.assign(settings, JSON.parse(localStorage.getItem('cs.settings') || '{}')); } catch {}
const MIN_FONT = 4; // 小さい画面(スマホの縦持ちなど)でも、自動幅で全ての行が1段に収まるよう、下限を小さくしてある
const DEFAULT_GROUP = 2; // ハイライトする行数の初期値
const COLOR_VARS = { chord: '--chord', lyric: '--lyric', bar: '--bar-color', bg: '--score-bg', hl: '--hl', hlChord: '--hl-chord', hlLyric: '--hl-lyric', hlBar: '--hl-bar', rngA: '--rng-a', rngB: '--rng-b', now: '--now-bg', nowFg: '--now-fg' };
// 色の組み合わせ(プリセット)。選んだあとで1色ずつ直し、「自分用に保存」できる
const PRESETS = [
  { id: 'stage', name: 'ステージ標準(ダーク)', theme: 'dark', colors: { bg: '#0b1020', chord: '#5cc8ff', lyric: '#f6f1e4', bar: '#9aa3b8', hl: '#facc15', hlChord: '#0b3b94', hlLyric: '#2b1d00', hlBar: '#3b2f08', rngA: '#34d399', rngB: '#60a5fa', now: '#c81e1e', nowFg: '#ffffff' } },
  { id: 'contrast', name: 'ハイコントラスト(黒×白)', theme: 'dark', colors: { bg: '#000000', chord: '#ffd400', lyric: '#ffffff', bar: '#ffffff', hl: '#ffffff', hlChord: '#0033cc', hlLyric: '#000000', hlBar: '#000000', rngA: '#00e676', rngB: '#40c4ff', now: '#d00000', nowFg: '#ffffff' } },
  { id: 'night', name: '暗所向け(赤系・目に優しい)', theme: 'dark', colors: { bg: '#120707', chord: '#ff9a7a', lyric: '#ecd9cf', bar: '#b07a6e', hl: '#5b2420', hlChord: '#ffd2c2', hlLyric: '#ffffff', hlBar: '#ffb4a2', rngA: '#ffa07a', rngB: '#ffd27f', now: '#ffd23f', nowFg: '#1a1100' } },
  { id: 'blue', name: 'ブルー(夜のステージ)', theme: 'dark', colors: { bg: '#0a1633', chord: '#7de3ff', lyric: '#e8efff', bar: '#8aa0d0', hl: '#2450c8', hlChord: '#fff3b0', hlLyric: '#ffffff', hlBar: '#c3d3ff', rngA: '#5eead4', rngB: '#93c5fd', now: '#ffd23f', nowFg: '#1a1100' } },
  { id: 'green', name: 'グリーン(黒板風)', theme: 'dark', colors: { bg: '#0f2217', chord: '#ffe08a', lyric: '#e9f5ec', bar: '#86ad92', hl: '#2c6b46', hlChord: '#ffeaa8', hlLyric: '#ffffff', hlBar: '#c4e8d1', rngA: '#fde68a', rngB: '#a7f3d0', now: '#ffd23f', nowFg: '#1a1100' } },
  { id: 'paper', name: 'ペーパー(明るい場所)', theme: 'light', colors: { bg: '#fafaf7', chord: '#0a58c2', lyric: '#1c1c1c', bar: '#555b66', hl: '#ffe08a', hlChord: '#0b3b94', hlLyric: '#2b1d00', hlBar: '#5b4300', rngA: '#059669', rngB: '#2563eb', now: '#b3200a', nowFg: '#ffffff' } },
];
const VIEW_DEFAULT = { sort: 'updated', group: 'none', style: 'browse', filter: 'all', tab: 'songs', fields: { artist: true, key: true, capo: true, bpm: false, tags: true, transpose: true, site: true } };
settings.keys = { ...DEFAULT_KEYS, ...(settings.keys || {}) };
settings.view = { ...VIEW_DEFAULT, ...(settings.view || {}), fields: { ...VIEW_DEFAULT.fields, ...((settings.view || {}).fields || {}) } };
// 設定の同期: 端末ごとに違うもの(文字サイズ・開いているタブ)は除く。変えた時刻(cs.settingsAt)が新しい方を採用する
const syncSettings = () => { const { fontSize, ...r } = settings; const { tab, ...v } = settings.view || {}; return { ...r, view: v }; };
let lastSettingsStr = JSON.stringify(syncSettings());
const getSettingsAt = () => Number(localStorage.getItem('cs.settingsAt') || 0);
if (!settings.view.browseSeen) { settings.view.style = 'browse'; settings.view.browseSeen = true; } // 曲リストを、アーティスト一覧+曲リストの表示にする(一度だけ。「表示」でいつでも戻せる)
const RANGE_STYLES = [['bracket', '括弧(上と左)'], ['box', '四角い枠'], ['fill', '色で塗る'], ['under', '下線'], ['left', '左の縦線だけ']];
function applyRangeClass() {
  const sc = document.querySelector('#score');
  if (!sc) return;
  [...sc.classList].filter((c) => c.startsWith('rs-')).forEach((c) => sc.classList.remove(c));
  sc.classList.add('rs-' + (settings.rangeOn ? settings.rangeStyle : 'off'));
  const b = document.querySelector('#btnRange');
  if (b) b.classList.toggle('on', settings.rangeOn);
}
function applySettings() {
  document.documentElement.dataset.theme = settings.theme;
  applyRangeClass();
  document.documentElement.style.setProperty('--fs', settings.fontSize + 'px');
  document.documentElement.style.setProperty('--ly', settings.lyricScale);
  document.documentElement.style.setProperty('--cs', settings.chordScale);
  // 自分で指定した色。未指定(空)の項目は、テーマの標準色のまま
  Object.entries(COLOR_VARS).forEach(([k, v]) => {
    const c = settings.colors && settings.colors[k];
    if (c) document.documentElement.style.setProperty(v, c); else document.documentElement.style.removeProperty(v);
  });
  try { localStorage.setItem('cs.settings', JSON.stringify(settings)); } catch {}
  const str = JSON.stringify(syncSettings());
  if (str !== lastSettingsStr) {
    lastSettingsStr = str;
    try { localStorage.setItem('cs.settingsAt', String(Date.now())); } catch {}
    if (typeof scheduleSync === 'function') scheduleSync();
  }
}
// ほかの端末の設定を、この端末へ反映する
function adoptSettings(inc) {
  const keep = { fontSize: settings.fontSize, tab: settings.view.tab };
  Object.keys(settings).forEach((k) => delete settings[k]);
  Object.assign(settings, defaults, inc);
  settings.keys = { ...DEFAULT_KEYS, ...(settings.keys || {}) };
  settings.view = { ...VIEW_DEFAULT, ...(settings.view || {}), fields: { ...VIEW_DEFAULT.fields, ...((settings.view || {}).fields || {}) }, tab: keep.tab };
  settings.fontSize = keep.fontSize;
  lastSettingsStr = JSON.stringify(syncSettings());
  applySettings();
  updateAutoFitBtn();
  if (!$('#player').classList.contains('hidden')) refit();
}

// ダイアログ(モーダル)の上にも出せるよう、ポップオーバー(最前面)で表示する
// 画面を開いたとき、入力欄に自動でカーソルが入らないようにする(キーボードが勝手に出ない)。タップしたときだけ入力できる
const nativeShowModal = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function () {
  nativeShowModal.call(this);
  const a = document.activeElement;
  if (a && this.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) {
    this.tabIndex = -1;
    this.focus({ preventScroll: true });
  }
};
// ダイアログ(モーダル)の上にも出せるよう、ポップオーバー(最前面)で表示する
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  try { if (!t.matches(':popover-open')) t.showPopover(); } catch {}
  clearTimeout(toast.t);
  toast.t = setTimeout(() => {
    t.classList.add('hidden');
    try { t.hidePopover(); } catch {}
  }, 3500);
}

// ---------- 画面の切り替え ----------
// library(曲/セットリスト一覧) / setView(セットリストの中身) / player(譜面)
function showView(name) {
  ['library', 'setView', 'player'].forEach((id) => $('#' + id).classList.toggle('hidden', id !== name));
  if (name !== 'player') { stopAuto(); releaseAwake(); if (pendingSync) setTimeout(() => autoSync('later'), 1500); }
}

// ---------- 削除の記録(同期で、消した曲が復活しないように) ----------
const getTomb = () => { try { return JSON.parse(localStorage.getItem('cs.tomb') || '{}'); } catch { return {}; } };
const markDeleted = (id) => { const t = getTomb(); t[id] = Date.now(); try { localStorage.setItem('cs.tomb', JSON.stringify(t)); } catch {} };

// ---------- ライブラリ ----------
let songs = [];  // 通常の曲
let trash = [];  // 削除した曲(あとで戻せる)
let setlists = [];
async function loadLibrary() {
  const all = await db.allSongs();
  songs = all.filter((x) => !x.deletedAt);
  trash = all.filter((x) => x.deletedAt).sort((x, y) => y.deletedAt - x.deletedAt);
  setlists = (await db.allSetlists()).sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
  renderLibrary();
  renderSets();
  renderTrash();
}
const tagsOf = (s) => (s.tags || []).filter(Boolean);
const initialOf = (s) => {
  const c = ((s.title || '').trim()[0] || '#');
  const kana = c.replace(/[ァ-ヶ]/g, (m) => String.fromCharCode(m.charCodeAt(0) - 0x60)); // カタカナ→ひらがな
  return /[A-Za-z]/.test(kana) ? kana.toUpperCase() : /[0-9０-９]/.test(kana) ? '0-9' : kana;
};
const ja = (a, b) => String(a).localeCompare(String(b), 'ja');
const SORTS = {
  fav: (a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0),
  updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
  created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
  title: (a, b) => ja(a.title, b.title),
  artist: (a, b) => ja(a.artist || '￿', b.artist || '￿') || ja(a.title, b.title),
  key: (a, b) => ja(a.key || '￿', b.key || '￿') || ja(a.title, b.title),
};
const GROUPS = {
  status: (s) => [...(s.fav ? ['★ お気に入り'] : []), ...(s.practice ? ['練習中'] : []), ...(!s.fav && !s.practice ? ['(印なし)'] : [])],
  artist: (s) => [s.artist || '(アーティスト不明)'],
  initial: (s) => [initialOf(s)],
  key: (s) => [s.key || '(キー不明)'],
  site: (s) => [siteOf(s)],
  tags: (s) => (tagsOf(s).length ? tagsOf(s) : ['(タグなし)']),
};

// 取り込み元のサイト名(曲のURLから判定)。URLがなければ「貼り付け」
const SITES = [[/chordwiki\.org/, 'ChordWiki'], [/ufret\.jp/, 'U-FRET'], [/chord-rinne\.jp/, 'リンネ'], [/j-total\.net/, 'J-Total'], [/ultimate-guitar\.com/, 'Ultimate Guitar'], [/gakufu\.gakki\.me|gakki\.me/, 'ギタ譜'], [/piascore|print-gakufu/, 'ぷりんと楽譜']];
function siteOf(s) {
  const u = (s.url || '').trim();
  if (!u) return '貼り付け・手入力';
  const hit = SITES.find(([re]) => re.test(u));
  if (hit) return hit[1];
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'その他'; }
}
function songMeta(s) {
  const f = settings.view.fields;
  const parts = [];
  if (f.artist && s.artist) parts.push(s.artist);
  if (f.key && s.key) parts.push('Key ' + s.key);
  if (f.capo && s.capo) parts.push('Capo ' + s.capo);
  if (f.bpm && s.bpm) parts.push('BPM ' + s.bpm);
  if (f.transpose && s.transpose) parts.push('移調 ' + (s.transpose > 0 ? '+' : '') + s.transpose);
  return parts.join(' / ');
}
// 曲のカード。カード全体をタップすると曲が開く。右端の「⋯」でメニュー、左の★でお気に入りの切り替え
function songItem(s) {
  const li = el('li', 'song');
  const star = el('button', 'starbtn' + (s.fav ? ' on' : ''), s.fav ? '★' : '☆');
  star.type = 'button'; star.title = 'お気に入り';
  star.onclick = (e) => { e.stopPropagation(); toggleFlag(s, 'fav'); };
  const box = el('div', 'grow');
  const head = el('div', 'songhead');
  head.append(el('b', '', s.title || '無題'));
  if (s.practice) head.append(el('span', 'badge practice', '練習中'));
  if (settings.view.fields.site) head.append(el('span', 'badge site', siteOf(s)));
  box.append(head);
  const m = songMeta(s);
  if (m) box.append(el('small', '', m));
  if (settings.view.fields.tags && tagsOf(s).length) box.append(el('small', 'tags', tagsOf(s).map((t) => '#' + t).join(' ')));
  const menu = el('button', 'menubtn', '⋯');
  menu.type = 'button'; menu.title = 'メニュー';
  menu.onclick = (e) => { e.stopPropagation(); openSongMenu(s); };
  li.append(star, box, menu);
  li.onclick = () => openSong(s.id);
  return li;
}
async function toggleFlag(s, key) {
  s[key] = !s[key];
  s.updatedAt = Date.now();
  await db.putSong(s);
  await loadLibrary();
}
// ---- アーティスト一覧 → 曲リスト(Musicアプリ風) ----
let browseSel = '__all'; // 選んでいるアーティスト(__all: すべての曲)
let browseOpen = false;  // 幅が狭いとき、曲リストを開いているか
const ARTIST_NONE = '(アーティスト不明)';
const artistOf = (s) => (s.artist || '').trim() || ARTIST_NONE;
const hueOf = (t) => { let h = 0; for (const c of t) h = (h * 31 + c.codePointAt(0)) % 360; return h; };
function avatar(name, cls = '') {
  const a = el('span', 'avatar ' + cls, name === '__all' ? '♫' : [...name.replace(/^[\s(（]+/, '')][0] || '♪');
  a.style.setProperty('--h', name === '__all' ? 40 : hueOf(name));
  return a;
}
function renderBrowse(list, ul) {
  const byArtist = new Map();
  list.forEach((s) => { const a = artistOf(s); if (!byArtist.has(a)) byArtist.set(a, []); byArtist.get(a).push(s); });
  if (browseSel !== '__all' && !byArtist.has(browseSel)) browseSel = '__all';
  const nav = $('#artistList');
  nav.textContent = '';
  const row = (key, label, n) => {
    const b = el('button', 'artist' + (key === browseSel ? ' on' : ''));
    b.type = 'button';
    const t = el('span', 'at');
    t.append(el('b', '', label), el('small', '', n + '曲'));
    b.append(avatar(key), t, el('i', 'chev', '›'));
    b.onclick = () => { browseSel = key; browseOpen = true; renderBrowse(list, ul); $('#browseSongs').scrollTop = 0; };
    return b;
  };
  nav.append(row('__all', 'すべての曲', list.length));
  const names = [...byArtist.keys()].sort((a, b) => (a === ARTIST_NONE) - (b === ARTIST_NONE) || ja(a, b));
  let last = '';
  names.forEach((n) => {
    const ini = n === ARTIST_NONE ? '#' : initialOf({ title: n });
    if (ini !== last) { nav.append(el('div', 'ainit', ini)); last = ini; }
    nav.append(row(n, n, byArtist.get(n).length));
  });
  const songsOf = browseSel === '__all' ? list : byArtist.get(browseSel) || [];
  const head = $('#bsHead');
  head.textContent = '';
  const back = el('button', 'bsback', '‹ アーティスト');
  back.type = 'button';
  back.onclick = () => { browseOpen = false; renderBrowse(list, ul); };
  const meta = el('div', 'bsmeta');
  meta.append(el('small', '', browseSel === '__all' ? 'ライブラリ' : 'アーティスト'), el('h2', '', browseSel === '__all' ? 'すべての曲' : browseSel), el('span', '', songsOf.length + '曲'));
  head.append(back, avatar(browseSel, 'big'), meta);
  head.style.setProperty('--h', browseSel === '__all' ? 40 : hueOf(browseSel));
  $('#browse').classList.toggle('open', browseOpen);
  ul.textContent = '';
  songsOf.forEach((s) => ul.append(songItem(s)));
  if (!songsOf.length) ul.append(el('li', 'grp', '該当する曲がありません'));
}
function renderLibrary() {
  const v = settings.view;
  const q = $('#search').value.trim().toLowerCase();
  const ul = $('#songList');
  ul.textContent = '';
  ul.className = v.style === 'standard' ? '' : v.style;
  $('#vSort').value = v.sort; $('#vGroup').value = v.group; $('#vStyle').value = v.style; $('#vFilter').value = v.filter;
  document.querySelectorAll('[data-vf]').forEach((c) => { c.checked = !!v.fields[c.dataset.vf]; });
  const list = songs
    .filter((s) => v.filter === 'all' || (v.filter === 'fav' ? s.fav : s.practice))
    .filter((s) => !q || (s.title + ' ' + (s.artist || '') + ' ' + tagsOf(s).join(' ')).toLowerCase().includes(q))
    .sort(SORTS[v.sort] || SORTS.updated);
  const inBrowse = v.style === 'browse';
  $('#songsPane').classList.toggle('browsing', inBrowse);
  $('#browse').classList.toggle('hidden', !inBrowse);
  if (inBrowse) {
    ul.className = '';
    $('#browseSongs').append(ul);
    renderBrowse(list, ul);
    $('#emptyMsg').textContent = songs.length ? '' : 'まだ曲がありません。「＋ 曲を追加」からChordWikiのコード譜を貼り付けてください。';
    return;
  }
  if (ul.parentElement !== $('#songsPane')) $('#songsPane').insertBefore(ul, $('#emptyMsg'));
  if (v.group === 'none') list.forEach((s) => ul.append(songItem(s)));
  else {
    const groups = new Map();
    list.forEach((s) => GROUPS[v.group](s).forEach((g) => { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); }));
    [...groups.keys()].sort(ja).forEach((g) => {
      ul.append(el('li', 'grp', g + '(' + groups.get(g).length + ')'));
      groups.get(g).forEach((s) => ul.append(songItem(s)));
    });
  }
  $('#emptyMsg').textContent = songs.length ? (list.length ? '' : '該当する曲がありません') : 'まだ曲がありません。「＋ 曲を追加」からChordWikiのコード譜を貼り付けてください。';
}
$('#search').oninput = renderLibrary;
['vSort', 'vGroup', 'vStyle', 'vFilter'].forEach((id) => $('#' + id).addEventListener('change', () => {
  settings.view[{ vSort: 'sort', vGroup: 'group', vStyle: 'style', vFilter: 'filter' }[id]] = $('#' + id).value;
  applySettings();
  renderLibrary();
}));
document.querySelectorAll('[data-vf]').forEach((c) => c.addEventListener('change', () => {
  settings.view.fields[c.dataset.vf] = c.checked;
  applySettings();
  renderLibrary();
}));
function setTab(t) {
  settings.view.tab = t;
  applySettings();
  $('#tabSongs').classList.toggle('on', t === 'songs');
  $('#tabSets').classList.toggle('on', t === 'sets');
  $('#tabTrash').classList.toggle('on', t === 'trash');
  $('#songsPane').classList.toggle('hidden', t !== 'songs');
  $('#setsPane').classList.toggle('hidden', t !== 'sets');
  $('#trashPane').classList.toggle('hidden', t !== 'trash');
}
$('#tabSongs').onclick = () => setTab('songs');
$('#tabSets').onclick = () => setTab('sets');
$('#tabTrash').onclick = () => setTab('trash');

// ---------- 曲の操作(カードの「⋯」で出るメニュー) ----------
let menuSong = null;
function openSongMenu(s) {
  menuSong = s;
  $('#smTitle').textContent = s.title || '無題';
  $('#smMeta').textContent = [s.artist, s.key && 'Key ' + s.key, '出典: ' + siteOf(s)].filter(Boolean).join(' / ');
  $('#smFav').textContent = s.fav ? '★ お気に入りを解除' : '☆ お気に入りに追加';
  $('#smPractice').textContent = s.practice ? '練習中を解除' : '練習中にする';
  $('#songMenu').showModal();
}
const smDo = (fn) => () => { $('#songMenu').close(); fn(menuSong); };
$('#smOpen').onclick = smDo((s) => openSong(s.id));
$('#smFav').onclick = smDo((s) => toggleFlag(s, 'fav'));
$('#smPractice').onclick = smDo((s) => toggleFlag(s, 'practice'));
$('#smRename').onclick = smDo((s) => openRename(s));
$('#smSet').onclick = smDo((s) => openAddSet(s));
$('#smDup').onclick = smDo((s) => dupSong(s));
$('#smDelete').onclick = smDo((s) => trashSong(s));
function openRename(s) {
  menuSong = s;
  $('#rnTitle').value = s.title || '';
  $('#rnArtist').value = s.artist || '';
  $('#rnTags').value = tagsOf(s).join(',');
  $('#renameDlg').showModal();
}
const parseTags = (txt) => [...new Set(txt.split(/[,、，\s]+/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean))];
$('#rnSave').onclick = async () => {
  const s = menuSong;
  s.title = $('#rnTitle').value.trim() || '無題';
  s.artist = $('#rnArtist').value.trim();
  s.tags = parseTags($('#rnTags').value);
  s.updatedAt = Date.now();
  await db.putSong(s);
  $('#renameDlg').close();
  await loadLibrary();
  toast('変更しました');
};
async function dupSong(s) {
  const c = JSON.parse(JSON.stringify(s));
  c.id = uid(); c.title = (c.title || '無題') + '(コピー)'; c.createdAt = c.updatedAt = Date.now();
  await db.putSong(c);
  await loadLibrary();
  toast('複製しました');
}
// 削除は、まず「削除した曲」に移す(あとで戻せる)。完全に削除するのは、そこから
async function trashSong(s) {
  s.deletedAt = Date.now();
  s.updatedAt = Date.now();
  await db.putSong(s);
  await loadLibrary();
  toast('「' + (s.title || '無題') + '」を削除した曲に移しました');
}
async function restoreSong(s) {
  delete s.deletedAt;
  s.updatedAt = Date.now();
  await db.putSong(s);
  await loadLibrary();
  toast('「' + (s.title || '無題') + '」を元に戻しました');
}
// 完全に削除(元に戻せない)。ほかの端末にも「削除」が伝わる
async function deleteSongById(id) {
  await db.deleteSong(id);
  markDeleted(id);
  for (const set of setlists.filter((x) => x.songIds.includes(id))) {
    set.songIds = set.songIds.filter((x) => x !== id);
    set.updatedAt = Date.now();
    await db.putSetlist(set);
  }
}
function renderTrash() {
  const ul = $('#trashList');
  ul.textContent = '';
  trash.forEach((s) => {
    const li = el('li');
    const box = el('div', 'grow');
    box.append(el('b', '', s.title || '無題'));
    box.append(el('small', '', [s.artist, '削除: ' + new Date(s.deletedAt).toLocaleDateString('ja-JP')].filter(Boolean).join(' / ')));
    li.append(box);
    const back = el('button', '', '戻す');
    back.type = 'button';
    back.onclick = () => restoreSong(s);
    const gone = el('button', 'danger', '完全に削除');
    gone.type = 'button';
    gone.onclick = async () => {
      if (!confirm('「' + (s.title || '無題') + '」を完全に削除します。元に戻せません。よろしいですか?')) return;
      await deleteSongById(s.id);
      await loadLibrary();
      toast('完全に削除しました');
    };
    li.append(back, gone);
    ul.append(li);
  });
  $('#trashEmpty').textContent = trash.length ? '' : '削除した曲はありません。曲を左へスワイプして「削除」を押すと、ここに入ります。';
  $('#trashAll').classList.toggle('hidden', !trash.length);
  $('#tabTrash').textContent = '削除した曲' + (trash.length ? '(' + trash.length + ')' : '');
}
$('#trashAll').onclick = async () => {
  if (!confirm('削除した曲 ' + trash.length + '件を、すべて完全に削除します。元に戻せません。よろしいですか?')) return;
  for (const s of [...trash]) await deleteSongById(s.id);
  await loadLibrary();
  toast('削除した曲を空にしました');
};

// ---------- セットリスト ----------
let curSetId = null;
let nameDlgDone = null;
// 当日の担当(パート)。入力した名前のものだけ表示する
const PARTS = ['Vo.', 'Gt.', 'Ba.', 'Dr.', 'Key.', 'Other'];
const partOrder = (m) => PARTS.indexOf(m.part);
function addMemberRow(box, m = {}) {
  const row = el('div', 'mrow');
  const sel = el('select', 'mpart');
  PARTS.forEach((p) => { const o = el('option', '', p); o.value = p; sel.append(o); });
  const used = [...box.querySelectorAll('.mpart')].map((x) => x.value);
  sel.value = m.part || PARTS.find((p) => !used.includes(p)) || 'Other';
  const name = el('input', 'mname');
  name.placeholder = '名前'; name.value = m.name || '';
  const label = el('input', 'mlabel');
  label.placeholder = '役割(例: Cho.)'; label.value = m.label || '';
  const sync = () => label.classList.toggle('hidden', sel.value !== 'Other');
  sel.onchange = sync;
  sync();
  const del = el('button', 'danger', '✕');
  del.type = 'button'; del.title = 'この担当を外す';
  del.onclick = () => row.remove();
  row.append(sel, name, label, del);
  box.append(row);
}
$('#ndAddMember').onclick = () => addMemberRow($('#ndMembers'));
const readMembers = (box) => [...box.querySelectorAll('.mrow')]
  .map((r) => ({ part: r.querySelector('.mpart').value, name: r.querySelector('.mname').value.trim(), label: r.querySelector('.mlabel').value.trim() }))
  .filter((m) => m.name)
  .sort((a, b) => partOrder(a) - partOrder(b));
const collectMembers = () => readMembers($('#ndMembers'));
const memberText = (m) => (m.part === 'Other' && m.label ? m.label : m.part) + ' ' + m.name;
// セットリストのメンバー表(set.members: パートごとに複数人)から、曲ごとに担当を選ぶ(set.songMembers[曲ID])
const ownMembers = (set, id) => (set.songMembers && set.songMembers[id]) || null;
const membersFor = (set, id) => ownMembers(set, id) || [];
const memKey = (m) => [m.part, m.name, m.label || ''].join('|');
function memberChips(members, cls = '') {
  const row = el('div', 'chiprow members ' + cls);
  (members || []).forEach((m) => row.append(el('span', 'chip member', memberText(m))));
  return row;
}

function askName(title, initial, done, date = '', members = []) {
  $('#ndTitle').textContent = title;
  $('#ndName').value = initial || '';
  $('#ndDate').value = date || '';
  $('#ndMembers').textContent = '';
  members.forEach((m) => addMemberRow($('#ndMembers'), m));
  nameDlgDone = done;
  $('#nameDlg').showModal();
}
$('#ndSave').onclick = async () => {
  const name = $('#ndName').value.trim();
  if (!name) return toast('名前を入力してください');
  $('#nameDlg').close();
  await nameDlgDone(name, $('#ndDate').value, collectMembers());
};
async function createSet(name, songIds = [], date = '', members = []) {
  const set = { id: uid(), name, date, members, songIds, createdAt: Date.now(), updatedAt: Date.now() };
  await db.putSetlist(set);
  await loadLibrary();
  return set;
}
// 本番日(YYYY-MM-DD)の表示。カレンダーで選んだ日付を、曜日つきで見せる
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const toDate = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd); };
const fmtDate = (d) => { if (!d) return ''; const t = toDate(d); return `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')}(${WEEK[t.getDay()]})`; };
const daysUntil = (d) => { const n = new Date(); n.setHours(0, 0, 0, 0); return Math.round((toDate(d) - n) / 86400000); };
const dateBadge = (d) => { if (!d) return ''; const n = daysUntil(d); return n > 0 ? 'あと' + n + '日' : n === 0 ? '本番当日' : '終了'; };
// 並び順: これから(近い順) → 日付なし(更新順) → 終了(新しい順)
const setRank = (x) => (!x.date ? 1 : daysUntil(x.date) >= 0 ? 0 : 2);
const setSort = (a, b) => setRank(a) - setRank(b) || (setRank(a) === 0 ? a.date.localeCompare(b.date) : setRank(a) === 2 ? b.date.localeCompare(a.date) : (b.updatedAt || 0) - (a.updatedAt || 0));

function renderSets() {
  const ul = $('#setList');
  ul.textContent = '';
  [...setlists].sort(setSort).forEach((set) => {
    const li = el('li');
    const box = el('div', 'grow');
    box.append(el('b', '', set.name));
    const n = set.songIds.filter((id) => songs.some((x) => x.id === id)).length;
    box.append(el('small', '', [set.date && '本番 ' + fmtDate(set.date), n + '曲'].filter(Boolean).join(' ・ ')));
    li.append(box);
    if ((set.members || []).length) box.append(memberChips(set.members));
    if (set.date) li.append(el('span', 'datebadge ' + (daysUntil(set.date) < 0 ? 'past' : daysUntil(set.date) === 0 ? 'today' : ''), dateBadge(set.date)));
    li.onclick = () => openSetView(set.id);
    ul.append(li);
  });
  $('#setEmpty').textContent = setlists.length ? '' : 'セットリストがありません。「＋ 新しいセットリスト」で、ライブや練習などの用途ごとに曲を並べられます。';
}
$('#setNew').onclick = () => askName('新しいセットリスト', '', async (name, date, members) => { const set = await createSet(name, [], date, members); openSetView(set.id); });

function openSetView(id) {
  curSetId = id;
  if (!(history.state && history.state.v === 'set')) history.pushState({ v: 'set' }, '');
  showView('setView');
  renderSetView();
}
let svSelectMode = false;
const svSel = new Set();
function renderSetView() {
  const set = setlists.find((x) => x.id === curSetId);
  if (!set) { showView('library'); return; }
  $('#svSelect').classList.toggle('on', svSelectMode);
  $('#svBar').classList.toggle('hidden', !svSelectMode);
  $('#svTitle').textContent = set.name;
  const items = set.songIds.map((id) => songs.find((s) => s.id === id)).filter(Boolean);
  const mbox = $('#svMembers');
  mbox.textContent = '';
  if ((set.members || []).length) { mbox.append(el('small', 'mlabelsmall', 'メンバー表(曲ごとに、この中から担当を選びます)')); mbox.append(memberChips(set.members)); }
  $('#svMeta').textContent = [set.date && '本番 ' + fmtDate(set.date) + '(' + dateBadge(set.date) + ')', items.length + '曲'].filter(Boolean).join(' ・ ');
  const ol = $('#svList');
  ol.textContent = '';
  items.forEach((song, i) => {
    const li = el('li');
    li.dataset.id = song.id;
    if (svSelectMode) {
      const cb = el('input', 'svcb');
      cb.type = 'checkbox'; cb.checked = svSel.has(song.id);
      cb.onclick = (e) => e.stopPropagation();
      cb.onchange = () => { if (cb.checked) svSel.add(song.id); else svSel.delete(song.id); updateSvBar(); };
      li.append(cb);
      li.append(el('span', 'ord', '')); // タップした順番(updateSvBar で更新)
    } else {
      const grip = el('span', 'drag', '⠿'); // つかんで上下にドラッグすると、順番を入れ替えられる
      grip.title = 'ドラッグして並べ替え';
      li.append(grip);
    }
    li.append(el('span', 'no', String(i + 1)));
    const box = el('div', 'grow');
    box.append(el('b', '', song.title));
    const m = [song.artist, song.key && 'Key ' + song.key].filter(Boolean).join(' / ');
    if (m) box.append(el('small', '', m));
    li.append(box);
    const mk = (label, title, fn, cls) => {
      const b = el('button', cls || '', label);
      b.type = 'button'; b.title = title;
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      return b;
    };
    const ov = set.overrides && set.overrides[song.id];
    const kc = [ov && ov.transpose != null ? '移調 ' + (ov.transpose > 0 ? '+' : '') + ov.transpose + (song.key ? '(' + transposeChord(song.key, ov.transpose, song.accidental || 'auto') + ')' : '') : '', ov && ov.capo != null ? 'Capo ' + ov.capo : ''].filter(Boolean).join(' / ');
    if (kc) box.append(el('small', 'keyinfo', 'このセット: ' + kc));
    const own = ownMembers(set, song.id);
    if (own && own.length) box.append(memberChips(own));
    li.append(
      mk('担当', 'この曲の担当', () => openSongMembers([song.id])),
      mk('キー', 'キー・カポ(このセットリストだけ)', () => openKeyDlg(song)),
      mk('▲', '上へ', () => moveInSet(song.id, -1)),
      mk('▼', '下へ', () => moveInSet(song.id, 1)),
      mk('✕', 'セットリストから外す', () => removeFromSet(song.id), 'danger'),
    );
    li.onclick = () => {
      if (svSelectMode) { const cb = li.querySelector('.svcb'); cb.checked = !cb.checked; cb.onchange(); return; }
      openSong(song.id, { setId: set.id });
    };
    ol.append(li);
  });
  if (!svSelectMode) enableDrag(ol);
  updateSvBar();
  $('#svEmpty').textContent = items.length ? '' : 'まだ曲がありません。「＋ 曲を追加」で、ライブラリから選んで追加します。';
}
// 複数の曲を選んで、担当をまとめて設定する
function updateSvBar() {
  const order = [...svSel]; // Set は、入れた順(=タップした順)を覚えている
  $('#svCount').textContent = svSel.size + '曲を選択中(タップした順に番号が付きます)';
  ['svBulk', 'svBulkReset', 'svOrder', 'svRemove'].forEach((id) => { $('#' + id).disabled = !svSel.size; });
  document.querySelectorAll('#svList li').forEach((li) => {
    const o = li.querySelector('.ord');
    if (!o) return;
    const n = order.indexOf(li.dataset.id) + 1;
    o.textContent = n || '';
    o.classList.toggle('on', !!n);
  });
}
// 並べ替え(ドラッグ): 左端の「⠿」をつかんで、上下に動かす。指を離した位置で順番が決まる
function enableDrag(ol) {
  ol.querySelectorAll('.drag').forEach((grip) => {
    grip.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      const li = grip.closest('li');
      const scroller = ol.closest('.libbody');
      let startY = e.clientY;
      let lastY = e.clientY;
      li.classList.add('dragging');
      const place = () => { li.style.transform = `translateY(${lastY - startY}px)`; };
      const reorder = () => {
        for (;;) {
          const r = li.getBoundingClientRect();
          const mid = (r.top + r.bottom) / 2;
          const prev = li.previousElementSibling;
          const next = li.nextElementSibling;
          const before = li.offsetTop;
          if (next && mid > (next.getBoundingClientRect().top + next.getBoundingClientRect().bottom) / 2) ol.insertBefore(next, li);
          else if (prev && mid < (prev.getBoundingClientRect().top + prev.getBoundingClientRect().bottom) / 2) ol.insertBefore(li, prev);
          else break;
          startY += li.offsetTop - before; // 自然な位置が動いたぶん、基準を合わせる
          place();
        }
      };
      let scrollTimer = 0;
      const autoScroll = () => {
        const r = scroller.getBoundingClientRect();
        const dir = lastY < r.top + 60 ? -1 : lastY > r.bottom - 60 ? 1 : 0;
        if (dir) {
          const before = scroller.scrollTop;
          scroller.scrollTop += dir * 12;
          startY -= scroller.scrollTop - before; // スクロールしたぶん、つかんだ曲が指から離れないように基準を動かす
          place();
          reorder();
        }
      };
      const move = (ev) => { lastY = ev.clientY; place(); reorder(); };
      const up = async () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        clearInterval(scrollTimer);
        li.classList.remove('dragging');
        li.style.transform = '';
        const set = setlists.find((x) => x.id === curSetId);
        const ids = [...ol.children].map((c) => c.dataset.id);
        const rest = set.songIds.filter((id) => !ids.includes(id)); // 表示されていない曲は、末尾に残す
        const changed = ids.some((id, i) => id !== set.songIds[i]);
        if (changed) { set.songIds = [...ids, ...rest]; await saveSet(set); }
        renderSetView();
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
      scrollTimer = setInterval(autoScroll, 40);
      place();
    });
  });
}
$('#svSelect').onclick = () => { svSelectMode = !svSelectMode; svSel.clear(); renderSetView(); };
$('#svDone').onclick = () => { svSelectMode = false; svSel.clear(); renderSetView(); };
$('#svSelAll').onclick = () => {
  const set = setlists.find((x) => x.id === curSetId);
  const all = set.songIds.filter((id) => songs.some((x) => x.id === id));
  if (svSel.size === all.length) svSel.clear(); else all.forEach((id) => svSel.add(id));
  renderSetView();
};
$('#svBulk').onclick = () => openSongMembers([...svSel]);
// タップした順に並べ替える: 選んだ曲を、タップした順で先頭に置き、残りの曲はいまの順で続ける
$('#svOrder').onclick = async () => {
  const set = setlists.find((x) => x.id === curSetId);
  const picked = [...svSel].filter((id) => set.songIds.includes(id));
  set.songIds = [...picked, ...set.songIds.filter((id) => !svSel.has(id))];
  await saveSet(set);
  svSel.clear();
  renderSetView();
  toast('タップした順に、' + picked.length + '曲を先頭へ並べ替えました');
};
$('#svRemove').onclick = async () => {
  const set = setlists.find((x) => x.id === curSetId);
  if (!confirm('選んだ' + svSel.size + '曲を、セットリストから外します(曲そのものは消えません)。よろしいですか?')) return;
  set.songIds = set.songIds.filter((id) => !svSel.has(id));
  await saveSet(set);
  svSel.clear();
  renderSetView();
  toast('セットリストから外しました');
};
$('#svBulkReset').onclick = async () => {
  const set = setlists.find((x) => x.id === curSetId);
  if (set.songMembers) [...svSel].forEach((id) => delete set.songMembers[id]);
  await saveSet(set);
  renderSetView();
  toast('選んだ曲の担当を、メンバー表に戻しました');
};
// 曲ごとの担当の選択(1曲でも、選んだ複数曲でも使う)。候補は、セットリストのメンバー表
let memTargets = [];
let memPicked = new Set();
function openSongMembers(ids) {
  memTargets = ids;
  const set = setlists.find((x) => x.id === curSetId);
  const names = ids.map((id) => (songs.find((x) => x.id === id) || {}).title).filter(Boolean);
  $('#mdTitle').textContent = ids.length > 1 ? '選んだ' + ids.length + '曲の担当' : '「' + names[0] + '」の担当';
  $('#mdHint').textContent = ids.length > 1 ? 'メンバー表から選んだ人を、選んだすべての曲に設定します(曲ごとの既存の指定は置き換わります)。' : 'メンバー表から、この曲の担当をタップして選びます(同じパートで複数人も選べます)。';
  memPicked = new Set(ids.length === 1 ? membersFor(set, ids[0]).map(memKey) : []);
  $('#mdPart').textContent = '';
  PARTS.forEach((p) => { const o = el('option', '', p); o.value = p; $('#mdPart').append(o); });
  renderMemChips();
  $('#memDlg').showModal();
}
function renderMemChips() {
  const set = setlists.find((x) => x.id === curSetId);
  const box = $('#mdChips');
  box.textContent = '';
  const master = [...(set.members || [])].sort((a, b) => partOrder(a) - partOrder(b));
  if (!master.length) box.append(el('p', 'hint', 'メンバー表が空です。下の欄から、パートと名前を追加してください。'));
  PARTS.forEach((part) => {
    const group = master.filter((m) => m.part === part);
    if (!group.length) return;
    const row = el('div', 'mgrow');
    row.append(el('span', 'mgname', part));
    group.forEach((m) => {
      const b = el('button', 'mchip' + (memPicked.has(memKey(m)) ? ' on' : ''), (m.part === 'Other' && m.label ? m.label + ' ' : '') + m.name);
      b.type = 'button';
      b.onclick = () => { const k = memKey(m); if (memPicked.has(k)) memPicked.delete(k); else memPicked.add(k); renderMemChips(); };
      row.append(b);
    });
    box.append(row);
  });
}
$('#mdAddNew').onclick = async () => {
  const name = $('#mdName').value.trim();
  if (!name) return toast('名前を入力してください');
  const set = setlists.find((x) => x.id === curSetId);
  const m = { part: $('#mdPart').value, name, label: '' };
  if (!(set.members || []).some((x) => memKey(x) === memKey(m))) set.members = [...(set.members || []), m];
  await saveSet(set);
  memPicked.add(memKey(m));
  $('#mdName').value = '';
  renderMemChips();
};
$('#mdSave').onclick = async () => {
  const set = setlists.find((x) => x.id === curSetId);
  const members = (set.members || []).filter((m) => memPicked.has(memKey(m))).sort((a, b) => partOrder(a) - partOrder(b));
  set.songMembers = set.songMembers || {};
  memTargets.forEach((id) => { set.songMembers[id] = members; });
  await saveSet(set);
  $('#memDlg').close();
  renderSetView();
  toast(memTargets.length > 1 ? memTargets.length + '曲の担当を設定しました' : '担当を設定しました');
};
$('#mdReset').onclick = async () => {
  const set = setlists.find((x) => x.id === curSetId);
  if (set.songMembers) memTargets.forEach((id) => delete set.songMembers[id]);
  await saveSet(set);
  $('#memDlg').close();
  renderSetView();
  toast('担当の指定を消しました');
};
async function saveSet(set) {
  set.updatedAt = Date.now();
  await db.putSetlist(set);
  setlists = (await db.allSetlists()).sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
  renderSets();
}
// セットリストごとのキー・カポ
let keySong = null;
let keyTr = 0;
function openKeyDlg(song) {
  keySong = song;
  const set = setlists.find((x) => x.id === curSetId);
  const ov = (set.overrides && set.overrides[song.id]) || {};
  keyTr = ov.transpose != null ? ov.transpose : song.transpose || 0;
  $('#kdSong').textContent = song.title + (song.key ? '(原調 ' + song.key + ')' : '');
  $('#kdCapo').value = ov.capo != null ? ov.capo : song.capo || 0;
  updateKeyDlg();
  $('#keyDlg').showModal();
}
function updateKeyDlg() {
  $('#kdTr').textContent = keyTr ? (keyTr > 0 ? '+' : '') + keyTr : '原調';
  $('#kdResult').textContent = keySong.key ? 'このセットのキー: ' + transposeChord(keySong.key, keyTr, keySong.accidental || 'auto') : '';
}
$('#kdUp').onclick = () => { keyTr = wrap12(keyTr + 1); updateKeyDlg(); };
$('#kdDown').onclick = () => { keyTr = wrap12(keyTr - 1); updateKeyDlg(); };
$('#kdSave').onclick = async () => {
  const set = setlists.find((x) => x.id === curSetId);
  set.overrides = set.overrides || {};
  set.overrides[keySong.id] = { transpose: keyTr, capo: Math.max(0, Math.min(12, Number($('#kdCapo').value) || 0)) };
  await saveSet(set);
  $('#keyDlg').close();
  renderSetView();
};
$('#kdReset').onclick = async () => {
  const set = setlists.find((x) => x.id === curSetId);
  if (set.overrides) delete set.overrides[keySong.id];
  await saveSet(set);
  $('#keyDlg').close();
  renderSetView();
  toast('曲本来のキー・カポに戻しました');
};
async function moveInSet(songId, d) {
  const set = setlists.find((x) => x.id === curSetId);
  const ids = set.songIds.filter((id) => songs.some((s) => s.id === id));
  const i = ids.indexOf(songId);
  const j = i + d;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  set.songIds = ids;
  await saveSet(set);
  renderSetView();
}
async function removeFromSet(songId) {
  const set = setlists.find((x) => x.id === curSetId);
  set.songIds = set.songIds.filter((id) => id !== songId);
  await saveSet(set);
  renderSetView();
}
$('#svBack').onclick = () => { if (history.state && history.state.v === 'set') history.back(); else { showView('library'); } };
$('#svRename').onclick = () => {
  const set = setlists.find((x) => x.id === curSetId);
  askName('セットリストの名前・本番日・担当を変更', set.name, async (name, date, members) => { set.name = name; set.date = date; set.members = members;
    const keys = new Set(members.map(memKey)); // メンバー表から外した人は、曲ごとの担当からも外す
    Object.keys(set.songMembers || {}).forEach((id) => { set.songMembers[id] = set.songMembers[id].filter((m) => keys.has(memKey(m))); });
    await saveSet(set); renderSetView(); }, set.date, set.members || []);
};
$('#svDelete').onclick = async () => {
  const set = setlists.find((x) => x.id === curSetId);
  if (!confirm('セットリスト「' + set.name + '」を削除します(曲は消えません)。よろしいですか?')) return;
  await db.deleteSetlist(set.id);
  markDeleted(set.id);
  await loadLibrary();
  $('#svBack').click();
  toast('削除しました');
};
// 曲を選んで追加
$('#svAdd').onclick = () => { $('#pkSearch').value = ''; renderPick(); $('#pickDlg').showModal(); };
function renderPick() {
  const set = setlists.find((x) => x.id === curSetId);
  const q = $('#pkSearch').value.trim().toLowerCase();
  const ul = $('#pkList');
  const checked = new Set([...ul.querySelectorAll('input:checked')].map((i) => i.value));
  ul.textContent = '';
  songs.filter((s) => !set.songIds.includes(s.id) && (!q || (s.title + ' ' + (s.artist || '')).toLowerCase().includes(q))).sort(SORTS.title).forEach((s) => {
    const li = el('li');
    const lb = el('label');
    const cb = el('input');
    cb.type = 'checkbox'; cb.value = s.id; cb.checked = checked.has(s.id);
    lb.append(cb, el('span', '', s.title + (s.artist ? '  — ' + s.artist : '')));
    li.append(lb);
    ul.append(li);
  });
  if (!ul.children.length) ul.append(el('li', 'hint', '追加できる曲がありません'));
}
$('#pkSearch').oninput = renderPick;
$('#pkAdd').onclick = async () => {
  const ids = [...$('#pkList').querySelectorAll('input:checked')].map((i) => i.value);
  if (!ids.length) return toast('曲を選んでください');
  const set = setlists.find((x) => x.id === curSetId);
  set.songIds = [...set.songIds, ...ids];
  await saveSet(set);
  $('#pickDlg').close();
  renderSetView();
};
// 曲のメニューから、セットリストへ追加
function openAddSet(s) {
  menuSong = s;
  $('#asSong').textContent = '「' + menuSong.title + '」を追加するセットリストを選びます';
  const ul = $('#asList');
  ul.textContent = '';
  setlists.forEach((set) => {
    const li = el('li');
    const has = set.songIds.includes(menuSong.id);
    const b = el('button', '', set.name + (has ? '(追加済み)' : ''));
    b.type = 'button'; b.disabled = has;
    b.onclick = async () => { set.songIds = [...set.songIds, menuSong.id]; await saveSet(set); $('#addSetDlg').close(); toast('「' + set.name + '」に追加しました'); };
    li.append(b);
    ul.append(li);
  });
  $('#addSetDlg').showModal();
};
$('#asNew').onclick = () => {
  $('#addSetDlg').close();
  askName('新しいセットリスト', '', async (name, date, members) => { await createSet(name, [menuSong.id], date, members); toast('「' + name + '」を作って追加しました'); setTab('sets'); });
};

// ---------- 曲の追加 / 譜面編集 ----------
let editingId = null;
// 外をタップして閉じてしまっても、書きかけの内容は残す(保存した/キャンセルを押したときだけ消える)
let importDraft = null;
let importKeep = true;
function openImport(song) {
  editingId = song ? song.id : null;
  $('#importHead').textContent = song ? '譜面テキストを編集' : '曲を追加';
  $('#iTitle').value = song ? song.title : '';
  $('#iArtist').value = song ? song.artist : '';
  // 既存曲の編集では入力済みの曲名・アーティストを守る。新規追加では譜面から自動反映する
  ['#iTitle', '#iArtist'].forEach((id) => { if (song) $(id).dataset.touched = '1'; else delete $(id).dataset.touched; });
  $('#iUrl').value = song ? song.url || '' : '';
  $('#iText').value = song ? song.raw : '';
  $('#iQuery').value = '';
  $('#iInfo').textContent = '';
  importKeep = true;
  if (!song && importDraft) {
    $('#iTitle').value = importDraft.title; $('#iArtist').value = importDraft.artist; $('#iUrl').value = importDraft.url;
    $('#iText').value = importDraft.text; $('#iQuery').value = importDraft.query;
    ['#iTitle', '#iArtist'].forEach((id, i) => { if (importDraft.touched[i]) $(id).dataset.touched = '1'; });
    updateImportInfo();
  }
  $('#importDlg').showModal();
}
$('#importDlg').addEventListener('close', () => {
  if (editingId === null && importKeep && ($('#iText').value.trim() || $('#iTitle').value.trim())) {
    importDraft = { title: $('#iTitle').value, artist: $('#iArtist').value, url: $('#iUrl').value, text: $('#iText').value, query: $('#iQuery').value,
      touched: [!!$('#iTitle').dataset.touched, !!$('#iArtist').dataset.touched] };
  }
});
document.querySelector('#importForm button[value="cancel"]').addEventListener('click', () => { importKeep = false; importDraft = null; });
$('#btnImport').onclick = () => openImport(null);
$('#iSearch').onclick = () => {
  const q = $('#iQuery').value.trim() || $('#iTitle').value.trim();
  if (!q) return toast('曲名を入力してください');
  // ChordWiki内をWeb検索する(ChordWiki自体は自動取得できないため、結果は自分のブラウザで開く)
  window.open('https://www.google.com/search?q=' + encodeURIComponent('site:' + $('#iSite').value + ' ' + q), '_blank', 'noopener');
};
// 貼り付けたテキストを解析して、曲名・コード数を表示する
function updateImportInfo() {
  const raw = $('#iText').value;
  if (!raw.trim()) { $('#iInfo').textContent = ''; return; }
  const p = parseSong(raw);
  const chords = p.sections.reduce((n, sc) => n + sc.lines.reduce((m, l) => m + (l.segs ? l.segs.filter((g) => g.chord).length : 0), 0), 0);
  // 手で入力した欄は上書きしない。それ以外は、譜面の内容に合わせて自動で反映する
  if (!$('#iTitle').dataset.touched && p.title) $('#iTitle').value = p.title;
  if (!$('#iArtist').dataset.touched && p.artist) $('#iArtist').value = p.artist;
  $('#iInfo').textContent = chords
    ? `認識: ${p.title || '(曲名なし)'} / ${p.sections.length} セクション / ${chords} コード` + (p.key ? ' / Key ' + p.key : '') + (p.bpm ? ' / BPM ' + p.bpm : '')
    : 'コードを認識できません。ChordWikiの「編集」画面のソースをコピーしてください';
}
$('#iText').addEventListener('input', updateImportInfo);
['#iTitle', '#iArtist'].forEach((id) => $(id).addEventListener('input', () => { $(id).dataset.touched = '1'; }));
// ChordWikiでコピーしてアプリに戻ったとき、クリップボードに譜面があれば自動で貼り付ける
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !$('#importDlg').open || $('#iText').value.trim()) return;
  try {
    const t = await navigator.clipboard.readText();
    if (/\{\s*(title|t|c|comment)\s*:/i.test(t) || /\[[A-G][^\]]*\]/.test(t)) {
      $('#iText').value = t;
      updateImportInfo();
      toast('クリップボードの譜面を貼り付けました');
    }
  } catch {}
});
$('#iPaste').onclick = async () => {
  try { $('#iText').value = await navigator.clipboard.readText(); updateImportInfo(); } catch { toast('貼り付けできませんでした。入力欄を長押しして貼り付けてください'); }
};
// ---- PDFからの取り込み(pdf.jsをネット経由で必要なときだけ読み込む) ----
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
let pdfLib = null;
async function loadPdfJs() {
  if (pdfLib) return pdfLib;
  if (!navigator.onLine) throw new Error('PDFの読み取りには、ネット接続が必要です');
  await new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = PDFJS + 'pdf.min.js';
    sc.onload = resolve;
    sc.onerror = () => reject(new Error('PDFの読み取り部品を読み込めませんでした'));
    document.head.append(sc);
  });
  const worker = await (await fetch(PDFJS + 'pdf.worker.min.js')).text();
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([worker], { type: 'text/javascript' }));
  pdfLib = window.pdfjsLib;
  return pdfLib;
}
const wide = (str) => [...str].reduce((n, c) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠￠-￦]/.test(c) ? 2 : 1), 0);
const median = (arr) => { const x = [...arr].sort((p, q) => p - q); return x[Math.floor(x.length / 2)] || 0; };
// 文字の位置(座標)から、コード行と歌詞行の桁が揃ったテキストに組み直す
async function pdfToText(file) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let pn = 1; pn <= doc.numPages; pn++) {
    const tc = await (await doc.getPage(pn)).getTextContent();
    const items = tc.items.filter((i) => i.str && i.str.trim() !== '');
    if (!items.length) continue;
    const fs = median(items.map((i) => Math.hypot(i.transform[0], i.transform[1]) || i.height || 10)) || 10;
    // 半角1文字ぶんの幅: 文字の実際の幅(全角は2文字ぶんと数える)の中央値から求める。取れなければ文字サイズの半分
    const colW = median(items.map((i) => (i.width || 0) / wide(i.str)).filter((w) => w > 0)) || fs * 0.5;
    const left = Math.min(...items.map((i) => i.transform[4]));
    const rows = [];
    [...items].sort((p, q) => q.transform[5] - p.transform[5]).forEach((it) => {
      const y = it.transform[5];
      const row = rows.find((r) => Math.abs(r.y - y) <= fs * 0.45);
      if (row) row.items.push(it); else rows.push({ y, items: [it] });
    });
    const lines = [];
    let prevY = null;
    const gaps = rows.slice(1).map((r, i) => rows[i].y - r.y).filter((g) => g > 0);
    const lh = median(gaps) || fs * 1.2;
    rows.forEach((r) => {
      if (prevY !== null && prevY - r.y > lh * 1.7) lines.push(''); // 行間が大きければ空行
      prevY = r.y;
      let text = '';
      let endX = null;
      r.items.sort((p, q) => p.transform[4] - q.transform[4]).forEach((it) => {
        const x = it.transform[4];
        const gapCols = endX === null ? (x - left) / colW : (x - endX) / colW;
        if (endX === null) text += ' '.repeat(Math.max(0, Math.round(gapCols)));
        else if (gapCols > 0.6) text += ' '.repeat(Math.max(1, Math.round(gapCols)));
        text += it.str;
        endX = x + it.width;
      });
      lines.push(text.replace(/\s+$/, ''));
    });
    pages.push(lines.join('\n'));
  }
  return pages.join('\n\n');
}
$('#iFile').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    if (isPdf) toast('PDFを読み取っています…');
    $('#iText').value = isPdf ? await pdfToText(f) : await f.text();
    updateImportInfo();
    if (!$('#iTitle').value) $('#iTitle').value = f.name.replace(/\.[^.]+$/, '');
    if (isPdf) toast('PDFから文字を取り出しました。内容を確認してから保存してください');
  } catch (err) { toast(err.message || 'ファイルを読み込めませんでした'); }
};
// 譜面テキストから曲を保存する(新規 / 既存曲の更新)。成功したら曲を返す
async function commitSong(raw, meta, old) {
  const parsed = parseSong(raw, { title: meta.title, artist: meta.artist });
  const chordCount = parsed.sections.reduce((n, s) => n + s.lines.reduce((m, l) => m + (l.segs ? l.segs.filter((g) => g.chord).length : 0), 0), 0);
  if (!chordCount) { toast('コードを認識できませんでした。形式を確認してください'); return null; }
  const song = {
    id: old ? old.id : uid(),
    title: meta.title || parsed.title || '無題',
    artist: meta.artist || parsed.artist,
    key: old ? old.key : parsed.key,
    capo: old ? old.capo : parsed.capo,
    bpm: old ? old.bpm : parsed.bpm || 100,
    url: meta.url || '',
    raw,
    songMemo: old ? old.songMemo : parsed.note || '',
    memos: old ? old.memos : [],
    transpose: old ? old.transpose : 0,
    groupLines: old ? old.groupLines : DEFAULT_GROUP,
    createdAt: old ? old.createdAt : Date.now(),
    updatedAt: Date.now(),
  };
  await db.putSong(song);
  await loadLibrary();
  toast((old ? '更新しました(' : '保存しました(') + chordCount + ' コード)');
  return song;
}
$('#iSave').onclick = async () => {
  const raw = $('#iText').value;
  if (!raw.trim()) return toast('コード譜が空です');
  const old = editingId && songs.find((s) => s.id === editingId);
  const song = await commitSong(raw, { title: $('#iTitle').value.trim(), artist: $('#iArtist').value.trim(), url: $('#iUrl').value.trim() }, old);
  if (!song) return;
  importKeep = false;
  importDraft = null;
  $('#importDlg').close();
  openSong(song.id);
};

// ---------- ワンタップ取り込み(ブックマークレット) ----------
// ChordWikiの曲ページでこのブックマークを押すと、ブラウザ自身が「編集」画面のソースを読み取り、このアプリへ渡す。
// (読み取りはユーザーのブラウザの中で行われるので、コピー&貼り付けの操作が要らない)
function bookmarkletCode() {
  const app = location.origin + location.pathname.replace(/index\.html$/, '');
  // ページごとに、ブラウザの中で譜面を取り出す(ChordWikiは「編集」のソース / U-フレットは表示中のコード譜 / その他は選択した文字か<pre>)
  // 1) アプリのウィンドウから開いたページなら、そのウィンドウへ直接送る  2) 送れなければ、アプリのページへ移動して取り込む
  const code = `(async()=>{try{const H=location.hostname,O='${location.origin}',u=location.href.split('\\x23')[0];const big=(d,s)=>[...d.querySelectorAll(s)].sort((x,y)=>(y.value||y.textContent).length-(x.value||x.textContent).length)[0];let t='',ti='',ar='',kd='';
if(/chordwiki\\.org$/.test(H)){let v=(big(document,'textarea')||{}).value;if(!v||v.length<20){v='';const a=[...document.querySelectorAll('a')].find(x=>/編集/.test(x.textContent)||/edit/i.test(x.getAttribute('href')||''));if(!a){alert('「編集」リンクが見つかりません。ChordWikiの曲ページで押してください');return}const h=await(await fetch(a.href,{credentials:'include'})).text();const c=big(new DOMParser().parseFromString(h,'text/html'),'textarea');v=c&&c.value}t=v||''}
else if(/ufret\\.jp$/.test(H)){t=[...document.querySelectorAll('#my-chord-data > .row')].map(r=>[...r.querySelectorAll('.chord')].map(c=>{const rt=c.querySelector('rt'),k=c.cloneNode(true);k.querySelectorAll('rt,rp').forEach(n=>n.remove());const ch=rt?rt.textContent.trim():'';return(ch?'['+ch+']':'')+k.textContent}).join('')).filter(l=>l.trim()).join('\\n');const m=document.title.match(/^(.*?)\\s*\\/\\s*(.*?)\\s+ギター/);if(m){ti=m[1].trim();ar=m[2].trim()}}
else if(/chord-rinne\\.jp$/.test(H)){const tb=document.querySelector('table.lyric,#scrollfield');t=tb?tb.outerHTML:'';kd='rinne';const m=document.title.match(/^(.*?)\\s+-\\s+(.*?)\\s*\\|/);if(m){ti=m[1].trim();ar=m[2].trim()}}
else{const sl=String(getSelection()||'').trim(),p=big(document,'pre');t=sl.length>20?sl:(p?p.textContent:'');ti=document.title.split(/[|｜]/)[0].trim()}
if(!t||t.trim().length<5){alert('譜面を取り出せませんでした。譜面の文字を選択してから、もう一度押してください');return}
const note=m=>{const d=document.createElement('div');d.textContent=m;d.style.cssText='position:fixed;top:12px;left:12px;right:12px;margin:auto;width:fit-content;background:#111;color:#fff;padding:12px 18px;border-radius:10px;z-index:2147483647;font:16px sans-serif';document.body.append(d);setTimeout(()=>d.remove(),3000)};
const k=await new Promise(r=>{if(!window.opener||window.opener.closed)return r(null);const h=e=>{if(e.origin===O&&e.data&&e.data.cs==='ack'){removeEventListener('message',h);r(e.data)}};addEventListener('message',h);try{window.opener.postMessage({cs:1,raw:t,url:u,title:ti,artist:ar,kind:kd},O)}catch(x){return r(null)}setTimeout(()=>{removeEventListener('message',h);r(null)},1500)});
if(k){note('ChordStageに取り込みました: '+(k.title||''));return}
location.href='${app}\\x23import='+encodeURIComponent(t)+'&url='+encodeURIComponent(u)+'&title='+encodeURIComponent(ti)+'&artist='+encodeURIComponent(ar)+'&kind='+kd}catch(e){alert('取り込みに失敗しました: '+e.message)}})()`;
  return 'javascript:' + code.replace(/\n/g, '');
}
$('#bmCopy').onclick = async () => {
  try { await navigator.clipboard.writeText(bookmarkletCode()); toast('ブックマーク用のコードをコピーしました'); }
  catch { $('#bmText').value = bookmarkletCode(); $('#bmText').select(); toast('下の欄のコードをコピーしてください'); }
};
$('#bmLink').addEventListener('click', (e) => e.preventDefault());
$('#bmLink').href = bookmarkletCode();

// ブックマークレットから渡された譜面を、そのまま追加(同じURLの曲があれば更新)して開く
async function importFromHash() {
  if (!location.hash.startsWith('#import=')) return;
  const params = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  const raw = params.get('kind') === 'rinne' ? rinneToText(params.get('import') || '') : params.get('import') || '';
  const url = params.get('url') || '';
  if (!raw.trim()) return;
  const old = url && songs.find((s) => s.url === url);
  const song = await commitSong(raw, { title: old ? old.title : cleanTitle(params.get('title') || ''), artist: old ? old.artist : params.get('artist') || '', url }, old);
  if (song) openSong(song.id);
}
window.addEventListener('hashchange', importFromHash);

// 2画面で使う: アプリから開いたChordWikiのウィンドウでブックマークを押すと、ここへ譜面が届く
window.addEventListener('message', async (e) => {
  const d = e.data;
  if (!d || d.cs !== 1 || typeof d.raw !== 'string') return;
  if (d.raw.length > 2000000) return;
  if (!(e.origin === location.origin || /^https:\/\/([\w-]+\.)?chordwiki\.org$/.test(e.origin))) return;
  const old = d.url && songs.find((x) => x.url === d.url);
  const text = d.kind === 'rinne' ? rinneToText(d.raw) : d.raw.slice(0, 300000);
  const song = await commitSong(text, { title: old ? old.title : cleanTitle(String(d.title || '')), artist: old ? old.artist : String(d.artist || ''), url: d.url || '' }, old);
  if (!song) return;
  if ($('#importDlg').open) $('#importDlg').close();
  if (e.source) e.source.postMessage({ cs: 'ack', title: song.title }, e.origin);
});
// アプリから開いたウィンドウ(window.opener が残る)でChordWikiを開く。ブラウザの分割画面/マルチウィンドウと併用する
$('#iOpenCW').onclick = () => window.open('https://ja.chordwiki.org/', 'chordwiki');

// すべての画面(ダイアログ)は、画面の外(暗い部分)を押しても閉じる。
// スライダーや文字の選択を操作中に、指が外へ出ただけでは閉じないよう、押し始めも外側だった場合に限る
document.querySelectorAll('dialog').forEach((dlg) => {
  const outside = (e) => {
    const r = dlg.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let downOutside = false;
  dlg.addEventListener('pointerdown', (e) => { downOutside = outside(e); });
  dlg.addEventListener('click', (e) => { if (downOutside && outside(e)) dlg.close(); downOutside = false; });
});

// ダイアログ内の入力欄でEnterを押しても、フォームが送信されてダイアログが閉じ(入力が消え)ないようにする。
// 検索欄のEnterは検索を実行する。日本語入力の変換確定のEnterは何もしない
document.querySelectorAll('dialog form').forEach((f) => f.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.target.type === 'checkbox') return;
  if (e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  if (e.target.id === 'iQuery') $('#iSearch').click();
}));

// ---------- バックアップ ----------
// 取り込みと同期は、曲・セットリストごとに「更新が新しい方」を採用する(端末にしかない曲は残る)。
// 追加と更新はそのまま反映する。ほかの端末で削除された曲は、すぐには消さず「削除の確認」として結果に出し、
// 残すものを選んでもらってから削除する(syncCtx に保留しておく)
let syncCtx = null;
const emptyReport = () => ({ addedSongs: [], updatedSongs: [], addedSets: [], updatedSets: [], pendingSongs: [], pendingSets: [], tombNew: {} });
async function mergeIncoming(data) {
  const tombLocal = getTomb();
  const tombNew = {}; // 取り込む側で新しく分かった削除の記録
  for (const [id, ts] of Object.entries(data.deleted || {})) if (ts > (tombLocal[id] || 0)) tombNew[id] = ts;
  const dead = (item) => { const t = Math.max(tombLocal[item.id] || 0, tombNew[item.id] || 0); return t && t >= (item.updatedAt || 0); };
  const localSongs = await db.allSongs();
  const localSets = await db.allSetlists();
  const rep = emptyReport();
  rep.tombNew = tombNew;
  for (const x of data.songs || []) {
    if (!x || !x.id || typeof x.raw !== 'string' || dead(x)) continue;
    const mine = localSongs.find((y) => y.id === x.id);
    if (!mine) { await db.putSong(x); rep.addedSongs.push(x); }
    else if ((mine.updatedAt || 0) < (x.updatedAt || 0)) { await db.putSong(x); rep.updatedSongs.push(x); }
  }
  for (const x of data.setlists || []) {
    if (!x || !x.id || !Array.isArray(x.songIds) || dead(x)) continue;
    const mine = localSets.find((y) => y.id === x.id);
    if (!mine) { await db.putSetlist(x); rep.addedSets.push(x); }
    else if ((mine.updatedAt || 0) < (x.updatedAt || 0)) { await db.putSetlist(x); rep.updatedSets.push(x); }
  }
  // 他の端末で削除された曲は、削除の確認に回す(この端末で消した記録による削除は、そのまま確定)
  for (const x of localSongs) {
    if (tombNew[x.id] && tombNew[x.id] >= (x.updatedAt || 0)) rep.pendingSongs.push(x);
    else if (dead(x)) await db.deleteSong(x.id);
  }
  for (const x of localSets) {
    if (tombNew[x.id] && tombNew[x.id] >= (x.updatedAt || 0)) rep.pendingSets.push(x);
    else if (dead(x)) await db.deleteSetlist(x.id);
  }
  if (data.settings && typeof data.settings === 'object' && (data.settingsAt || 0) > getSettingsAt()) {
    adoptSettings(data.settings);
    try { localStorage.setItem('cs.settingsAt', String(data.settingsAt)); } catch {}
    rep.settings = true;
  }
  await loadLibrary();
  syncCtx = { ...rep, viaDrive: false };
  return rep;
}
const mergeTomb = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) if (!o[k] || o[k] < v) o[k] = v; return o; };
const payload = () => {
  const pend = new Set([...(syncCtx ? [...syncCtx.pendingSongs, ...syncCtx.pendingSets] : [])].map((x) => x.id));
  return {
    app: 'chordstage', version: 2, exportedAt: new Date().toISOString(),
    songs: [...songs, ...trash].filter((x) => !pend.has(x.id)),
    setlists: setlists.filter((x) => !pend.has(x.id)),
    deleted: mergeTomb(getTomb(), syncCtx ? syncCtx.tombNew : {}),
    settings: syncSettings(), settingsAt: getSettingsAt(),
  };
};
const backupJson = () => JSON.stringify(payload(), null, 1);
const backupFileName = () => 'chordstage-backup-' + new Date().toISOString().slice(0, 10) + '.json';
const needSongs = () => (songs.length ? true : (toast('曲がありません'), false));

function updateDriveUi() {
  const ok = drive.isConfigured();
  $('#gdState').textContent = ok ? 'Googleドライブの「' + (drive.getConfig().folderName || 'ChordStage') + '」フォルダを使います' : 'Googleドライブを使うには、下の「初回設定」でクライアントIDを登録してください';
  $('#gdBackup').disabled = !ok;
  $('#gdRestore').disabled = !ok;
  $('#gdSync').disabled = !ok;
  $('#gdAuto').checked = drive.getConfig().auto !== false;
  $('#gdClientId').value = drive.getConfig().clientId || '';
  $('#gdFolder').value = drive.getConfig().folderName || 'ChordStage';
}
$('#btnBackup').onclick = () => {
  $('#gdList').textContent = '';
  updateDriveUi();
  $('#backupDlg').showModal();
  if (drive.isConfigured()) drive.loadGis().catch(() => {}); // ポップアップがブロックされないよう、先に読み込んでおく
};
$('#gdAuto').onchange = () => { drive.saveConfig({ auto: $('#gdAuto').checked }); updateSyncChip(); if ($('#gdAuto').checked) autoSync('tap'); };
$('#gdSaveCfg').onclick = () => {
  const id = $('#gdClientId').value.trim();
  if (!/\.apps\.googleusercontent\.com$/.test(id)) return toast('クライアントIDは「…apps.googleusercontent.com」の形式です');
  drive.saveConfig({ clientId: id, folderName: $('#gdFolder').value.trim() || 'ChordStage' });
  updateDriveUi();
  toast('保存しました');
  drive.loadGis().catch(() => {});
  updateSyncChip();
};
// 1クリック同期: ドライブの最新を反映 → 統合した内容をドライブへ保存 → 結果を画面で見せる
async function runDriveSync() {
  syncCtx = null;
  let rep = emptyReport();
  syncing = true;
  try {
    const res = await drive.sync(async (incoming) => { if (incoming && incoming.app === 'chordstage') rep = await mergeIncoming(incoming); }, payload);
    if (syncCtx) syncCtx.viaDrive = true;
    lastSyncAt = Date.now();
    needTap = false;
    return { rep, res };
  } finally { syncing = false; updateSyncChip(); }
}

// ---- 自動同期: 起動時・変更したあと・アプリに戻ったとき・5分おきに、裏で同期する ----
// Googleのログインは、期限(1時間)が切れたあとの最初の画面タップで、一瞬だけ自動で更新される(ボタンを押し直す必要はない)
let syncing = false, needTap = false, lastSyncAt = 0, syncTimer = null, pendingSync = false, lastRep = null, lastErr = '';
const syncOn = () => drive.isConfigured() && drive.getConfig().auto !== false;
function updateSyncChip() {
  const b = $('#syncChip');
  b.classList.toggle('hidden', !syncOn());
  const pend = lastRep ? lastRep.pendingSongs.length + lastRep.pendingSets.length : 0;
  let t = '☁ ';
  if (syncing) t += '同期中…';
  else if (pend) t += `削除の確認 ${pend}件`;
  else if (needTap) t += '画面をタップで再接続';
  else if (lastErr) t += '同期できません';
  else if (lastSyncAt) t += '同期済み ' + new Date(lastSyncAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  else t += '同期待ち';
  b.textContent = t;
  b.classList.toggle('warn', !syncing && (needTap || !!lastErr || !!pend));
}
function scheduleSync() {
  if (!syncOn()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => autoSync('change'), 4000);
}
async function autoSync(reason) {
  if (!syncOn() || syncing || !navigator.onLine) return;
  if (!$('#player').classList.contains('hidden') && reason !== 'tap') { pendingSync = true; return; } // 演奏中は裏の通信を控え、一覧へ戻ってから
  if (!drive.hasToken() && reason !== 'tap') { // 期限切れ: 次の画面タップでログインを更新する
    needTap = true; updateSyncChip();
    document.addEventListener('pointerdown', () => autoSync('tap'), { capture: true, once: true });
    return;
  }
  pendingSync = false;
  try {
    lastErr = '';
    await drive.getToken();
    updateSyncChip();
    const { rep } = await runDriveSync();
    lastRep = rep;
    const pend = rep.pendingSongs.length + rep.pendingSets.length;
    const n = rep.addedSongs.length + rep.updatedSongs.length + rep.addedSets.length + rep.updatedSets.length;
    if (pend) toast(`ほかの端末で削除された曲が ${pend}件あります。上の「☁」から確認できます`);
    else if (n || rep.settings) toast(`同期しました(曲の追加・更新 ${n}件${rep.settings ? '、設定も反映' : ''})`);
  } catch (e) {
    if (e.code === 'popup' && reason !== 'tap') { needTap = true; document.addEventListener('pointerdown', () => autoSync('tap'), { capture: true, once: true }); }
    else lastErr = e.message;
  }
  updateSyncChip();
}
$('#syncChip').onclick = () => {
  if (lastRep && lastRep.pendingSongs.length + lastRep.pendingSets.length) { showSyncResult(lastRep, { viaDrive: true, existed: true, folder: drive.getConfig().folderName }); return; }
  lastErr = '';
  autoSync('tap');
};
db.setOnChange(() => { if (!syncing) scheduleSync(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoSync('visible'); });
window.addEventListener('online', () => autoSync('online'));
setInterval(() => { if (document.visibilityState === 'visible') autoSync('timer'); }, 5 * 60 * 1000);
$('#gdSync').onclick = async () => {
  $('#gdSync').disabled = true;
  try {
    if (syncing) return toast('同期中です。少しお待ちください');
    toast('ドライブと同期しています…');
    const { rep, res } = await runDriveSync();
    $('#backupDlg').close();
    showSyncResult(rep, { viaDrive: true, existed: res.existed, folder: res.folder });
  } catch (e) { toast(e.message); }
  $('#gdSync').disabled = !drive.isConfigured();
};

// ---- 結果の画面 ----
function chips(box, label, items, cls) {
  if (!items.length) return;
  const wrap = el('div', 'sdgroup ' + cls);
  wrap.append(el('h4', '', label + '(' + items.length + ')'));
  const row = el('div', 'chiprow');
  items.slice(0, 14).forEach((t) => row.append(el('span', 'chip', t)));
  if (items.length > 14) row.append(el('span', 'chip more', '他 ' + (items.length - 14) + '件'));
  wrap.append(row);
  box.append(wrap);
}
function showSyncResult(rep, opt = {}) {
  const time = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  $('#sdHead').textContent = opt.viaDrive ? '同期が完了しました' : '取り込みが完了しました';
  $('#sdSub').textContent = (opt.viaDrive
    ? (opt.existed ? 'ドライブの最新を反映し、端末の内容もドライブへ保存しました' : 'ドライブに初めて保存しました') + '(' + (opt.folder || 'ChordStage') + ')'
    : '選んだファイルの内容を反映しました') + ' ・' + time;
  $('#sdAdd').textContent = rep.addedSongs.length;
  $('#sdUpd').textContent = rep.updatedSongs.length;
  $('#sdSave').textContent = opt.viaDrive ? songs.length : '–';
  $('#sdSaveLabel').textContent = opt.viaDrive ? 'ドライブ内の曲数' : '';
  $('#sdSaveTile').classList.toggle('hidden', !opt.viaDrive);
  const pend = rep.pendingSongs.length + rep.pendingSets.length;
  $('#sdDel').textContent = pend;
  $('#sdDelTile').classList.toggle('dim', !pend);
  const lists = $('#sdLists');
  lists.textContent = '';
  chips(lists, '追加された曲', rep.addedSongs.map((x) => x.title), 'add');
  chips(lists, '更新された曲', rep.updatedSongs.map((x) => x.title), 'upd');
  chips(lists, '追加されたセットリスト', rep.addedSets.map((x) => x.name), 'add');
  chips(lists, '更新されたセットリスト', rep.updatedSets.map((x) => x.name), 'upd');
  if (!rep.addedSongs.length && !rep.updatedSongs.length && !rep.addedSets.length && !rep.updatedSets.length && !pend) {
    lists.append(el('p', 'sdnone', rep.settings ? '曲の変更はありません。設定をドライブの内容に合わせました。' : '変更はありませんでした。端末とドライブは同じ内容です。'));
  }
  // 他の端末で削除された曲: 残したいものにチェック → 1クリックで、チェックしていないものを一括削除
  const box = $('#sdPending');
  box.classList.toggle('hidden', !pend);
  $('#sdPendDone').classList.add('hidden');
  const ul = $('#sdPendList');
  ul.textContent = '';
  [...rep.pendingSongs.map((x) => ({ id: x.id, name: x.title, sub: x.artist || '', kind: '曲' })), ...rep.pendingSets.map((x) => ({ id: x.id, name: x.name, sub: x.songIds.length + '曲のセットリスト', kind: 'セット' }))]
    .forEach((it) => {
      const li = el('li');
      const lb = el('label');
      const cb = el('input');
      cb.type = 'checkbox'; cb.value = it.id;
      const txt = el('span', 'grow');
      txt.append(el('b', '', it.name));
      if (it.sub) txt.append(el('small', '', it.sub));
      lb.append(cb, txt, el('em', 'kind', it.kind));
      li.append(lb);
      ul.append(li);
    });
  updatePendButton();
  syncCtx = syncCtx || { ...rep, viaDrive: !!opt.viaDrive };
  syncCtx.viaDrive = !!opt.viaDrive;
  $('#syncDlg').showModal();
}
function updatePendButton() {
  const all = [...$('#sdPendList').querySelectorAll('input')];
  const keep = all.filter((i) => i.checked).length;
  const del = all.length - keep;
  const b = $('#sdDecide');
  b.disabled = !all.length;
  b.classList.toggle('danger', del > 0);
  b.textContent = del > 0 ? `チェックしていない ${del}件を削除する(残す ${keep}件)` : `${keep}件すべて残す`;
  $('#sdDel').textContent = all.length;
}
$('#sdPendList').addEventListener('change', updatePendButton);
$('#sdAll').onclick = () => { $('#sdPendList').querySelectorAll('input').forEach((i) => { i.checked = true; }); updatePendButton(); };
$('#sdNone').onclick = () => { $('#sdPendList').querySelectorAll('input').forEach((i) => { i.checked = false; }); updatePendButton(); };
$('#sdDecide').onclick = async () => {
  const ctx = syncCtx;
  const inputs = [...$('#sdPendList').querySelectorAll('input')];
  const keep = new Set(inputs.filter((i) => i.checked).map((i) => i.value));
  $('#sdDecide').disabled = true;
  const tomb = getTomb();
  for (const [id, ts] of Object.entries(ctx.tombNew)) if (!keep.has(id) && (!tomb[id] || tomb[id] < ts)) tomb[id] = ts;
  let deleted = 0;
  const gone = [];
  for (const x of ctx.pendingSongs) {
    if (keep.has(x.id)) { x.updatedAt = Math.max(Date.now(), (ctx.tombNew[x.id] || 0) + 1); await db.putSong(x); } // 残す: 更新時刻を新しくして、ほかの端末にも「残す」を伝える
    else { await db.deleteSong(x.id); gone.push(x.id); deleted++; }
  }
  for (const x of ctx.pendingSets) {
    if (keep.has(x.id)) { x.updatedAt = Math.max(Date.now(), (ctx.tombNew[x.id] || 0) + 1); await db.putSetlist(x); }
    else { await db.deleteSetlist(x.id); deleted++; }
  }
  try { localStorage.setItem('cs.tomb', JSON.stringify(tomb)); } catch {}
  // 削除した曲を、ほかのセットリストからも外す
  for (const set of await db.allSetlists()) {
    if (set.songIds.some((id) => gone.includes(id))) { set.songIds = set.songIds.filter((id) => !gone.includes(id)); set.updatedAt = Date.now(); await db.putSetlist(set); }
  }
  await loadLibrary();
  const kept = inputs.length - deleted;
  $('#sdPending').classList.add('hidden');
  $('#sdPendDone').classList.remove('hidden');
  $('#sdPendDone').textContent = `削除 ${deleted}件 / 残した ${kept}件。` + (kept && ctx.viaDrive ? 'ドライブにも反映しています…' : '');
  $('#sdDel').textContent = deleted;
  if (kept && ctx.viaDrive) {
    try { await runDriveSync(); $('#sdPendDone').textContent = `削除 ${deleted}件 / 残した ${kept}件。ドライブにも反映しました。`; }
    catch (e) { $('#sdPendDone').textContent = `削除 ${deleted}件 / 残した ${kept}件。ドライブへの反映に失敗しました: ${e.message}`; }
  }
};
$('#gdBackup').onclick = async () => {
  if (!needSongs()) return;
  $('#gdBackup').disabled = true;
  try {
    toast('Googleドライブへ保存中…');
    const r = await drive.backup(songs, setlists, getTomb());
    toast(`保存しました: ${r.folder} / ${r.name}(${r.count}曲)`);
  } catch (e) { toast(e.message); }
  $('#gdBackup').disabled = !drive.isConfigured();
};
$('#gdRestore').onclick = async () => {
  const ul = $('#gdList');
  ul.textContent = '';
  try {
    toast('バックアップを探しています…');
    const files = await drive.listBackups();
    if (!files.length) return toast('フォルダにバックアップがありません');
    files.forEach((f) => {
      const li = el('li');
      const b = el('button', '', new Date(f.modifiedTime).toLocaleString('ja-JP') + '  ' + f.name);
      b.type = 'button';
      b.onclick = async () => {
        if (!confirm('このバックアップを取り込みます。曲ごとに、更新が新しい方を採用します。\n' + f.name)) return;
        try {
          const data = await drive.download(f.id);
          if (data.app !== 'chordstage' || !Array.isArray(data.songs)) throw new Error('バックアップの形式が違います');
          const rep = await mergeIncoming(data);
          $('#backupDlg').close();
          showSyncResult(rep, { viaDrive: false });
        } catch (e) { toast(e.message); }
      };
      li.append(b);
      ul.append(li);
    });
  } catch (e) { toast(e.message); }
};
// ファイルでの書き出し / 共有 / 復元(Googleドライブを設定しなくても使える)
$('#fileExport').onclick = () => {
  if (!needSongs()) return;
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([backupJson()], { type: 'application/json' }));
  a.download = backupFileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
$('#fileShare').onclick = async () => {
  if (!needSongs()) return;
  // Chromeの共有はJSONファイルを受け付けないので、テキストファイル(.txt)として共有する。取り込み側は中身で判定する
  const name = backupFileName().replace(/\.json$/, '.txt');
  const json = backupJson();
  const file = new File([json], name, { type: 'text/plain' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'ChordStageバックアップ' });
    else if (navigator.share) await navigator.share({ title: 'ChordStageバックアップ', text: json });
    else throw new Error('unsupported');
  } catch (e) {
    if (e && e.name === 'AbortError') return; // 共有画面を閉じただけ
    try { await navigator.clipboard.writeText(json); toast('共有できなかったため、バックアップの内容をコピーしました'); }
    catch { toast('共有できませんでした。「ファイルに書き出す」を使ってください'); }
  }
};
$('#fileImport').onclick = () => $('#restoreFile').click();
$('#restoreFile').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'chordstage' || !Array.isArray(data.songs)) throw new Error();
    const rep = await mergeIncoming(data);
    $('#backupDlg').close();
    showSyncResult(rep, { viaDrive: false });
  } catch { toast('バックアップファイルを読み込めませんでした'); }
};

// ---------- プレーヤー ----------
let cur = null;      // 保存データ
let parsed = null;   // パース結果
let blocks = [];     // 1行ごとの要素 {s: セクション番号, chords: [...], el}
let lineEls = [];
let pos = 0;
let memoMode = false;

// セットリストから開いたときは、そのセットリスト専用のキー・カポ(set.overrides)を優先する
const playSet = () => (playCtx ? setlists.find((x) => x.id === playCtx.setId) : null);
const playOv = () => { const set = playSet(); return set && set.overrides && set.overrides[cur.id]; };
const effTranspose = () => { const o = playOv(); return o && o.transpose != null ? o.transpose : cur.transpose || 0; };
const effCapo = () => { const o = playOv(); return o && o.capo != null ? o.capo : cur.capo || 0; };
const disp = (c) => transposeChord(c, effTranspose(), cur.accidental || 'auto');
const ACC_LABEL = { auto: '表記:自動', sharp: '表記:♯', flat: '表記:♭' };
const persist = () => { cur.updatedAt = Date.now(); return db.putSong(cur); };

let playCtx = null; // セットリストから開いたとき {setId}。前の曲/次の曲ボタンが使える
async function openSong(id, ctx = null) {
  cur = songs.find((s) => s.id === id);
  if (!cur) return;
  playCtx = ctx;
  parsed = parseSong(cur.raw, { title: cur.title, artist: cur.artist });
  bpmBase = parsed.bpm || cur.bpm || 100;
  stopAuto();
  setFocus(false);
  memoMode = false;
  $('#btnMemoMode').classList.remove('on');
  showView('player');
  renderPlayer();
  played = false;
  setMode(true); // 曲を開いたら、自動モードにする
  setFab(false);
  setPos(0, { scroll: false });
  $('#score').scrollTop = 0;
  keepAwake();
  // ブラウザ/端末の「戻る」で一覧に戻れるよう、履歴に積む
  // 曲から曲へ移るとき(プレーヤー上)は履歴を増やさず、一覧/セットリストから開くときだけ積む
  const hv = history.state && history.state.v;
  if (hv === 'player' || hv === 'focus') history.replaceState({ v: 'player' }, ''); else history.pushState({ v: 'player' }, '');
}

function renderPlayer() {
  $('#pTitle').textContent = cur.title;
  $('#pMeta').textContent = [cur.artist, cur.key && 'Key ' + (effTranspose() ? transposeChord(cur.key, effTranspose(), cur.accidental || 'auto') + '(原調 ' + cur.key + ')' : cur.key), effCapo() && 'Capo ' + effCapo(), siteOf(cur)].filter(Boolean).join(' / ');
  const tr = effTranspose();
  $('#trLabel').textContent = tr ? (tr > 0 ? '+' : '') + tr : '原調';
  $('#accBtn').textContent = ACC_LABEL[cur.accidental || 'auto'];
  $('#grLabel').textContent = (cur.groupLines || DEFAULT_GROUP) + '行';
  const set = playCtx && setlists.find((x) => x.id === playCtx.setId);
  const order = set ? set.songIds.filter((id) => songs.some((x) => x.id === id)) : [];
  const idx = order.indexOf(cur.id);
  $('#prevSong').classList.toggle('hidden', !(set && idx > 0));
  $('#nextSong').classList.toggle('hidden', !(set && idx >= 0 && idx < order.length - 1));
  if (set && idx >= 0) $('#pMeta').textContent = '【' + set.name + ' ' + (idx + 1) + '/' + order.length + '】 ' + $('#pMeta').textContent;
  renderScore();
}

// 演奏メモを行に対応付ける(再取り込みで行位置が変わっても、歌詞テキストで探し直す)
function resolveMemos() {
  const map = new Map();
  const used = new Set();
  const lyrics = [];
  parsed.sections.forEach((sec, si) => sec.lines.forEach((ln, li) => { if (!ln.blank && !ln.note) lyrics.push({ si, li, text: lineLyric(ln).trim() }); }));
  (cur.memos || []).forEach((m) => {
    let hit = m.anchor && lyrics.find((x) => x.text === m.anchor && !used.has(x.si + ':' + x.li));
    if (!hit) hit = lyrics.find((x) => x.si === m.si && x.li === m.li);
    if (!hit) return;
    const k = hit.si + ':' + hit.li;
    used.add(k);
    m.si = hit.si; m.li = hit.li;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(m);
  });
  return map;
}

// 歌詞中の (ふりがな) を、コードをまたいでも続けて装飾する
function lyricNodes(text, state) {
  const frag = document.createDocumentFragment();
  let buf = '';
  const flush = () => {
    if (!buf) return;
    frag.append(state.in ? el('span', 'yomi', buf) : document.createTextNode(buf));
    buf = '';
  };
  for (const chr of text) {
    if (chr === '(' || chr === '（') { flush(); state.in = true; buf = chr; }
    else if (chr === ')' || chr === '）') { buf += chr; flush(); state.in = false; }
    else buf += chr;
  }
  flush();
  return frag;
}

function renderScore() {
  const score = $('#score');
  const mini = $('#minimap');
  score.textContent = '';
  mini.textContent = '';
  score.classList.toggle('memo-mode', memoMode);
  blocks = [];
  lineEls = [];
  const pset = playSet();
  const pm = pset ? membersFor(pset, cur.id) : [];
  if (pm.length) { score.append(memberChips(pm, 'playmembers')); }
  if (parsed.note) score.append(el('div', 'songnote', parsed.note));
  const memoMap = resolveMemos();
  let meter = 4; // 1小節の拍数(拍子の初期値は4/4)
  parsed.sections.forEach((sec, si) => {
    const wrap = el('section', 'sec');
    wrap.dataset.s = si;
    const h = el('h2', 'sech' + (sec.chorus ? ' chorus' : ''), sec.name || '—');
    h.dataset.block = blocks.length;
    wrap.append(h);
    let pending = [];   // 次の行の頭に付ける注記({ci:...})
    let pendingTempo = 0;
    let gapNext = false;
    sec.lines.forEach((ln, li) => {
      if (ln.blank) { gapNext = true; return; }
      if (ln.note != null) { pending.push({ t: ln.note, tempo: ln.tempo || 0 }); if (ln.tempo) pendingTempo = ln.tempo; return; }
      const idx = blocks.length;
      const blkEl = el('div', 'blk' + (gapNext ? ' gapbefore' : ''));
      gapNext = false;
      blkEl.dataset.block = idx;
      pending.forEach((n) => blkEl.append(el('div', 'note' + (n.tempo ? ' tempo' : ''), (n.tempo ? '♩ ' : '') + n.t)));
      pending = [];
      const blk = { s: si, chords: [], chordEls: [], el: blkEl, ln, meter0: meter, tempo: pendingTempo };
      pendingTempo = 0;
      meter = lineTimeline(ln, meter, 1).meter; // 拍子の変更((2/4)など)を次の行へ引き継ぐ
      blocks.push(blk);
      const add = el('button', 'memoadd', '＋ メモ');
      add.onclick = (e) => { e.stopPropagation(); openMemo(si, li, null); };
      const row = el('div', 'line');
      const segs = el('div', 'segs');
      const yomi = { in: false };
      let rc = 0;
      // 小節ごとの塊(.cell)。改行は小節の区切りでだけ起きる
      let cell = null;
      const newCell = () => {
        cell = el('span', 'cell');
        cell._ly = el('span', 'ly');
        cell._cl = el('span', 'cl');
        cell._it = [];
        cell.append(cell._ly, cell._cl);
        segs.append(cell);
      };
      const endMark = () => { if (!cell._end) { cell._end = el('span', 'mk'); cell._ly.append(cell._end); } };
      ln.segs.forEach((sg, k) => {
        if (sg.bar) {
          const trailing = k === ln.segs.length - 1 && cell;
          if (!trailing) { if (cell) endMark(); newCell(); } else endMark();  // 行末の閉じ小節線は直前の小節に付ける
          const rep = /:/.test(sg.bar) ? (sg.bar.startsWith(':') ? ' rep-b' : ' rep-a') : '';
          const barEl = el('span', 'bl' + (sg.bar === '||' ? ' dbl' : '') + rep);
          cell._ly.append(barEl);
          if (trailing) cell._tb = barEl; // 行末の閉じ小節線(コードが重ならないよう、layoutCellsで位置を調整する)
          return;
        }
        if (!cell) newCell();
        const mk = el('span', sg.chord ? 'mk cm' : 'mk'); // コードの変わり目には、区切り線のぶんの小さな隙間をあける
        cell._ly.append(mk);
        if (sg.time) {
          const [n, d] = sg.time.split('/');
          const ts = el('span', 'ts');
          ts.append(el('span', 'tsn', n), el('span', 'tsd', d));
          cell._cl.append(ts);
          const tsp = el('span', 'sp'); // 拍子の表示ぶんの場所をあける
          cell._ly.append(tsp);
          cell._it.push({ mk, label: ts, sp: tsp });
          return;
        }
        let spItem = null;
        // リズム表記(-- や > など)は、歌詞の段ではなく、コードの横に小さく添える。コードのない場所にだけ、歌詞の段に置く
        const textRhy = isRhythmOnly(sg.text);
        const rhy = [sg.rhythm, textRhy ? sg.text.trim() : ''].filter(Boolean).join(' ');
        if (sg.chord) {
          const ch = el('span', 'ch', disp(sg.chord));
          if (rhy) ch.append(el('span', 'rhy', ' ' + rhy));
          const item = { mk, label: ch, sp: el('span', 'sp') }; // sp: 歌詞が短いときや拍の長さに合わせて、この範囲を右に広げる余白
          spItem = item;
          blk.chords.push(sg.chord);
          blk.chordEls.push(ch);
          item.rng = el('span', 'rng ' + (rc++ % 2 ? 'rb' : 'ra')); // 隣り合う担当範囲は、色を交互にする
          cell._cl.append(item.rng);
          cell._cl.append(ch);
          cell._it.push(item);
        } else if (rhy) cell._ly.append(el('span', 'rhy', rhy));
        if (sg.text && !textRhy) cell._ly.append(lyricNodes(sg.text, yomi));
        if (spItem) cell._ly.append(spItem.sp);
      });
      segs.querySelectorAll('.cell').forEach((c) => { cell = c; endMark(); });
      row.append(segs);
      blkEl.append(add, row);
      (memoMap.get(si + ':' + li) || []).forEach((m) => {
        const box = el('div', 'memo');
        box.dataset.g = idx;
        if (m.tag) box.append(el('span', 'tag', m.tag));
        box.append(el('span', '', m.text));
        box.onclick = (e) => { if (memoMode) { e.stopPropagation(); openMemo(si, li, m); } };
        blkEl.append(box);
      });
      wrap.append(blkEl);
    });
    pending.forEach((n) => wrap.append(el('div', 'note', n.t)));
    score.append(wrap);
    const b = el('button', '', sec.name || '—');
    b.dataset.s = si;
    b.onclick = () => jumpTo(Number(h.dataset.block));
    mini.append(b);
  });
  refit();
}

// 曲中のテンポ変化: 譜面に書かれたテンポ(blk.tempo)から先は、そのテンポで自動モードを進める。
// BPMの+/−やTAPで変えた割合(cur.bpm / 曲のもとのBPM)は、曲中のテンポにも掛ける
let bpmBase = 100;
const tempoAt = (i) => { for (let j = Math.min(i, blocks.length - 1); j >= 0; j--) if (blocks[j].tempo) return blocks[j].tempo; return 0; };
const effBpm = (i) => {
  const t = settings.followTempo ? tempoAt(i) : 0;
  return t ? Math.max(30, Math.min(300, Math.round((t * cur.bpm) / bpmBase))) : cur.bpm;
};
const showBpm = () => { $('#bpmVal').textContent = effBpm(pos); };

// 自動モードの時間割り。1コードの長さはリズム表記(- = > ≧ ○)から求め、細かさは16分音符(=1/4拍)単位
function lineTL(i) {
  const b = blocks[i];
  if (!b._tl || b._tlFor !== settings.beatsPerChord) { b._tl = lineTimeline(b.ln, b.meter0, settings.beatsPerChord).beats; b._tlFor = settings.beatsPerChord; }
  return b._tl;
}
const unitsOf = (beats) => Math.max(1, Math.round(beats * 4));
function lineUnits(i) {
  const u = lineTL(i).reduce((sum, x) => sum + unitsOf(x), 0);
  return u || Math.round(blocks[i].meter0 * 4);
}
function chordAt(i, unit) {
  let acc = 0;
  const tl = lineTL(i);
  for (let k = 0; k < tl.length; k++) {
    const len = unitsOf(tl[k]);
    if (unit < acc + len) return { k, start: acc, len };
    acc += len;
  }
  return null;
}
// ハイライトする範囲: 現在行から「まとめ行数」分(セクションをまたぐ)。次へ進むと1行ずつずれる
function windowEnd(i) {
  const n = Math.max(1, cur.groupLines || DEFAULT_GROUP);
  let e = i;
  while (e + 1 < blocks.length && e + 1 < i + n) e++; // セクションをまたいでも、まとめ行数ぶん反映する
  return e;
}

function setPos(i, { scroll = true } = {}) {
  if (!blocks.length) { pos = 0; return; }
  pos = Math.max(0, Math.min(blocks.length - 1, i));
  clearNow();
  showBpm();
  const end = windowEnd(pos);
  blocks.forEach((b, bi) => {
    b.el.classList.toggle('cur', bi >= pos && bi <= end);
    b.el.classList.toggle('nxt', bi === end + 1);
    b.el.classList.toggle('past', bi < pos);
  });
  document.querySelectorAll('#minimap button').forEach((b) => b.classList.toggle('on', Number(b.dataset.s) === blocks[pos].s));
  document.querySelectorAll('.memo').forEach((m) => {
    const g = Number(m.dataset.g);
    m.classList.toggle('soon', g >= pos && g <= end + 2);
  });
  if (scroll) {
    const score = $('#score');
    score.scrollTo({ top: Math.max(0, blocks[pos].el.offsetTop - score.clientHeight * 0.1), behavior: 'smooth' });
  }
}

function jumpTo(i) {
  setPos(i);
  if (autoOn) { unitIdx = 0; unitsLeft = lineUnits(pos); } // 自動中は、飛んだ先から数え直す
}
// セットリストの前後の曲へ
function setNeighbor(d) {
  const set = playCtx && setlists.find((x) => x.id === playCtx.setId);
  if (!set) return null;
  const order = set.songIds.filter((id) => songs.some((x) => x.id === id));
  const i = order.indexOf(cur.id);
  return i >= 0 && order[i + d] ? songs.find((x) => x.id === order[i + d]) : null;
}
function gotoSong(d) {
  const t = setNeighbor(d);
  if (!t) return;
  stopAuto();
  openSong(t.id, playCtx);
}
$('#prevSong').onclick = () => gotoSong(-1);
$('#nextSong').onclick = () => gotoSong(1);
let armNext = false;
const next = () => {
  if (pos < blocks.length - 1) return jumpTo(pos + 1);
  const t = setNeighbor(1);
  if (!t) return toast('最後です');
  if (armNext) { armNext = false; return gotoSong(1); }
  armNext = true; // 最後の行で、もう一度「次」を押すと次の曲へ(押し間違い防止)
  toast('最後です。もう一度「次」で次の曲へ: ' + t.title);
  setTimeout(() => { armNext = false; }, 4000);
};
const prev = () => jumpTo(pos - 1);
$('#btnNext').onclick = next;
$('#btnPrev').onclick = prev;

// 譜面タップでジャンプ(コード→そのコードから、歌詞→その位置のコードから、行の余白→その行、見出し→セクション先頭)
// 自動モードでは、タップしたコードの頭から再生する(止まっているときも、そこから始める)
function chordAtPoint(e, blk) {
  const cellEl = e.target.closest('.cell');
  const own = e.target.closest('.ch');
  let label = own && blk.chordEls.includes(own) ? own : null;
  if (!label && cellEl && cellEl._it) {
    let best = null;
    for (const it of cellEl._it) {
      if (!blk.chordEls.includes(it.label)) continue;
      if (!best || it.mk.getBoundingClientRect().left <= e.clientX) best = it;
    }
    label = best && best.label;
  }
  return label ? blk.chordEls.indexOf(label) : -1;
}
// コードの層は pointer-events:none なので、タップした座標が、光っているコード(と拍の表示、コードが囲っている歌詞の範囲)の枠の中かで判定する
function hitsNowChord(e) {
  const c = document.querySelector('.ch.now');
  if (!c) return false;
  const rs = [c.getBoundingClientRect(), ...[...c.querySelectorAll('.bt')].map((b) => b.getBoundingClientRect())];
  const rng = c.previousElementSibling; // コードが囲っている歌詞の範囲(.rng)も、タップの対象にする
  if (rng && rng.classList.contains('rng')) rs.push(rng.getBoundingClientRect());
  const m = 10;
  return rs.some((r) => e.clientX >= r.left - m && e.clientX <= r.right + m && e.clientY >= r.top - m && e.clientY <= r.bottom + m);
}
$('#score').addEventListener('click', (e) => {
  if (memoMode || !settings.tapJump) return;
  const sech = e.target.closest('.sech');
  if (sech) return jumpTo(Number(sech.dataset.block));
  if (autoOn && hitsNowChord(e)) return stopAuto(); // 再生中の、光っているコードをタップすると停止
  const target = e.target.closest('.blk');
  if (!target) return;
  const i = Number(target.dataset.block);
  const k = chordAtPoint(e, blocks[i]);
  if (!autoMode || k < 0) return jumpTo(i);
  const tl = lineTL(i);
  let start = 0;
  for (let j = 0; j < k; j++) start += unitsOf(tl[j]);
  if (autoOn) { setPos(i); unitIdx = start; unitsLeft = lineUnits(i) - start; nextAt = performance.now(); clearTimeout(tickTimer); tick(); }
  else { setPos(i); startAuto(start); }
});

// コードの位置合わせ。コードは、必ずその歌詞の先頭の真上に置く(ずらさない)。
// 歌詞が短くてコードの幅に足りないときや、拍の長さ(リズム)に満たないときは、その範囲の右に余白(.sp)を入れて広げる。
// 1拍の幅(文字サイズ × 拍の幅)を基準に、コードの長さ(拍)に比例した幅にして、小節線が行ごとに揃うようにする。
// 歌詞が長くて収まらない範囲だけは、例外として必要なだけ伸ばす。文字サイズや画面幅が変わるたびに呼ぶ
function layoutCells() {
  const score = $('#score');
  const cells = [...score.querySelectorAll('.cell')];
  const fs = parseFloat(getComputedStyle(score).fontSize) || settings.fontSize;
  const gap = fs * settings.chordScale * 0.35;
  const beatPx = settings.beatSync ? fs * settings.beatEm : 0;
  // 各コードの長さ(拍)を、行ごとの時間割りから割り当てる
  blocks.forEach((b, i) => {
    const tl = lineTL(i);
    let k = 0;
    b.el.querySelectorAll('.cell').forEach((c) => c._it.forEach((it) => { if (it.rng) it.beats = tl[k++]; }));
  });
  cells.forEach((c) => {
    c._it.forEach((it) => { if (it.sp) it.sp.style.width = ''; });
    c.style.minWidth = '';
    if (c._tb) c._tb.style.marginLeft = '';
  });
  const measure = () => cells.map((c) => {
    const base = c.getBoundingClientRect().left;
    return {
      c,
      end: c._end.getBoundingClientRect().left - base,
      items: c._it.map((it) => { const r = it.mk.getBoundingClientRect(); return { it, x: r.left - base, head: r.right - base, w: it.label.offsetWidth }; }),
    };
  });
  const first = measure();
  first.forEach((o) => o.items.forEach((d, i) => {
    const next = i + 1 < o.items.length ? o.items[i + 1].x : o.end;
    const natural = next - d.x; // いまの歌詞が使っている幅
    const target = d.it.rng && beatPx && d.it.beats ? d.it.beats * beatPx : 0;
    const need = Math.max(target, d.w + gap);
    d.spacer = Math.max(0, need - natural);
  }));
  first.forEach((o) => o.items.forEach((d) => { if (d.it.sp) d.it.sp.style.width = Math.ceil(d.spacer) + 'px'; }));
  measure().forEach((o) => o.items.forEach((d, i) => {
    d.it.label.style.left = d.head + 'px'; // 歌詞の先頭(区切りの隙間のぶんだけ右)に揃える
    if (d.it.rng) {
      const next = i + 1 < o.items.length ? o.items[i + 1].x : o.end;
      d.it.rng.style.left = d.x + 'px';
      d.it.rng.style.width = Math.max(2, next - d.x - 3) + 'px';
    }
  }));
}

// 文字サイズ(=1行に入る量)をその場で調整する。
// 1行は基本的に折り返さない。大きくして画面からはみ出した行だけ、小節の区切りで次の段に折り返す
function reflowLines() {
  layoutCells();
  $('#score').querySelectorAll('.segs').forEach((sg) => {
    sg.classList.remove('wrap');
    if (sg.scrollWidth > sg.clientWidth + 1) sg.classList.add('wrap');
  });
}
function setFont(px, { keepPos = true } = {}) {
  settings.fontSize = Math.max(MIN_FONT, Math.min(60, Math.round(px * 10) / 10));
  applySettings();
  reflowLines();
  const blk = blocks[pos] && blocks[pos].el;
  if (keepPos && blk) $('#score').scrollTop = Math.max(0, blk.offsetTop - $('#score').clientHeight * 0.1);
}
// 全ての行が折り返さずに収まる、最大の文字サイズを二分探索で求める
function fitWidth({ silent = false } = {}) {
  const score = $('#score');
  if (!score.querySelector('.blk') || !score.clientWidth) return;
  const fits = (size) => {
    document.documentElement.style.setProperty('--fs', size + 'px');
    layoutCells();
    return [...score.querySelectorAll('.segs')].every((sg) => {
      sg.classList.remove('wrap');
      return sg.scrollWidth <= sg.clientWidth;
    });
  };
  let lo = MIN_FONT;
  let hi = 60;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  setFont(Math.floor(lo * 10) / 10);
  if (!silent) toast('文字サイズ ' + settings.fontSize + 'px(全ての行が1段に収まる最大)');
}
// 画面幅に合わせる設定(初期値はオン)のときは、曲を開いたとき・画面の大きさや向きが変わったとき・表示が変わったときに、自動で合わせる。
// 自分で文字サイズを変えたときは自動調整をオフにして(固定)、ヘッダーのボタンでオンに戻せる
const refit = () => { if (settings.autoFit) fitWidth({ silent: true }); else reflowLines(); };
function updateAutoFitBtn() {
  const b = $('#btnAutoFit');
  b.classList.toggle('on', settings.autoFit);
  b.textContent = settings.autoFit ? '自動幅' : '🔒 固定';
  b.title = settings.autoFit ? '画面の幅に自動で合わせています(押すと、いまの文字サイズで固定)' : '文字サイズを固定しています(押すと、画面の幅に自動で合わせる)';
}
function setAutoFit(on, { quiet = false } = {}) {
  settings.autoFit = on;
  applySettings();
  updateAutoFitBtn();
  if (on) fitWidth({ silent: true });
  if (!quiet) toast(on ? '画面の幅に自動で合わせます' : '文字サイズを固定しました(自動調整オフ)');
}
$('#btnAutoFit').onclick = () => setAutoFit(!settings.autoFit);
const manualFont = (px) => { if (settings.autoFit) setAutoFit(false); setFont(px); };
// 画面の大きさ・向きの変化を検知して、自動で合わせ直す(幅が2px以上変わったときだけ)。
// ResizeObserver に加えて、resize / orientationchange も見る(片方が届かない環境の保険)
(() => {
  let lastW = 0;
  let timer = 0;
  const onChange = () => {
    const sc = $('#score');
    if (!sc.clientWidth || $('#player').classList.contains('hidden')) return;
    if (Math.abs(sc.clientWidth - lastW) < 2) return;
    lastW = sc.clientWidth;
    clearTimeout(timer);
    timer = setTimeout(refit, 120);
  };
  if (window.ResizeObserver) new ResizeObserver(onChange).observe($('#score'));
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
})();
$('#fsDown').onclick = () => manualFont(settings.fontSize - 2);
$('#fsUp').onclick = () => manualFont(settings.fontSize + 2);
$('#fsFit').onclick = () => fitWidth();

// 全画面表示: 上下のバーを全て隠して譜面を最大化する(☰で戻す)。次/前はペダル・キー・譜面タップで操作する。
// 端末の「戻る」でも、全画面表示 → 通常表示 → 一覧、の順に戻る
function setFocus(on, { fromPop = false } = {}) {
  $('#player').classList.toggle('focus', on);
  $('#btnUnfocus').classList.toggle('hidden', !on);
  window.scrollTo(0, 0); // ページ側がずれていても、バーが必ず見える位置に戻す
  reflowLines();
  if (on && !fromPop) history.pushState({ v: 'focus' }, '');
}
$('#btnFocus').onclick = () => setFocus(true);
$('#btnUnfocus').onclick = () => {
  if (history.state && history.state.v === 'focus') history.back(); else setFocus(false);
};
window.addEventListener('popstate', (e) => {
  const v = (e.state && e.state.v) || 'library';
  const view = ['library', 'setView', 'player'].find((id) => !$('#' + id).classList.contains('hidden'));
  if (v === 'library' && view !== 'library') { showView('library'); loadLibrary(); }
  else if (v === 'set' && view !== 'setView') { showView('setView'); loadLibrary().then(renderSetView); }
  else if (v === 'player' && $('#player').classList.contains('focus')) setFocus(false, { fromPop: true });
});

// 移調
const wrap12 = (n) => ((n + 5) % 12 + 12) % 12 - 5;
async function transpose(d) {
  const set = playSet();
  if (set) {
    // セットリスト経由のときは、この曲のキーをセットリスト側に保存する(曲本体は変えない)
    set.overrides = set.overrides || {};
    const o = set.overrides[cur.id] || {};
    set.overrides[cur.id] = { ...o, transpose: wrap12(effTranspose() + d) };
    await saveSet(set);
  } else {
    cur.transpose = wrap12((cur.transpose || 0) + d);
    persist();
  }
  const keep = pos;
  renderPlayer();
  setPos(keep, { scroll: false });
}
// 移調後の黒鍵の書き方(♯系 / ♭系 / 自動)を切り替える。原調(移調0)のときは、元の表記のまま
$('#accBtn').onclick = () => {
  const order = ['auto', 'sharp', 'flat'];
  cur.accidental = order[(order.indexOf(cur.accidental || 'auto') + 1) % order.length];
  persist();
  const keep = pos;
  renderPlayer();
  setPos(keep, { scroll: false });
  toast(cur.accidental === 'auto' ? '移調後の表記: 自動' : cur.accidental === 'sharp' ? '移調後の表記: ♯を優先' : '移調後の表記: ♭を優先');
};
$('#trUp').onclick = () => transpose(1);
$('#trDown').onclick = () => transpose(-1);

// ハイライトする行数(曲ごと)。次へ進むたびに1行ずつずれる
function setGroup(n) {
  n = Math.max(1, Math.min(8, n));
  if (n === (cur.groupLines || DEFAULT_GROUP)) return;
  cur.groupLines = n;
  persist();
  $('#grLabel').textContent = n + '行';
  setPos(pos);
}
$('#grUp').onclick = () => setGroup((cur.groupLines || DEFAULT_GROUP) + 1);
$('#grDown').onclick = () => setGroup((cur.groupLines || DEFAULT_GROUP) - 1);

// ---------- 自動モード(テンポに合わせて進行) ----------
let autoMode = false;
let autoOn = false;
let played = false; // この曲で、一度でも自動で再生したか(ペダル1つのモードで、最初の開始は今の行から)
let unitIdx = 0;    // いまの行の中の位置(16分音符単位)
let unitsLeft = 0;  // いまの行の残り
let nextAt = 0;
let tickTimer = 0;
let actx = null;

function click(accent) {
  if (!settings.click) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(0.3, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.06);
    o.connect(g).connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + 0.07);
  } catch {}
}

// 自動モードの表示: いま追っているコードを色付けし、拍のカウントをそのコードのすぐ上に出す
function clearNow() {
  document.querySelectorAll('.ch.now').forEach((e) => { e.classList.remove('now'); const b = e.querySelector('.bt'); if (b) b.remove(); });
}
function showBeat(k, n, total, isCount = false) {
  const e = blocks[pos] && blocks[pos].chordEls[k];
  document.querySelectorAll('.ch.now').forEach((x) => { if (x !== e) { x.classList.remove('now'); const b = x.querySelector('.bt'); if (b) b.remove(); } });
  if (!e) return;
  e.classList.add('now');
  let bt = e.querySelector('.bt');
  if (!bt) { bt = el('span', 'bt'); e.append(bt); }
  bt.className = 'bt' + (isCount ? ' count' : '');
  bt.textContent = '';
  bt.append(el('b', '', n));
  if (!isCount) for (let i = 1; i <= Math.min(total, 8); i++) bt.append(el('i', i <= n ? 'on' : ''));
}

function tick() {
  if (!autoOn) return;
  $('#btnPlay').textContent = '■ 停止';
  setFab(true);
  if (unitsLeft <= 0) {
    if (pos >= blocks.length - 1) { stopAuto(); toast('最後まで進みました'); return; }
    const before = effBpm(pos);
    setPos(pos + 1);
    unitIdx = 0;
    unitsLeft = lineUnits(pos);
    if (effBpm(pos) !== before) toast('テンポ変更: ♩=' + before + ' → ' + effBpm(pos));
  }
  const ca = chordAt(pos, unitIdx);
  const rel = ca ? unitIdx - ca.start : unitIdx;
  if (unitIdx % 4 === 0) click(rel === 0);
  if (ca && rel % 4 === 0) showBeat(ca.k, rel / 4 + 1, Math.ceil(ca.len / 4));
  unitIdx++;
  unitsLeft--;
  nextAt += 60000 / effBpm(pos) / 4;
  tickTimer = setTimeout(tick, Math.max(0, nextAt - performance.now()));
}
function startAuto(startUnit = 0) {
  if (autoOn || !blocks.length) return;
  autoOn = true;
  played = true;
  unitIdx = startUnit;
  unitsLeft = lineUnits(pos) - startUnit;
  nextAt = performance.now();
  if (actx && actx.state === 'suspended') actx.resume();
  setPos(pos);
  tick();
}
function stopAuto() {
  autoOn = false;
  clearTimeout(tickTimer);
  $('#btnPlay').textContent = '▶ 開始';
  setFab(false);
  clearNow();
  if (blocks.length) setPos(pos, { scroll: false }); // その場で止める(スクロールもレイアウトも動かさない)
}
function setFab(on) {
  const f = $('#fab');
  f.classList.toggle('run', on);
  f.querySelector('.fi').textContent = on ? '■' : '▶';
  f.querySelector('.fl').textContent = on ? '停止' : played ? '次の行から' : '開始';
}
function setMode(auto) {
  autoMode = auto;
  if (!auto) stopAuto();
  $('#fab').classList.toggle('hidden', !auto);
  $('#score').classList.toggle('auto', auto); // 自動モードの間は、コードの上に拍のカウントを置く段を常に空けておく(開始・停止で画面が動かない)
  $('#modeManual').classList.toggle('on', !auto);
  $('#modeAuto').classList.toggle('on', auto);
  $('#btnPlay').classList.toggle('hidden', !auto);
  $('#bpmBox').classList.toggle('hidden', !auto);
}
$('#modeManual').onclick = () => setMode(false);
$('#modeAuto').onclick = () => setMode(true);
$('#btnPlay').onclick = () => (autoOn ? stopAuto() : startAuto());
// タップテンポ: 曲に合わせて続けてタップすると、間隔の平均からBPMを決める(2秒以上空くとやり直し)
function makeTapper(apply) {
  let taps = [];
  return () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now);
    taps = taps.slice(-7);
    if (taps.length < 2) return null;
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    const bpm = Math.max(30, Math.min(300, Math.round(60000 / avg)));
    apply(bpm);
    return bpm;
  };
}
$('#tapTempo').onclick = makeTapper((bpm) => { cur.bpm = bpm; showBpm(); persist(); });
$('#bpmBox').addEventListener('click', (e) => {
  const d = Number(e.target.dataset.d);
  if (!d) return;
  cur.bpm = Math.max(30, Math.min(300, cur.bpm + d));
  showBpm();
  persist();
});

// ---------- キー / ペダル ----------
// ペダル(キーボードとして接続されるもの)の割り当ては、設定画面で自由に変えられる
let capturing = null; // 割り当て待ちの動作名
// ペダルと同じ動作(自動モード): 動いていれば停止、止まっていれば次の行の頭から開始(曲を開いて最初の開始だけは今の行から)
function pedalToggle() {
  if (autoOn) stopAuto();
  else if (!played) startAuto();
  else if (pos < blocks.length - 1) { jumpTo(pos + 1); startAuto(); }
  else next();
}
$('#fab').onclick = pedalToggle;
document.addEventListener('keydown', (e) => {
  if (capturing) return;
  if ($('#player').classList.contains('hidden') || document.querySelector('dialog[open]')) return;
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const k = e.key;
  const has = (a) => (settings.keys[a] || []).includes(k);
  if (autoMode && (has('next') || has('play'))) { // 自動モードのペダル: 1回で停止、もう1回で次の行から開始
    if (e.repeat) return e.preventDefault();
    pedalToggle();
  } else if (has('play') && autoMode) { if (!e.repeat) autoOn ? stopAuto() : startAuto(); }
  else if (has('next')) { if (!e.repeat) next(); }
  else if (has('prev')) { if (!e.repeat) prev(); }
  else if (has('nextSong')) { if (!e.repeat) gotoSong(1); }
  else if (has('prevSong')) { if (!e.repeat) gotoSong(-1); }
  else return;
  e.preventDefault();
  // ボタンにフォーカスが残っていると、スペースやEnterのキーを離したときにそのボタンが押されたことになり、
  // 停止した直後に開始し直してしまう(ペダルが「開始」ボタンを押し直す)。フォーカスを外し、キーを離したときの動作も止める
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
});
document.addEventListener('keyup', (e) => {
  if ($('#player').classList.contains('hidden') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const all = Object.values(settings.keys).flat();
  if (all.includes(e.key) && !document.querySelector('dialog[open]')) e.preventDefault();
});
const KEY_ACTIONS = [['next', '次へ(次の行)'], ['prev', '前へ(前の行)'], ['play', '開始/停止(自動モード)'], ['nextSong', '次の曲(セットリスト)'], ['prevSong', '前の曲(セットリスト)']];
const KEY_NAMES = { ' ': 'Space', ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', PageDown: 'PageDown', PageUp: 'PageUp', Enter: 'Enter', Backspace: 'Backspace' };
const keyName = (k) => KEY_NAMES[k] || (k.length === 1 ? k.toUpperCase() : k);
function renderKeyMap() {
  const box = $('#keyMap');
  box.textContent = '';
  KEY_ACTIONS.forEach(([act, label]) => {
    const row = el('div', 'keyrow');
    row.append(el('span', 'kl', label));
    const chipsEl = el('span', 'kchips');
    (settings.keys[act] || []).forEach((k) => {
      const c = el('button', 'kchip', keyName(k) + ' ✕');
      c.type = 'button'; c.title = 'この割り当てを外す';
      c.onclick = () => { settings.keys[act] = settings.keys[act].filter((x) => x !== k); applySettings(); renderKeyMap(); };
      chipsEl.append(c);
    });
    if (!(settings.keys[act] || []).length) chipsEl.append(el('span', 'kempty', '(未割り当て)'));
    row.append(chipsEl);
    const add = el('button', '', capturing === act ? 'キー/ペダルを押してください…' : '＋ 割り当て');
    add.type = 'button';
    add.onclick = () => captureKey(act);
    row.append(add);
    box.append(row);
  });
}
// 次に押されたキー(ペダルを踏んだときの信号)を、その動作に割り当てる
function captureKey(act) {
  capturing = act;
  renderKeyMap();
  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.removeEventListener('keydown', onKey, true);
    capturing = null;
    if (e.key !== 'Escape') {
      // 同じキーが、重なると困る動作(次へ/前へ/曲送り)に割り当て済みなら、そちらから外す
      const conflicts = { next: ['prev', 'nextSong', 'prevSong'], prev: ['next', 'nextSong', 'prevSong'], nextSong: ['next', 'prev', 'prevSong'], prevSong: ['next', 'prev', 'nextSong'], play: [] }[act];
      conflicts.forEach((o) => { settings.keys[o] = (settings.keys[o] || []).filter((x) => x !== e.key); });
      if (!settings.keys[act].includes(e.key)) settings.keys[act] = [...settings.keys[act], e.key];
      applySettings();
      toast('「' + keyName(e.key) + '」を割り当てました');
    }
    renderKeyMap();
  };
  window.addEventListener('keydown', onKey, true);
}
$('#keyReset').onclick = () => { settings.keys = JSON.parse(JSON.stringify(DEFAULT_KEYS)); applySettings(); renderKeyMap(); };

// ---------- 演奏メモ ----------
const TAGS = ['ブレイク', 'キメ', '弱く', '強く', 'ストローク', 'カポ', 'メモ'];
let memoCtx = null;
function openMemo(si, li, memo) {
  const ln = parsed.sections[si].lines[li];
  memoCtx = { si, li, memo, tag: memo ? memo.tag : '', anchor: lineLyric(ln).trim() };
  $('#memoLine').textContent = (parsed.sections[si].name || '') + ' / ' + (memoCtx.anchor || ln.segs.map((s) => s.chord).join(' '));
  $('#mText').value = memo ? memo.text : '';
  $('#mDelete').classList.toggle('hidden', !memo);
  const chips = $('#memoTags');
  chips.textContent = '';
  TAGS.forEach((t) => {
    const b = el('button', memoCtx.tag === t ? 'on' : '', t);
    b.type = 'button';
    b.onclick = () => { memoCtx.tag = memoCtx.tag === t ? '' : t; [...chips.children].forEach((c) => c.classList.toggle('on', c.textContent === memoCtx.tag)); };
    chips.append(b);
  });
  $('#memoDlg').showModal();
}
async function saveMemos() {
  await persist();
  const keep = pos;
  renderScore();
  setPos(keep, { scroll: false });
}
$('#mSave').onclick = async () => {
  const text = $('#mText').value.trim();
  if (!text && !memoCtx.tag) return toast('メモの内容を入力してください');
  const { si, li, anchor, tag, memo } = memoCtx;
  if (memo) Object.assign(memo, { text, tag, anchor, si, li });
  else (cur.memos ||= []).push({ id: uid(), si, li, anchor, tag, text });
  $('#memoDlg').close();
  await saveMemos();
};
$('#mDelete').onclick = async () => {
  cur.memos = cur.memos.filter((m) => m !== memoCtx.memo);
  $('#memoDlg').close();
  await saveMemos();
};
$('#btnMemoMode').onclick = () => {
  memoMode = !memoMode;
  $('#btnMemoMode').classList.toggle('on', memoMode);
  $('#score').classList.toggle('memo-mode', memoMode);
  if (memoMode) toast('メモ編集モード: 行の「＋ メモ」を押してください');
};

// ---------- 曲情報 ----------
$('#btnInfo').onclick = () => {
  $('#fTitle').value = cur.title; $('#fArtist').value = cur.artist || '';
  $('#fKey').value = cur.key || ''; $('#fCapo').value = cur.capo || 0; $('#fBpm').value = cur.bpm;
  $('#fGroup').value = cur.groupLines || DEFAULT_GROUP;
  $('#fMemo').value = cur.songMemo || ''; $('#fUrl').value = cur.url || '';
  $('#fTags').value = (cur.tags || []).join(',');
  $('#infoDlg').showModal();
};
$('#fTap').onclick = makeTapper((bpm) => { $('#fBpm').value = bpm; });
$('#fOpenWeb').onclick = () => window.open($('#fUrl').value.trim() || 'https://ja.chordwiki.org/', '_blank', 'noopener');
$('#fSave').onclick = async () => {
  Object.assign(cur, {
    title: $('#fTitle').value.trim() || '無題', artist: $('#fArtist').value.trim(), key: $('#fKey').value.trim(),
    capo: Number($('#fCapo').value) || 0, bpm: Math.max(30, Math.min(300, Number($('#fBpm').value) || 100)),
    groupLines: Math.max(1, Math.min(8, Number($('#fGroup').value) || DEFAULT_GROUP)),
    songMemo: $('#fMemo').value,
    tags: parseTags($('#fTags').value), url: $('#fUrl').value.trim(),
  });
  await persist();
  $('#infoDlg').close();
  const keep = pos;
  renderPlayer();
  setPos(keep, { scroll: false });
  if (cur.songMemo) toast('曲メモ: ' + cur.songMemo.split('\n')[0]);
};
$('#fEditText').onclick = () => { $('#infoDlg').close(); openImport(cur); };
$('#fDelete').onclick = async () => {
  if (!confirm('「' + cur.title + '」を削除した曲に移します(あとで戻せます)。よろしいですか?')) return;
  $('#infoDlg').close();
  const gone = cur;
  goLibrary();
  await trashSong(gone);
};

// プレーヤーから、開いてきた画面(一覧 or セットリスト)へ戻る。先に画面を切り替え、そのあとで履歴を整える
async function backFromPlayer() {
  const toSet = !!playCtx;
  showView(toSet ? 'setView' : 'library');
  await loadLibrary();
  if (toSet) renderSetView();
}
// 画面上の「← 一覧」は、端末の「戻る」と同じ動き(履歴を1つ戻る)
const goLibrary = () => {
  const v = history.state && history.state.v;
  backFromPlayer();
  if (v === 'focus') history.go(-2); else if (v === 'player') history.back();
};
$('#btnBack').onclick = goLibrary;

// ---------- 設定ダイアログ ----------
function openSettings() {
  $('#sFont').value = settings.fontSize; $('#oFont').textContent = settings.fontSize + 'px';
  $('#sLyric').value = settings.lyricScale; $('#oLyric').textContent = Math.round(settings.lyricScale * 100) + '%';
  $('#sChord').value = settings.chordScale; $('#oChord').textContent = Math.round(settings.chordScale * 100) + '%';
  $('#sTheme').value = settings.theme; $('#sBeats').value = settings.beatsPerChord;
  $('#sBeatSync').checked = settings.beatSync; $('#sBeatEm').value = settings.beatEm; $('#oBeat').textContent = settings.beatEm.toFixed(1) + 'em';
  $('#sFollow').checked = settings.followTempo; $('#sClick').checked = settings.click; $('#sTap').checked = settings.tapJump;
  fillColorInputs();
  fillPresetSelect();
  renderKeyMap();
  $('#sRangeStyle').value = settings.rangeStyle;
  $('#settingsDlg').showModal();
}
$('#btnSettings').onclick = openSettings;
$('#btnSettings2').onclick = openSettings;
$('#settingsDlg').addEventListener('input', (e) => {
  if (e.target.id === 'sFont') { // 文字サイズのスライダーを動かしたときだけ(自動で合わせた小数の値を、ほかの操作で上書きしない)
    if (settings.autoFit) { settings.autoFit = false; updateAutoFitBtn(); toast('文字サイズを固定しました(自動調整オフ)'); } // 自分で変えたら、固定する
    settings.fontSize = Number($('#sFont').value);
    $('#oFont').textContent = settings.fontSize + 'px';
  }
  settings.lyricScale = Number($('#sLyric').value);
  $('#oLyric').textContent = Math.round(settings.lyricScale * 100) + '%';
  settings.chordScale = Number($('#sChord').value);
  $('#oChord').textContent = Math.round(settings.chordScale * 100) + '%';
  if ($('#sTheme').value !== settings.theme) switchTheme($('#sTheme').value);
  settings.beatsPerChord = Math.max(1, Math.min(16, Number($('#sBeats').value) || 4));
  settings.beatSync = $('#sBeatSync').checked; settings.beatEm = Number($('#sBeatEm').value); $('#oBeat').textContent = settings.beatEm.toFixed(1) + 'em';
  settings.followTempo = $('#sFollow').checked; settings.click = $('#sClick').checked; settings.tapJump = $('#sTap').checked;
  applySettings();
  if (!$('#player').classList.contains('hidden')) refit(); // 幅の設定などは、配置のやり直し(自動幅のときは合わせ直し)が要る
});

// ---------- アプリの更新 / 色の設定 ----------
// 保存した曲は消さずに、アプリ本体のキャッシュだけを捨てて読み込み直す(公開し直した新しい版を取り込むとき)
async function refreshApp() {
  toast('更新しています…');
  try {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  } catch {}
  location.reload();
}
$('#btnRefresh').onclick = refreshApp;
$('#btnRefresh2').onclick = refreshApp;

const cssHex = (name) => {
  const d = document.createElement('div');
  d.style.color = `var(${name})`;
  document.body.append(d);
  const rgb = getComputedStyle(d).color.match(/\d+/g).slice(0, 3).map(Number);
  d.remove();
  return '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('');
};
function presetList() {
  return settings.custom ? [...PRESETS, { id: 'custom', name: '自分用(保存した色)', ...settings.custom }] : PRESETS;
}
function fillPresetSelect() {
  const sel = $('#sPreset');
  sel.textContent = '';
  const ph = el('option', '', 'プリセットを選ぶ…');
  ph.value = '';
  sel.append(ph);
  presetList().forEach((p) => { const o = el('option', '', p.name); o.value = p.id; sel.append(o); });
  sel.value = settings.preset || '';
}
$('#sPreset').onchange = () => {
  const p = presetList().find((x) => x.id === $('#sPreset').value);
  if (!p) return;
  settings.colorsByTheme = settings.colorsByTheme || {};
  settings.colorsByTheme[settings.theme] = { ...(settings.colors || {}) };
  settings.preset = p.id;
  settings.theme = p.theme;
  settings.colors = { ...p.colors };
  updateThemeButtons();
  $('#sTheme').value = settings.theme;
  applySettings();
  fillColorInputs();
};
$('#presetSave').onclick = () => {
  const colors = {};
  Object.keys(COLOR_VARS).forEach((k) => { colors[k] = cssHex(COLOR_VARS[k]); });
  settings.custom = { theme: settings.theme, colors };
  settings.preset = 'custom';
  applySettings();
  fillPresetSelect();
  toast('今の色を「自分用」に保存しました');
};
function fillColorInputs() {
  document.querySelectorAll('[data-ck]').forEach((i) => { i.value = cssHex(COLOR_VARS[i.dataset.ck]); });
}
document.querySelectorAll('[data-ck]').forEach((i) => i.addEventListener('input', () => {
  settings.colors = { ...(settings.colors || {}), [i.dataset.ck]: i.value };
  settings.preset = ''; // 手で直したので「プリセット」ではなくなる
  $('#sPreset').value = '';
  applySettings();
}));
$('#colorReset').onclick = () => { settings.colors = {}; settings.preset = ''; applySettings(); fillColorInputs(); fillPresetSelect(); };

// ---------- 区切り(歌詞を色で囲む)のオンオフと形 ----------
function setRange(on, style) {
  if (on !== undefined) settings.rangeOn = on;
  if (style) settings.rangeStyle = style;
  applySettings();
  if (!$('#player').classList.contains('hidden')) refit(); // オフのときは、コードの変わり目の隙間をなくすので、配置をやり直す
}
$('#btnRange').onclick = () => { setRange(!settings.rangeOn); toast(settings.rangeOn ? '歌詞の区切りを表示' : '歌詞の区切りを非表示'); };
(() => {
  const sel = $('#sRangeStyle');
  RANGE_STYLES.forEach(([v, t]) => { const o = el('option', '', t); o.value = v; sel.append(o); });
  sel.onchange = () => setRange(true, sel.value);
})();

// ---------- ライト / ダークの1タップ切り替え ----------
// 色の指定(settings.colors)は、ライトとダークで別々に覚えておく(切り替えても、それぞれの配色が戻る)
function switchTheme(next) {
  if (next === settings.theme) return;
  settings.colorsByTheme = settings.colorsByTheme || {};
  settings.colorsByTheme[settings.theme] = { ...(settings.colors || {}) };
  settings.colors = { ...(settings.colorsByTheme[next] || {}) };
  settings.theme = next;
  settings.preset = '';
  applySettings();
  updateThemeButtons();
  const sel = $('#sTheme');
  if (sel) sel.value = next;
}
function updateThemeButtons() {
  document.querySelectorAll('.themebtn').forEach((b) => { b.textContent = settings.theme === 'dark' ? '☀ ライト' : '🌙 ダーク'; b.title = settings.theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え'; });
}
document.querySelectorAll('.themebtn').forEach((b) => { b.onclick = () => { switchTheme(settings.theme === 'dark' ? 'light' : 'dark'); setTimeout(() => { if (!$('#player').classList.contains('hidden')) refit(); }, 0); }; });
updateThemeButtons();

// ---------- 画面を消さない ----------
let wake = null;
async function keepAwake() {
  try { wake = await navigator.wakeLock?.request('screen'); } catch {}
}
function releaseAwake() { try { wake?.release(); } catch {} wake = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('#player').classList.contains('hidden')) keepAwake();
});

// ---------- 起動 ----------
applySettings();
updateAutoFitBtn();
history.replaceState({ v: 'library' }, '');
setTab(settings.view.tab);
loadLibrary().then(importFromHash).then(() => { if (drive.isConfigured()) { drive.loadGis().catch(() => {}); updateSyncChip(); autoSync('start'); } });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

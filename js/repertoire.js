// レパートリー(歌ったことがある曲のリスト): 表の読み取りと、コード譜(曲)との照合。
// スプレッドシートからコピーした表(タブ区切り)や、CSVファイルを読み、曲名とアーティスト名を取り出す

// 比較用に正規化する: 全角半角・大文字小文字・カタカナ/ひらがな・空白や記号の違いを無視する
export const norm = (s) => String(s || '').normalize('NFKC').toLowerCase()
  .replace(/[ァ-ヶ]/g, (m) => String.fromCharCode(m.charCodeAt(0) - 0x60))
  .replace(/[\s・\-–—_~〜!?.,'"“”‘’()[\]【】「」『』〈〉<>/\\:;*&+]/g, '');

// 同じ曲か: 曲名が同じで、アーティストは(両方あれば)一致または一方がもう一方を含む
export function sameSong(a, b) {
  const ta = norm(a.title), tb = norm(b.title);
  if (!ta || ta !== tb) return false;
  const aa = norm(a.artist), ab = norm(b.artist);
  return !aa || !ab || aa === ab || aa.includes(ab) || ab.includes(aa);
}

function splitLine(line, d) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"' && !cur) q = true;
    else if (c === d) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const TITLE_H = /^(曲名?|曲タイトル|タイトル|楽曲名?|title|song|name)$/i;
const ARTIST_H = /^(アーティスト名?|歌手名?|バンド名?|原曲|artist|singer|band)$/i;
const NOTE_H = /^(メモ|備考|ノート|note|memo|comment)$/i;

// 表のテキストから、[{title, artist, note}] を取り出す。1行目が見出し(曲名・アーティスト など)なら、その列を使う。
// 見出しがなければ、1列目=曲名、2列目=アーティスト。1列だけのときは「曲名 / アーティスト」「曲名 - アーティスト」の形も読む
export function parseTable(text) {
  const lines = String(text || '').replace(/^﻿/, '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return { items: [], header: false };
  const d = lines.some((l) => l.includes('\t')) ? '\t' : ',';
  const rows = lines.map((l) => splitLine(l, d));
  let ti = 0, ai = 1, ni = -1, header = false;
  const h = rows[0];
  const hti = h.findIndex((c) => TITLE_H.test(c)), hai = h.findIndex((c) => ARTIST_H.test(c));
  if (hti >= 0 || hai >= 0) {
    header = true;
    ti = hti >= 0 ? hti : (hai === 0 ? 1 : 0);
    ai = hai >= 0 ? hai : (ti === 0 ? 1 : 0);
    ni = h.findIndex((c) => NOTE_H.test(c));
  }
  const items = [];
  rows.slice(header ? 1 : 0).forEach((r) => {
    let title = (r[ti] || '').trim();
    let artist = (r[ai] || '').trim();
    if (!header && r.length === 1) {
      const m = title.match(/^(.+?)\s*(?:\/|／|\s-\s|\s–\s|－|—)\s*(.+)$/);
      if (m) { title = m[1].trim(); artist = m[2].trim(); }
    }
    if (!title) return;
    items.push({ title, artist, note: ni >= 0 ? (r[ni] || '').trim() : '' });
  });
  return { items, header };
}

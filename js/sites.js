// コード譜サイトごとの取り込み変換。ページのHTMLを、ChordPro風のテキスト([C]歌詞…)に変える。
import { isChord } from './parser.js';

// ---- リンネのコードブック(chord-rinne.jp) ----
// 譜面は <table class="lyric"> で、コード行(<tr id="row_N">: 8マスの <img alt="コード名">)と、その下の歌詞行が対になっている。
// 1マス = 1拍。alt の N はコードなし、NC は N.C.、GonB は G/B。歌詞行にあるセクション画像(section/amero.png など)は、その行から始まるセクション。
const RINNE_SECTIONS = {
  intro: 'イントロ', amero: 'Aメロ', amero2: 'Aメロ2', bmero: 'Bメロ', bmero2: 'Bメロ2', cmero: 'Cメロ',
  sabi: 'サビ', sabi2: 'サビ2', sabi3: 'サビ3', inter: '間奏', outro: 'アウトロ', outro2: 'アウトロ2',
};
const rinneChord = (alt) => {
  const a = (alt || '').trim();
  if (!a || a === 'N') return '';
  if (a === 'NC') return 'N.C.';
  const c = a.replace(/on([A-G][#♯b♭]?)$/, '/$1');
  return isChord(c) ? c : c;
};
// セルの歌詞。<ruby>漢字<rt>ふりがな</rt></ruby> は「漢字(ふりがな)」にする
function rinneCellText(td) {
  let s = '';
  const walk = (n) => n.childNodes.forEach((c) => {
    if (c.nodeType === 3) s += c.nodeValue;
    else if (c.nodeName === 'RUBY') {
      let base = '';
      let rt = '';
      c.childNodes.forEach((x) => { if (x.nodeName === 'RT') rt += x.textContent; else if (x.nodeName !== 'RP') base += x.textContent; });
      s += base + (rt.trim() ? '(' + rt.trim() + ')' : '');
    } else if (c.nodeType === 1 && !['IMG', 'BR', 'RT', 'RP'].includes(c.nodeName)) walk(c);
  });
  walk(td);
  return s.replace(/[ \s]+/g, ' ').trim();
}
export function rinneToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table.lyric, #scrollfield') || doc.querySelector('table');
  if (!table) return '';
  const trs = [...table.querySelectorAll('tr')];
  const lines = [];
  for (let i = 0; i < trs.length; i++) {
    const tr = trs[i];
    if (!/^row_/.test(tr.id || '')) continue;
    const lyricTr = trs[i + 1] && !/^row_/.test(trs[i + 1].id || '') ? trs[i + 1] : null;
    const chords = [...tr.children].map((td) => { const img = td.querySelector('img'); return rinneChord(img ? img.getAttribute('alt') : ''); });
    const texts = lyricTr ? [...lyricTr.children].map(rinneCellText) : [];
    const secImg = lyricTr && lyricTr.querySelector('img[src*="section/"]');
    const secKey = secImg && (secImg.getAttribute('src').match(/section\/([^./]+)/) || [])[1];
    const hasText = texts.some(Boolean);
    if (!secKey && !hasText && chords.every((c) => !c || c === 'N.C.')) continue; // 空の行(カウントなど)
    if (secKey) lines.push('{c:<<' + (RINNE_SECTIONS[secKey] || secKey) + '>>}');
    const cols = Math.max(chords.length, texts.length, 4);
    const at = chords.map((c, k) => (c ? k : -1)).filter((k) => k >= 0);
    const bars = Math.ceil(cols / 4);
    const perBar = Array(bars).fill(0);
    at.forEach((k) => { perBar[Math.floor(k / 4)]++; });
    let line = '';
    for (let b = 0; b < bars; b++) {
      line += '[|]';
      for (let k = b * 4; k < Math.min(cols, b * 4 + 4); k++) {
        if (chords[k]) {
          line += '[' + chords[k] + ']';
          // コードの長さ(マス数)が、小節内の等分と違うとき、またぎのときだけ、リズム表記で長さを伝える
          const idx = at.indexOf(k);
          const run = (at[idx + 1] ?? cols) - k;
          const equal = run === 4 / perBar[b] && k + run <= (b + 1) * 4;
          if (!equal) line += '[' + Array(run).fill('--').join(' ') + ']';
        }
        line += texts[k] || '';
      }
    }
    lines.push((line + '[|]').replace(/(\[\|\]){2,}/g, '[|]')); // 中身のない小節で、小節線が重ならないようにする
  }
  return lines.join('\n');
}

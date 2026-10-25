// コード譜テキスト(ChordPro形式 / コード行+歌詞行の形式)を内部構造に変換する。
// song = { title, artist, key, capo, bpm, note, sections: [{ name, chorus, lines: [{ segs: [{chord, text}] } | { blank: true }] }] }

const ROOT = '[A-G][#b♯♭]?';
const CHORD_RE = new RegExp(`^${ROOT}(?:m|maj|M|min|dim|aug|sus|add|omit|\\d+|\\+|-|#|b|♯|♭|\\(|\\)|,|°|ø|△)*(?:/${ROOT})?$`);
const SECTION_RE = /^[\[【(（]?\s*(イントロ|intro|[A-Zａ-ｚＡ-Ｚ]?メロ|サビ|間奏|アウトロ|outro|verse|chorus|bridge|interlude|solo|ブリッジ|落ちサビ|エンディング|ending|pre-?chorus|hook|リフ|ソロ|歌)[^\]】)）]{0,12}[\]】)）]?[:：]?$/i;

// 小節線: | || |: :| |] など
const BAR_SPLIT = /(\|\|:|:\|\||\|\||\|:|:\||\|\]|\||｜)/;
export const isBar = (t) => /^(?:\|\|:|:\|\||\|\||\|:|:\||\|\]|\||｜)$/.test(t);

// テンポの表記: BPM=120 / テンポ120 / ♩=120 など。曲の頭なら曲のBPM、曲の途中なら「テンポ変更」の印にする
const TEMPO_RE = /(?:BPM|テンポ|tempo|[♩♪♫])\s*[=＝:：]?\s*(\d{2,3})(?!\d)/i;
export const tempoOf = (v) => { const m = (v || '').match(TEMPO_RE); return m ? parseInt(m[1], 10) : 0; };

export const isChord = (t) => CHORD_RE.test(t) || t === 'N.C.' || t === 'N.C';

function isChordLine(line) {
  const toks = line.trim().split(/\s+/).filter((t) => !isBar(t) && !/^[%/\-()（）:：]+$/.test(t));
  return toks.length > 0 && toks.every(isChord);
}

// テキスト中の小節線を、独立した {bar} 要素に分ける
function splitBars(segs) {
  const out = [];
  segs.forEach((sg) => {
    if (sg.bar || !BAR_SPLIT.test(sg.text)) return out.push(sg);
    const parts = sg.text.split(BAR_SPLIT);
    out.push({ ...sg, text: parts[0] });
    for (let k = 1; k < parts.length; k += 2) {
      out.push({ bar: parts[k] });
      if (parts[k + 1]) out.push({ chord: '', text: parts[k + 1] });
    }
  });
  return out
    .filter((sg) => sg.bar || sg.chord || sg.text || sg.rhythm)
    // (4/4) のような拍子表記は、歌詞ではなく拍子マークとして扱う
    .map((sg) => (!sg.chord && !sg.bar && /^\(\d+\/\d+\)$/.test((sg.text || '').trim()) ? { time: sg.text.trim().slice(1, -1) } : sg));
}

const RHYTHM_RE = /^[-=>≧○!！\s]+$/; // [-- --] [--] [>!] のようなリズム表記
export const isRhythmOnly = (t) => !!t && RHYTHM_RE.test(t);

// リズム表記から長さ(拍=4分音符)を求める。 - と > は8分音符(0.5拍)、 = と ≧ は16分音符(0.25拍)。
// ○ は1音分で、長さは前後の表記に合わせる(直前の音、なければ直後の音)。 ! はアクセントなので拍に数えない。
// 例: "-- -- --" は3拍、"--" は1拍。記号が1つも無ければ null
const NOTE_BEATS = { '-': 0.5, '>': 0.5, '=': 0.25, '≧': 0.25 };
export function rhythmBeats(str) {
  const vals = [];
  for (const ch of str || '') {
    if (ch in NOTE_BEATS) vals.push(NOTE_BEATS[ch]);
    else if (ch === '○') vals.push(null);
  }
  if (!vals.length) return null;
  return vals.reduce((sum, v, i) => {
    if (v !== null) return sum + v;
    let f = null;
    for (let j = i - 1; j >= 0 && f === null; j--) f = vals[j];
    for (let j = i + 1; j < vals.length && f === null; j++) f = vals[j];
    return sum + (f === null ? 0.5 : f);
  }, 0);
}

// 1行の各コードの長さ(拍)を求める。リズム表記があるコードはその長さ、無いコードは小節の残りを等分する。
// 小節線が1つも無い行は、リズム表記の無いコードに fallback 拍を当てる。拍子((2/4) など)は後続の小節にも引き継ぐ。
// meter は1小節の拍数。戻り値: { beats: コードごとの拍数, meter: この行の終わりの1小節の拍数 }
export function lineTimeline(line, meter, fallback) {
  const segs = (line && line.segs) || [];
  const hasBar = segs.some((s) => s.bar);
  const groups = [];
  let g = { chords: [] };
  groups.push(g);
  segs.forEach((sg) => {
    if (sg.bar) { g = { chords: [] }; groups.push(g); return; }
    if (sg.time) { const [n, d] = sg.time.split('/').map(Number); if (n && d) g.meter = (n * 4) / d; return; }
    if (sg.chord) g.chords.push({ beats: rhythmBeats((sg.rhythm || '') + ' ' + (isRhythmOnly(sg.text) ? sg.text : '')) });
  });
  const out = [];
  groups.forEach((grp) => {
    if (grp.meter) meter = grp.meter;
    if (!grp.chords.length) return;
    if (!hasBar) { grp.chords.forEach((c) => out.push(c.beats ?? fallback)); return; }
    const unknown = grp.chords.filter((c) => c.beats == null);
    const known = grp.chords.length - unknown.length;
    const sum = grp.chords.reduce((a, c) => a + (c.beats ?? 0), 0);
    // 残りの拍を、16分音符(0.25拍)単位で等分する。表記が全く無ければ小節全体、表記だけで小節を超えていれば均等割りの長さ
    const remaining = meter - sum;
    const total = !known ? meter : remaining > 0 ? remaining : (meter / grp.chords.length) * unknown.length;
    const units = Math.round(total * 4);
    const n = unknown.length;
    const share = n ? Array.from({ length: n }, (_, i) => (Math.floor(units / n) + (i < units % n ? 1 : 0)) / 4) : [];
    let k = 0;
    grp.chords.forEach((c) => out.push(c.beats ?? Math.max(0.25, share[k++])));
  });
  return { beats: out, meter };
}

function parseInline(t) {
  const segs = [];
  const re = /\[([^\]]+)\]/g;
  let cur = { chord: '', text: '' };
  let last = 0;
  let m;
  while ((m = re.exec(t))) {
    const tok = m[1].trim();
    if (RHYTHM_RE.test(m[1])) { // 直前のコードに付くリズム表記
      cur.text += t.slice(last, m.index);
      cur.rhythm = ((cur.rhythm || '') + ' ' + tok).trim();
      last = re.lastIndex;
      continue;
    }
    if (!isChord(tok) && !isBar(tok)) continue; // コードでない[ ]は歌詞の一部として残す
    cur.text += t.slice(last, m.index);
    if (cur.chord || cur.text || cur.rhythm) segs.push(cur);
    if (isBar(tok)) { segs.push({ bar: tok }); cur = { chord: '', text: '' }; }
    else cur = { chord: tok, text: '' };
    last = re.lastIndex;
  }
  cur.text += t.slice(last);
  if (cur.chord || cur.text || cur.rhythm) segs.push(cur);
  return splitBars(segs);
}

function parseChordOverLyric(chordLine, lyric) {
  const hits = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(chordLine))) {
    if (isChord(m[0])) hits.push({ chord: m[0], col: m.index });
    else if (isBar(m[0])) hits.push({ bar: m[0], col: m.index });
  }
  // 全角文字は半角2つ分の幅として、コードの桁位置を歌詞の文字位置に変換する
  const colToIndex = (col) => {
    let w = 0;
    for (let k = 0; k < lyric.length; k++) {
      if (w >= col) return k;
      w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠￠-￦]/.test(lyric[k]) ? 2 : 1;
    }
    return lyric.length;
  };
  const segs = [];
  let last = 0;
  hits.forEach((h, i) => {
    const at = colToIndex(h.col);
    if (i === 0 && at > 0) segs.push({ chord: '', text: lyric.slice(0, at) });
    else if (i > 0 && !segs[segs.length - 1].bar) segs[segs.length - 1].text = lyric.slice(last, at);
    else if (i > 0 && at > last) segs.push({ chord: '', text: lyric.slice(last, at) });
    segs.push(h.bar ? { bar: h.bar } : { chord: h.chord, text: '' });
    last = at;
  });
  if (segs.length && !segs[segs.length - 1].bar) segs[segs.length - 1].text = lyric.slice(last);
  else if (segs.length && lyric.slice(last)) segs.push({ chord: '', text: lyric.slice(last) });
  return segs;
}

// 曲名の末尾の副題「(ドラマ「35歳の少女」主題歌)」「（映画〇〇の主題歌）」などを取り除く
export function cleanTitle(v) {
  let t = v.trim();
  for (;;) {
    const m = t.match(/^(.*?)[\s　]*[（(][^（）()]*[）)]\s*$/);
    if (!m || !m[1].trim()) break;
    t = m[1].trim();
  }
  return t;
}

// 「歌：King Gnu　作詞・作曲：常田大希」のような副題から、歌手名だけを取り出す
function cleanArtist(v) {
  const parts = v.split(/　+/).map((x) => x.trim()).filter(Boolean);
  const singer = parts.find((x) => /^(歌|唄|アーティスト|Artist|Vo)\s*[:：]/i.test(x));
  const pick = singer || parts.find((x) => !/^(作詞|作曲|編曲|詞|曲|Words|Music)/i.test(x)) || ''; // 歌手の記載がなければ空
  return pick.replace(/^[^:：]{1,10}[:：]\s*/, '').trim();
}

export function lineLyric(line) {
  return line.segs ? line.segs.map((s) => s.text || '').join('') : '';
}

// 小節線があるのに、コードが書かれていない小節は、前の小節の最後のコードを引き継いで、小節の頭に付ける。
// 前の小節は、前の行でもよい。小節線のない行(コードと歌詞だけの行)には、この規則は使わない
function inheritChords(song) {
  let last = '';
  song.sections.forEach((sc) => sc.lines.forEach((ln) => {
    if (!ln.segs || !ln.segs.some((g) => g.bar)) return;
    let group = [];
    const flush = () => {
      const has = group.some((g) => g.chord);
      const head0 = group.find((g) => !g.time);
      // 小節の頭に、コードより先にリズム表記だけがあるとき(例: |---- [Gb9]----| )は、その部分も前のコードの続きとして、頭に付ける
      if (has && last && head0 && !head0.chord && (head0.rhythm || isRhythmOnly(head0.text)) && head0.text !== undefined) { head0.chord = last; head0.inherited = true; }
      if (has) last = [...group].reverse().find((g) => g.chord).chord;
      else if (last) {
        const head = group.find((g) => !g.time);
        const content = group.some((g) => (g.text && g.text.trim()) || g.rhythm);
        if (head && content) { head.chord = last; head.inherited = true; }
      }
      group = [];
    };
    ln.segs.forEach((g) => { if (g.bar) flush(); else group.push(g); });
    flush();
  }));
}

export function parseSong(text, meta = {}) {
  const song = { title: meta.title || '', artist: meta.artist || '', key: '', capo: 0, bpm: 0, note: '', sections: [] };
  let sec = null;
  const newSec = (name, chorus = false) => {
    sec = { name, chorus, lines: [] };
    song.sections.push(sec);
  };
  const hasContent = () => song.sections.some((x) => x.lines.some((l) => l.segs));
  const push = (line) => {
    if (!sec) newSec('');
    sec.lines.push(line);
  };
  // 他サイトのコード譜の記法を整える: [ch]Am[/ch] はコードの印を外して、コード行+歌詞行の形にする。[tab] は取り除く
  text = text.replace(/\[ch\]([^\[]*)\[\/ch\]/g, '$1').replace(/\[\/?tab\]/g, '');
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) {
      if (sec && sec.lines.length && !sec.lines[sec.lines.length - 1].blank) sec.lines.push({ blank: true });
      continue;
    }
    const d = t.match(/^\{\s*([a-z_]+)\s*:?\s*(.*?)\s*\}$/i);
    if (d) {
      const k = d[1].toLowerCase();
      const v = d[2];
      if (k === 'title' || k === 't') song.title = song.title || cleanTitle(v);
      else if (k === 'artist' || k === 'subtitle' || k === 'st') song.artist = song.artist || cleanArtist(v);
      else if (k === 'key') {
        if (!song.key) song.key = v;
        else push({ note: 'Key: ' + v }); // 曲中の転調
      }
      else if (k === 'capo') song.capo = parseInt(v, 10) || 0;
      else if (k === 'tempo' || k === 'bpm') {
        const n = parseInt(v, 10) || 0;
        if (!hasContent()) song.bpm = n;
        else if (n) push({ note: 'テンポ ♩=' + n, tempo: n }); // 曲の途中のテンポ変更
      }
      else if (k === 'comment' || k === 'c' || k === 'ci' || k === 'cb' || k === 'comment_italic') {
        const name = v.match(/^<<(.*)>>$/);
        if (name && k !== 'ci') newSec(name[1].trim()); // {c:<<Aメロ>>} はセクション見出し
        else if (k !== 'ci' && SECTION_RE.test(v) && v.length <= 24) newSec(v);
        else if (!hasContent() && k !== 'ci') {
          song.note = (song.note ? song.note + '\n' : '') + v; // 曲頭のコメントは曲メモ
          const tp = tempoOf(v);
          if (tp && !song.bpm) song.bpm = tp;
        } else {
          const tp = tempoOf(v);
          push(tp ? { note: v, tempo: tp } : { note: v }); // {ci:...} などは演奏上の指示として行の間に表示。テンポの表記があれば、その行からテンポが変わる
        }
      }
      else if (k === 'start_of_chorus' || k === 'soc') {
        if (sec && !sec.lines.length) sec.chorus = true;
        else newSec(v || 'サビ', true);
      } else if (k === 'start_of_verse' || k === 'sov') {
        if (!(sec && !sec.lines.length)) newSec(v || '');
      }
      continue;
    }
    const br = t.match(/^\[([^\]]+)\]$/);
    if (br && !isChord(br[1].trim()) && !isBar(br[1].trim())) {
      newSec(br[1].trim());
      continue;
    }
    if (t.length <= 24 && SECTION_RE.test(t) && !isChordLine(t)) {
      newSec(t.replace(/^[\[【(（]|[\]】)）:：]$/g, '').trim());
      continue;
    }
    if (/\[(?:[A-G]|N\.?C|\|)/.test(t)) {
      const segs = parseInline(raw.replace(/\s+$/, ''));
      if (segs.length) push({ segs });
      continue;
    }
    if (isChordLine(raw)) {
      const next = lines[i + 1];
      const nt = next === undefined ? '' : next.trim();
      if (nt && !isChordLine(next) && !/^\{.*\}$/.test(nt) && !(nt.length <= 24 && SECTION_RE.test(nt))) {
        push({ segs: parseChordOverLyric(raw, next.replace(/\s+$/, '')) });
        i++;
      } else {
        push({ segs: parseChordOverLyric(raw, '') });
      }
      continue;
    }
    push({ segs: [{ chord: '', text: raw.replace(/\s+$/, '') }] });
  }
  inheritChords(song);
  song.sections.forEach((s) => {
    while (s.lines.length && s.lines[s.lines.length - 1].blank) s.lines.pop();
  });
  song.sections = song.sections.filter((s) => s.lines.length || s.name);
  song.note = song.note.trim();
  return song;
}

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const idx = (n) => {
  n = n.replace('♯', '#').replace('♭', 'b');
  const i = SHARP.indexOf(n);
  return i >= 0 ? i : FLAT.indexOf(n);
};

// pref: 'auto' | 'sharp' | 'flat'。移調したあとの黒鍵を、♯と♭のどちらで書くか(auto: 下げるとき・元が♭のときは♭、それ以外は♯)
export function transposeChord(chord, n, pref = 'auto') {
  if (!n || chord.startsWith('N.C')) return chord;
  const m = chord.match(new RegExp(`^(${ROOT})(.*?)(?:/(${ROOT}))?$`));
  if (!m) return chord;
  const flat = pref === 'flat' ? true : pref === 'sharp' ? false : n < 0 || /[b♭]/.test(m[1] + (m[3] || ''));
  const scale = flat ? FLAT : SHARP;
  const conv = (r) => scale[(((idx(r) + n) % 12) + 12) % 12];
  return conv(m[1]) + m[2] + (m[3] ? '/' + conv(m[3]) : '');
}

// Règles du jeu, sans dépendance à Cloudflare : testables avec node --test.
export const HINT_MIN = 0.3;
export const POINTS = [1000, 600, 300, 100];
const WORD = /[\p{L}\p{N}]+/gu;

export function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae');
}

export function tokenize(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(WORD)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ w: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Retire la prononciation ([tuʁɛfɛl], « prononcé en allemand … ») et les parenthèses restées vides.
export function cleanExtract(text) {
  return text
    .replace(/\[[^\]\n]*\]/g, '')
    .replace(/\(\s*(?:prononcé|prononciation)[^()\n]*\)/gi, '')
    .replace(/\(\s*[,;:]?\s*\)/g, '');
}

// Les jetons sont des séparateurs (texte affiché tel quel) ou des numéros de mots, à deviner.
export function buildPage(title, extract) {
  const words = [];
  const mark = text => tokenize(text).map(t => (typeof t === 'string' ? t : words.push({ text: t.w, key: normalize(t.w) }) - 1));
  const titleTokens = mark(title);
  const paragraphs = cleanExtract(extract)
    .split(/\n+/)
    .map(p => p.replace(/[ \t ]{2,}/g, ' ').replace(/ ([,.])/g, '$1').trim())
    .filter(Boolean)
    .map(mark);
  return { titleTokens, paragraphs, words, titleWords: titleTokens.filter(t => typeof t === 'number') };
}

export function describe(key, lex) {
  const num = /^\d{1,9}$/.test(key) ? Number(key) : null;
  const i = lex ? lex.find(key) : -1;
  if (i < 0) return { lemmas: new Set([key]), row: -1, num };
  const ids = lex.lemmas(i);
  let row = lex.row(i);
  for (let j = 0; row < 0 && j < ids.length; j++) row = lex.row(ids[j]);
  return { lemmas: new Set(ids.length ? ids : [i]), row, num };
}

export function analyze(page, lex) {
  const keys = new Map();
  page.words.forEach((w, i) => {
    if (!keys.has(w.key)) keys.set(w.key, { key: w.key, pos: [], ...describe(w.key, lex) });
    keys.get(w.key).pos.push(i);
  });
  return keys;
}

// Deux années sont proches à ±30 ans près ; les autres nombres, à 15 % près.
export function numberCloseness(a, b) {
  const years = Math.min(a, b) >= 1000 && Math.max(a, b) <= 2100;
  return 1 - Math.abs(a - b) / (years ? 40 : Math.max(5, 0.15 * Math.max(a, b)));
}

export function closeness(a, b, lex) {
  let s = a.row >= 0 && b.row >= 0 ? lex.cosine(a.row, b.row) : 0;
  if (a.num !== null && b.num !== null) s = Math.max(s, numberCloseness(a.num, b.num));
  return s;
}

export const newRun = () => ({ revealed: new Set(), hints: new Map(), tried: new Set(), guesses: [], foundAt: null });

function shares(a, b) {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

function uncover(page, keys, run, g, key) {
  const out = [];
  for (const e of keys.values()) {
    if (run.revealed.has(e.key) || (e.key !== key && !shares(e.lemmas, g.lemmas))) continue;
    run.revealed.add(e.key);
    run.hints.delete(e.key);
    for (const i of e.pos) out.push([i, page.words[i].text]);
  }
  return out;
}

export function reveal(page, keys, lex, run, key) {
  return uncover(page, keys, run, describe(key, lex), key);
}

const round = s => Math.round(s * 100) / 100;

export function guess(page, keys, lex, run, input) {
  const res = { items: [], revealed: [], hints: [] };
  for (const [raw] of String(input).slice(0, 60).matchAll(WORD)) {
    const w = raw.toLowerCase(), k = normalize(raw);
    if (run.tried.has(k) || run.revealed.has(k)) {
      res.items.push({ w, dup: true });
      continue;
    }
    run.tried.add(k);
    const g = describe(k, lex);
    const found = uncover(page, keys, run, g, k);
    res.revealed.push(...found);
    for (const e of keys.values()) {
      if (run.revealed.has(e.key)) continue;
      const s = closeness(g, e, lex);
      if (s < HINT_MIN || s <= (run.hints.get(e.key)?.s ?? 0)) continue;
      run.hints.set(e.key, { w, s });
      for (const i of e.pos) res.hints.push([i, w, round(s)]);
    }
    run.guesses.push({ w, n: found.length });
    res.items.push({ w, n: found.length });
  }
  return res;
}

export const isFound = (page, run) => page.titleWords.every(i => run.revealed.has(page.words[i].key));

export function playerView(page, run) {
  const revealed = [], hints = [];
  page.words.forEach((w, i) => {
    const h = run.hints.get(w.key);
    if (run.revealed.has(w.key)) revealed.push([i, w.text]);
    else if (h) hints.push([i, h.w, round(h.s)]);
  });
  const lens = page.words.map(w => [...w.text].length);
  return { titleTokens: page.titleTokens, paragraphs: page.paragraphs, lens, revealed, hints };
}

export const fullPage = page => ({
  title: page.title,
  url: page.url,
  titleTokens: page.titleTokens,
  paragraphs: page.paragraphs,
  texts: page.words.map(w => w.text),
});

// Ceux qui ont trouvé par ordre d'arrivée, puis les autres selon le nombre de mots dévoilés.
export function ranking(page, runs, startedAt) {
  const rows = Object.entries(runs).map(([id, r]) => {
    const count = page.words.filter(w => r.revealed.has(w.key)).length;
    return {
      id,
      found: r.foundAt != null,
      time: r.foundAt != null ? r.foundAt - startedAt : null,
      guesses: r.guesses.length,
      count,
      pct: Math.round((100 * count) / page.words.length),
    };
  });
  rows.sort((a, b) => b.found - a.found || (a.found ? a.time - b.time : b.count - a.count));
  rows.forEach((r, i) => {
    const p = rows[i - 1];
    r.rank = p && p.found === r.found && (r.found ? p.time === r.time : p.count === r.count) ? p.rank : i;
    r.points = POINTS[r.rank] ?? 0;
  });
  return rows;
}

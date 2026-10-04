// Mesure la qualité des mots proches sur les pages de tools/evaluation.json : pour chaque essai, son meilleur niveau.
// Usage : node tools/evaluate.mjs <dossier de données> [<autre dossier>…]. Le rapport s'écrit sur la sortie standard.
import { readFileSync } from 'node:fs';
import { Lexicon } from '../src/lexicon.js';
import { analyze, buildPage, describe, guess, keyOf, newRun } from '../src/game.js';
import { fetchPage } from '../src/wikipedia.js';

const LEVELS = ['dévoilé', 'brûlant', 'chaud', 'tiède', 'rien'];
const level = s => (s >= 0.9 ? 'brûlant' : s >= 0.6 ? 'chaud' : s >= 0.3 ? 'tiède' : 'rien');
const tests = JSON.parse(readFileSync(new URL('./evaluation.json', import.meta.url), 'utf8'));
const load = (dir, f) => {
  const b = readFileSync(`${dir}/${f}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
};

const pages = {};
for (const title of Object.keys(tests)) pages[title] = await fetchPage(title).catch(e => console.log(`${title} : ${e.message}`));

// Pour régler les seuils : rang exact d'un mot parmi les voisins d'un autre (1 = le plus proche)
function ranker(lex) {
  const v = lex.vectors, d = lex.dims, count = v.length / d;
  const norm = new Float32Array(count);
  for (let r = 0; r < count; r++) {
    let s = 0;
    for (let j = 0, o = r * d; j < d; j++) s += v[o + j] * v[o + j];
    norm[r] = Math.sqrt(s) || 1;
  }
  const sim = (a, b) => {
    let s = 0;
    for (let j = 0, x = a * d, y = b * d; j < d; j++) s += v[x + j] * v[y + j];
    return s / (norm[a] * norm[b]);
  };
  return (e, g) => {
    const target = sim(e, g);
    let rank = 1;
    for (let r = 0; r < count; r++) if (r !== e && sim(e, r) > target) rank++;
    return { cos: Math.round(target * 1000) / 1000, rank };
  };
}

// Détail d'un essai : sa proximité avec le sujet de la page (moyenne des mots cachés) et, pour les 3 mots cachés
// les plus proches, la proximité, le rang exact de l'essai parmi leurs voisins et leurs seuils (10e, 100e, 500e voisin)
function detail(lex, rank, keys, word) {
  const g = describe(keyOf(word), lex).row;
  if (g < 0) return null;
  const hidden = [...keys.values()].filter(e => e.row >= 0 && !e.stop && !e.num);
  const d = lex.dims, v = lex.vectors, center = new Float32Array(d);
  const len = r => {
    let s = 0;
    for (let j = 0; j < d; j++) s += v[r * d + j] ** 2;
    return Math.sqrt(s) || 1;
  };
  for (const e of hidden) {
    const n = len(e.row);
    for (let j = 0; j < d; j++) center[j] += v[e.row * d + j] / n;
  }
  let dot = 0, cn = 0;
  for (let j = 0; j < d; j++) {
    dot += v[g * d + j] * center[j];
    cn += center[j] ** 2;
  }
  const gn = len(g) ** 2;
  const near = hidden
    .map(e => ({ e, cos: lex.cosine(g, e.row) }))
    .sort((a, b) => b.cos - a.cos)
    .slice(0, 3)
    .map(({ e }) => ({ h: e.plain, ...rank(e.row, g), c: lex.cutoffs(e.row)?.map(x => Math.round(x * 100) / 100) }));
  return { cc: Math.round((1000 * dot) / Math.sqrt(cn * gn)) / 1000, near };
}

for (const dir of process.argv.slice(2)) {
  const lex = new Lexicon(load(dir, 'words.bin'), load(dir, 'vectors.bin'));
  const rank = dir === process.argv[2] ? ranker(lex) : null;
  const total = { sujet: {}, pièges: {} };
  console.log(`\n===== ${dir} =====`);
  for (const [title, sets] of Object.entries(tests)) {
    const p = pages[title];
    if (!p) continue;
    const page = buildPage(p.title, p.extract);
    const keys = analyze(page, lex);
    console.log(`\n${p.title}`);
    for (const [kind, list] of Object.entries(sets)) {
      for (const word of list) {
        const r = guess(page, keys, lex, newRun(), word);
        const item = r.items[0];
        const best = r.hints.sort((a, b) => b[2] - a[2])[0];
        const l = item.n ? 'dévoilé' : level(item.s);
        total[kind][l] = (total[kind][l] ?? 0) + 1;
        console.log(`  ${kind.padEnd(7)} ${word.padEnd(14)} ${l}${item.s && !item.n ? ` ${item.s}` : ''}${best && !item.n ? ` → ${page.words[best[0]].text}` : ''}`);
        const more = rank && !item.n && detail(lex, rank, keys, word);
        if (more) console.log(`DETAIL ${JSON.stringify({ page: p.title, kind, word, level: l, ...more })}`);
      }
    }
  }
  console.log(`\nRésumé ${dir}`);
  for (const kind of Object.keys(total)) console.log(`  ${kind} : ${LEVELS.map(l => `${l} ${total[kind][l] ?? 0}`).join(', ')}`);
}

// Mesure la qualité des mots proches sur les pages de tools/evaluation.json : pour chaque essai, son meilleur niveau.
// Usage : node tools/evaluate.mjs <dossier de données> [<autre dossier>…] [--wiki <dossier de wiki.bin>].
// Le rapport s'écrit sur la sortie standard ; le deuxième avis (wiki.bin) va avec le premier dossier.
import { readFileSync } from 'node:fs';
import { Lexicon } from '../src/lexicon.js';
import { analyze, buildPage, describe, guess, keyOf, newRun, normalize } from '../src/game.js';
import { fetchPage } from '../src/wikipedia.js';

const LEVELS = ['dévoilé', 'brûlant', 'chaud', 'tiède', 'rien'];
const level = s => (s >= 0.9 ? 'brûlant' : s >= 0.6 ? 'chaud' : s >= 0.3 ? 'tiède' : 'rien');
const tests = JSON.parse(readFileSync(new URL('./evaluation.json', import.meta.url), 'utf8'));
const load = (dir, f) => {
  const b = readFileSync(`${dir}/${f}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
};

const args = process.argv.slice(2);
const at = args.indexOf('--wiki');
const wikiDir = at >= 0 ? args.splice(at, 2)[1] : null;

const pages = {};
for (const title of Object.keys(tests)) pages[title] = await fetchPage(title).catch(e => console.log(`${title} : ${e.message}`));

// Pour régler les seuils : rang exact d'un mot parmi les voisins d'un autre (1 = le plus proche), dans un modèle
function ranker(space) {
  const v = space.vectors, d = space.dims, count = v.length / d;
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

// Détail d'un essai dans un modèle : sa proximité avec le sujet de la page (moyenne des mots cachés) et, pour les 3 mots
// cachés les plus proches, la proximité, le rang exact de l'essai parmi leurs voisins et leurs seuils
function detail(space, rank, rowOf, keys, word) {
  const g = rowOf(keyOf(word));
  if (g < 0) return null;
  const hidden = [...keys.values()].map(e => ({ e, row: rowOf(e.key) })).filter(x => x.row >= 0 && !x.e.stop && !x.e.num);
  const d = space.dims, v = space.vectors, center = new Float32Array(d);
  const len = r => {
    let s = 0;
    for (let j = 0; j < d; j++) s += v[r * d + j] ** 2;
    return Math.sqrt(s) || 1;
  };
  for (const { row } of hidden) {
    const n = len(row);
    for (let j = 0; j < d; j++) center[j] += v[row * d + j] / n;
  }
  let dot = 0, cn = 0;
  for (let j = 0; j < d; j++) {
    dot += v[g * d + j] * center[j];
    cn += center[j] ** 2;
  }
  const near = hidden
    .map(x => ({ ...x, cos: space.cosine(g, x.row) }))
    .sort((a, b) => b.cos - a.cos)
    .slice(0, 3)
    .map(x => ({ h: x.e.plain, ...rank(x.row, g), c: space.cutoffs(x.row)?.map(c => Math.round(c * 100) / 100) }));
  return { cc: Math.round((1000 * dot) / Math.sqrt(cn * len(g) ** 2)) / 1000, near };
}

for (const dir of args) {
  const first = dir === args[0];
  const lex = new Lexicon(load(dir, 'words.bin'), load(dir, 'vectors.bin'), first && wikiDir ? load(wikiDir, 'wiki.bin') : null);
  const rank = first ? ranker(lex) : null;
  const wrank = first && lex.wiki ? ranker(lex.wiki) : null;
  const ownRow = key => describe(key, lex).row;
  // Ligne d'un mot dans le deuxième avis, ou à défaut celle de son mot de base
  const wikiRow = key => {
    const i = lex.find(normalize(key));
    if (i < 0) return -1;
    let r = lex.wiki.row(i);
    for (const l of lex.lemmas(i)) if (r < 0) r = lex.wiki.row(l);
    return r;
  };
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
        const more = rank && !item.n && detail(lex, rank, ownRow, keys, word);
        const wiki = wrank && !item.n ? detail(lex.wiki, wrank, wikiRow, keys, word) : null;
        if (more || wiki) console.log(`DETAIL ${JSON.stringify({ page: p.title, kind, word, level: l, ...more, wiki })}`);
      }
    }
  }
  console.log(`\nRésumé ${dir}`);
  for (const kind of Object.keys(total)) console.log(`  ${kind} : ${LEVELS.map(l => `${l} ${total[kind][l] ?? 0}`).join(', ')}`);
}

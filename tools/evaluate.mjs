// Mesure la qualité des mots proches sur les pages de tools/evaluation.json : pour chaque essai, son meilleur niveau.
// Usage : node tools/evaluate.mjs <dossier de données> [<autre dossier>…]. Le rapport s'écrit sur la sortie standard.
import { readFileSync } from 'node:fs';
import { Lexicon } from '../src/lexicon.js';
import { analyze, buildPage, guess, newRun } from '../src/game.js';
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

for (const dir of process.argv.slice(2)) {
  const lex = new Lexicon(load(dir, 'words.bin'), load(dir, 'vectors.bin'));
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
      }
    }
  }
  console.log(`\nRésumé ${dir}`);
  for (const kind of Object.keys(total)) console.log(`  ${kind} : ${LEVELS.map(l => `${l} ${total[kind][l] ?? 0}`).join(', ')}`);
}

// Prépare aide.bin pour l'aide à l'écriture, à partir de words.bin et de formes.tsv (laissé par tools/prepare_data.py).
// Usage : node tools/prepare_help.mjs <dossier des données>
// Affiche aussi des exemples de mots mal écrits et leurs propositions, pour le rapport.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalize } from '../src/game.js';
import { Lexicon } from '../src/lexicon.js';
import { Help, sound } from '../src/spell.js';

const MAGIC = 0x31414b50; // « PKA1 »
const EXAMPLES = ['fonétik', 'otomobil', 'porblème', 'bocou', 'dinosor', 'téléfone', 'ortograf', 'sinéma', 'anfan', 'rinocéros', 'spinosorus', 'farmassie', 'lavion', 'kestion', 'shato', 'fotografi', 'cheuval', 'pingouain', 'bibliotèque', 'élefan'];
const STARTS = ['fonet', 'otom', 'dino', 'pharm', 'bibli', 'anf', 'elef'];

const load = file => {
  const b = readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
};

// Textes mis bout à bout, avec la position de début de chacun
function pool(texts) {
  const enc = new TextEncoder(), parts = texts.map(t => enc.encode(t));
  const offsets = new Uint32Array(texts.length + 1);
  parts.forEach((p, i) => (offsets[i + 1] = offsets[i] + p.length));
  const bytes = new Uint8Array(offsets[texts.length]);
  parts.forEach((p, i) => bytes.set(p, offsets[i]));
  return { offsets, bytes };
}

export function buildHelp(dir) {
  const lex = new Lexicon(load(join(dir, 'words.bin')), load(join(dir, 'vectors.bin')));
  const n = lex.keyOffset.length - 1;
  const lines = readFileSync(join(dir, 'formes.tsv'), 'utf8').split('\n');

  // Orthographe affichée (vide si c'est la clé elle-même) et rang de fréquence de chaque mot
  const keys = [], shown = [], rank = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const key = lex.keyAt(i), [text = '', r = ''] = (lines[i] ?? '').split('\t');
    keys.push(key);
    shown.push(text && text !== key && normalize(text) === key ? text : '');
    rank[i] = r ? Number(r) : n + i;
  }

  // Seuls les mots de lettres, 2 au moins, sont proposés : triés par écriture, et par son puis fréquence
  const ids = keys.flatMap((k, i) => (/^[a-z]{2,}$/.test(k) ? [i] : []));
  const sounds = keys.map((k, i) => (/^[a-z]{2,}$/.test(k) ? sound(shown[i] || k) : ''));
  const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const alpha = Uint32Array.from(ids).sort((a, b) => order(keys[a], keys[b]));
  const bySound = Uint32Array.from(ids).sort((a, b) => order(sounds[a], sounds[b]) || rank[a] - rank[b]);

  const s = pool(shown), so = pool(sounds);
  const head = new Uint32Array([MAGIC, n, ids.length, s.bytes.length, so.bytes.length]);
  const out = Buffer.concat([head, s.offsets, rank, alpha, bySound, so.offsets, s.bytes, so.bytes].map(a => Buffer.from(a.buffer, a.byteOffset, a.byteLength)));
  writeFileSync(join(dir, 'aide.bin'), out);
  rmSync(join(dir, 'formes.tsv'));
  return { lex, help: new Help(out.buffer.slice(out.byteOffset, out.byteOffset + out.length)), size: out.length, count: ids.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { lex, help, size, count } = buildHelp(process.argv[2] ?? 'public/data');
  console.log(`aide.bin : ${(size / 1e6).toFixed(1)} Mo, ${count} mots proposables`);
  console.log('Mots mal écrits et propositions :');
  for (const w of EXAMPLES) console.log(`  ${w} → ${help.suggest(lex, w).join(', ') || '(rien)'}`);
  console.log('Liste pendant la frappe :');
  for (const p of STARTS) console.log(`  ${p}… → ${help.complete(lex, p).join(', ') || '(rien)'}`);
}

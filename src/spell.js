// Aide à l'écriture : pour un mot qui n'existe pas, les mots existants les plus proches, par l'écriture
// (lettres inversées, oubliées, en trop) ou par le son (« fonétik » → phonétique), et la liste pendant la frappe.
// Les propositions viennent du dictionnaire entier, jamais de la page : elles aident à écrire, pas à trouver.
import { normalize } from './game.js';

const MAGIC = 0x31414b50; // « PKA1 »
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
// Lettres d'un son : majuscules pour les sons qui s'écrivent de plusieurs façons (an, in, on, eu, ou, ch, g dur, w de « oi »)
const SOUNDS = 'abdefijklmnoprstuvzAEGIOSUW';
// Les mots hors du dictionnaire des formes (noms propres, mots étrangers, fautes du web) ne sont proposés que s'ils sont courants
const FREQUENT = 50000;
const decoder = new TextDecoder();

// Le son d'un mot, en gros : deux écritures qui se prononcent pareil donnent le même son (« phonétique », « fonétik »).
// Sans « end » (début d'un mot en cours de frappe), les lettres muettes de fin de mot sont gardées.
export function sound(word, end = true) {
  let s = normalize(String(word).toLowerCase().replace(/ç/g, 's')).replace(/[^a-z]/g, '');
  if (end && s.length >= 5) s = s.replace(/er$/, 'e');
  if (end) s = s.replace(/x$/, '');
  s = s
    .replace(/(?<=[aeiouy])s(?=[aeiouy])/g, 'z')
    .replace(/w/g, 'v')
    .replace(/ph/g, 'f')
    .replace(/ch(?=[lr])/g, 'k')
    .replace(/s?ch|sh/g, 'S')
    .replace(/th/g, 't')
    .replace(/h/g, '')
    .replace(/gn/g, 'ni')
    .replace(/ck|qu|q/g, 'k')
    .replace(/cc(?=[eiy])/g, 'ks')
    .replace(/sc(?=[eiy])/g, 's')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/gu(?=[eiy])/g, 'G')
    .replace(/ge(?=[aou])/g, 'j')
    .replace(/g(?=[eiy])/g, 'j')
    .replace(/g/g, 'G')
    .replace(/x/g, 'ks')
    .replace(/t(?=ion)/g, 's')
    .replace(/eau|au/g, 'o')
    .replace(/oeu|eu|oe/g, 'E')
    .replace(/oin(?![aeiouynmAEIOUW])/g, 'WI')
    .replace(/oi|oy/g, 'Wa')
    .replace(/ou/g, 'U')
    .replace(/ien(?![aeiouynmAEIOUW])/g, 'iI')
    .replace(/(?:ai|ei)[nm](?![aeiouynmAEIOUW])|[iuy][nm](?![aeiouynmAEIOUW])/g, 'I')
    .replace(/[ae][nm](?![aeiouynmAEIOUW])/g, 'A')
    .replace(/o[nm](?![aeiouynmAEIOUW])/g, 'O')
    .replace(/ai|ei|ay|ey/g, 'e')
    .replace(/y/g, 'i');
  if (end) s = s.replace(/[stdzp]+$/, '').replace(/e+$/, '');
  return s.replace(/(.)\1+/g, '$1');
}

// Toutes les écritures à une faute près : lettre en trop, oubliée, remplacée, ou deux lettres inversées.
export function* edits1(w, abc = LETTERS) {
  for (let i = 0; i <= w.length; i++) {
    const a = w.slice(0, i), b = w.slice(i);
    if (b) yield a + b.slice(1);
    if (b.length > 1) yield a + b[1] + b[0] + b.slice(2);
    for (const c of abc) {
      if (b && c !== b[0]) yield a + c + b.slice(1);
      yield a + c + b;
    }
  }
}

// Nombre de fautes entre deux écritures (deux lettres inversées comptent pour une).
export function distance(a, b) {
  let before = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (before && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], before[j - 2] + 1);
    }
    before = prev;
    prev = cur;
  }
  return prev[b.length];
}

// Compare l'entrée i d'un pool de textes au texte s : négatif si elle vient avant.
function compare(pool, offsets, i, s) {
  const a = offsets[i], len = offsets[i + 1] - a, n = Math.min(len, s.length);
  for (let j = 0; j < n; j++) {
    const d = pool[a + j] - s.charCodeAt(j);
    if (d) return d;
  }
  return len - s.length;
}

// Lit aide.bin, produit par tools/prepare_help.mjs : pour chaque mot de words.bin, son orthographe avec accents,
// son rang de fréquence et son son ; et deux listes triées, par écriture et par son, pour chercher par le début.
export class Help {
  constructor(buffer) {
    const v = new DataView(buffer);
    if (v.getUint32(0, true) !== MAGIC) throw new Error('aide.bin invalide');
    const [n, m, shownSize, soundSize] = [4, 8, 12, 16].map(o => v.getUint32(o, true));
    let o = 20;
    const take = (Type, len) => {
      const a = new Type(buffer, o, len);
      o += len * Type.BYTES_PER_ELEMENT;
      return a;
    };
    this.n = n;
    this.shownOffset = take(Uint32Array, n + 1);
    this.rank = take(Uint32Array, n);
    this.alpha = take(Uint32Array, m);
    this.bySound = take(Uint32Array, m);
    this.soundOffset = take(Uint32Array, n + 1);
    this.shownPool = take(Uint8Array, shownSize);
    this.soundPool = take(Uint8Array, soundSize);
  }

  // Les données vont avec ce words.bin ?
  fits(lex) {
    return !!lex && this.n === lex.keyOffset.length - 1;
  }

  shown(lex, i) {
    const a = this.shownOffset[i], b = this.shownOffset[i + 1];
    return a === b ? lex.keyAt(i) : decoder.decode(this.shownPool.subarray(a, b));
  }

  // Les entrées de « list » dont le texte vaut « s » (exact) ou commence par « s »
  find(list, pool, offsets, s, exact) {
    const lower = t => {
      let lo = 0, hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (compare(pool, offsets, list[mid], t) < 0) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    return list.subarray(lower(s), lower(s + (exact ? '\x01' : '\x7f')));
  }

  sameSound(s) {
    return this.find(this.bySound, this.soundPool, this.soundOffset, s, true);
  }

  // Mots existants proches d'un mot mal écrit, les plus probables d'abord. Rien pour un mot du dictionnaire des formes ;
  // pour un mot connu du seul modèle (faute courante sur le web, nom propre…), seulement des mots du dictionnaire plus fréquents.
  suggest(lex, word, max = 5) {
    const plain = normalize(word);
    if (!/^[a-z]{3,}$/.test(plain)) return [];
    const typed = lex.find(plain);
    if (typed >= 0 && lex.known(typed)) return [];
    const snd = sound(word);
    const found = new Map();
    const add = (i, near) => {
      if (i < 0 || i === typed || (typed >= 0 && (!lex.known(i) || this.rank[i] >= this.rank[typed]))) return;
      found.set(i, found.get(i) || near);
    };

    // Même son, une lettre de différence, ou un son de différence
    if (snd.length >= 2) for (const i of this.sameSound(snd).subarray(0, 40)) add(i, false);
    for (const e of edits1(plain)) add(lex.find(e), false);
    if (snd.length >= 3) for (const e of edits1(snd, SOUNDS)) for (const i of this.sameSound(e).subarray(0, 10)) add(i, true);

    // Rangés par sorte : même son, une lettre de différence, puis un son de différence (3 fautes au plus)
    const all = [...found]
      .map(([i, near]) => {
        const d = distance(plain, lex.keyAt(i));
        const kind = compare(this.soundPool, this.soundOffset, i, snd) === 0 ? 0 : d <= 1 ? 1 : near && d <= 3 ? 2 : 3;
        return { i, d, kind, known: lex.known(i) };
      })
      .filter(c => c.kind < 3);

    // Un mot hors du dictionnaire des formes passe s'il est courant, ou faute de mieux ; jamais pour un son de différence.
    // Dans chaque sorte : les mots du dictionnaire d'abord, puis le moins de fautes, puis les plus fréquents
    const some = all.some(c => c.known);
    return all
      .filter(c => c.known || (c.kind < 2 && (!some || this.rank[c.i] < FREQUENT)))
      .sort((a, b) => a.kind - b.kind || b.known - a.known || a.d - b.d || this.rank[a.i] - this.rank[b.i])
      .slice(0, max)
      .map(c => this.shown(lex, c.i));
  }

  // Liste pendant la frappe : les mots qui commencent pareil ou qui se prononcent pareil au début, les plus fréquents d'abord.
  complete(lex, text, max = 6) {
    const p = normalize(text);
    if (!/^[a-z]{3,}$/.test(p)) return [];
    const best = [];
    const better = (a, b) => lex.known(b) - lex.known(a) || this.rank[a] - this.rank[b];
    const offer = i => {
      if (best.includes(i) || (!lex.known(i) && this.rank[i] >= FREQUENT)) return;
      let k = best.length;
      while (k > 0 && better(i, best[k - 1]) < 0) k--;
      if (k < max) best.splice(k, 0, i);
      if (best.length > max) best.pop();
    };
    for (const i of this.find(this.alpha, lex.pool, lex.keyOffset, p, false)) offer(i);

    // Par le son du début ; s'il finit par « an », « om »… le mot n'est peut-être pas fini : on essaie aussi sans son nasal
    const starts = [sound(text, false)];
    if (/[aeiouy][nm]$/.test(p)) starts.push(sound(p.slice(0, -1), false) + p.slice(-1));
    for (const sp of starts) if (sp.length >= 2) for (const i of this.find(this.bySound, this.soundPool, this.soundOffset, sp, false)) offer(i);
    return best.map(i => this.shown(lex, i));
  }
}

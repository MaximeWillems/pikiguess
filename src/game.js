// Règles du jeu, sans dépendance à Cloudflare : testables avec node --test.
export const POINTS = [1000, 600, 300, 100];

// Proximité d'un mot proche, de 0 à 1 : tiède à partir de 0,3, chaud à partir de 0,6, brûlant à partir de 0,9.
export const HINT_MIN = 0.3;
const EQUAL = 0.95;

// Un mot : une suite de lettres, ou un nombre. « 1er » donne deux mots, « 1 » et « er » ;
// « 3 000 » et « 0,31 » restent un seul nombre.
const WORD = /\d{1,3}(?:[   ]\d{3})+(?!\d)|\d+(?:,\d+)?|[\p{L}\p{M}]+/gu;

// Petits mots très fréquents : ils se dévoilent normalement mais ne grisent rien, sinon « le » s'afficherait partout.
const STOP = new Set(
  `le la les l un une des du de d au aux ce cet cette ces c mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs
  je j me m moi tu te t toi il elle on nous vous ils elles se s soi lui y en qui que qu quoi dont ou et mais donc or ni car si
  comme a dans par pour sur sous avec sans entre vers chez ne n pas plus moins tres tout tous toute toutes meme aussi
  est sont etait etaient ete etre ont avait avaient avoir fut furent sera seront soit`.split(/\s+/),
);

export function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae');
}

// Petits mots dont l'accent change le sens : « à » n'est pas « a » (avoir), « où » n'est pas « ou ».
const ACCENTED = new Set(['à', 'où', 'là']);

export function keyOf(word) {
  if (/^\d/.test(word)) return word.replace(/[\s  ]/g, '');
  const low = word.toLowerCase();
  return ACCENTED.has(low) ? low : normalize(word);
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
  const mark = text => {
    const tokens = tokenize(text).map(t => (typeof t === 'string' ? t : words.push({ text: t.w, key: keyOf(t.w) }) - 1));
    annotateNumbers(tokens, words);
    return tokens;
  };
  const titleTokens = mark(title);
  const paragraphs = cleanExtract(extract)
    .split(/\n+/)
    .map(p => p.replace(/[ \t ]{2,}/g, ' ').replace(/ ([,.])/g, '$1').trim())
    .filter(Boolean)
    .map(mark);
  return { titleTokens, paragraphs, words, titleWords: titleTokens.filter(t => typeof t === 'number') };
}

// Nombres, dates et mots qui comptent (mois, jours, nombres en lettres, chiffres romains)

const MONTHS = new Map('janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre'.split(' ').map((m, i) => [m, i + 1]));
const WEEKDAYS = new Map('lundi mardi mercredi jeudi vendredi samedi dimanche'.split(' ').map((d, i) => [d, i + 1]));
const NUMBER_WORDS = new Map(
  Object.entries({
    deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, dix: 10, onze: 11, douze: 12, treize: 13,
    quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, cent: 100,
    mille: 1000, million: 1e6, millions: 1e6, milliard: 1e9, milliards: 1e9, premier: 1, premiere: 1, premiers: 1,
    second: 2, seconde: 2, deuxieme: 2, troisieme: 3, quatrieme: 4, cinquieme: 5, sixieme: 6, septieme: 7,
    huitieme: 8, neuvieme: 9, dixieme: 10, vingtieme: 20, centieme: 100, millieme: 1000,
  }),
);
const ORDINAL = new Set(['e', 'er', 're', 'eme', 'nd', 'nde']);
const UNITS = new Set(
  `km m cm mm kg g t l ha mi euros euro dollars francs habitants personnes metres kilometres tonnes millions milliards
  ans jours heures minutes secondes places exemplaires spectateurs visiteurs morts victimes soldats`.split(/\s+/),
);
const YEAR_BEFORE = new Set(['en', 'vers', 'depuis', 'des', 'an', 'annee', 'annees']);
const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const ROMAN_PARTS = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

// « XIX », « XIXe », « Ier » → 19, 19, 1. Une lettre seule (« C » de J.-C.) n'en est pas un.
export function roman(text) {
  const m = /^([IVXLCDM]+)(er|re|e|ème|eme)?$/.exec(text);
  if (!m || (m[1].length < 2 && !m[2])) return null;
  let n = 0;
  for (let i = 0; i < m[1].length; i++) {
    const v = ROMAN[m[1][i]];
    n += v < (ROMAN[m[1][i + 1]] ?? 0) ? -v : v;
  }
  let canonical = '', rest = n;
  for (const [v, s] of ROMAN_PARTS) {
    while (rest >= v) {
      canonical += s;
      rest -= v;
    }
  }
  return canonical === m[1] ? n : null;
}

// Sorte de chaque nombre d'après les mots autour : année (« en 1889 », « 382 av. J.-C. »), siècle (« XIXe siècle »),
// jour (« 21 septembre »), quantité (« 330 m »), mois ou jour de la semaine.
function annotateNumbers(tokens, words) {
  const ids = tokens.filter(t => typeof t === 'number');
  const keyAt = k => words[ids[k]]?.key ?? '';
  ids.forEach((i, k) => {
    const w = words[i];
    const prev = keyAt(k - 1), next = keyAt(k + 1), next2 = keyAt(k + 2);
    const siecle = s => s === 'siecle' || s === 'siecles';
    if (MONTHS.has(w.key) && (/^\d/.test(prev) || /^\d{3,4}$/.test(next))) w.num = { kind: 'month', value: MONTHS.get(w.key) };
    else if (WEEKDAYS.has(w.key)) w.num = { kind: 'weekday', value: WEEKDAYS.get(w.key) };
    else if (NUMBER_WORDS.has(w.key)) w.num = { kind: 'qty', value: NUMBER_WORDS.get(w.key) };
    else if (/^\d/.test(w.key)) {
      const value = Number(w.key.replace(',', '.'));
      const after = tokens[tokens.indexOf(i) + 1];
      if (ORDINAL.has(next) && siecle(next2)) w.num = { kind: 'century', value };
      else if (next === 'av' || next === 'avant') w.num = { kind: 'year', value: -value };
      else if (UNITS.has(next) || (typeof after === 'string' && /^\s*%/.test(after))) w.num = { kind: 'qty', value };
      else if (value <= 31 && (MONTHS.has(next) || (ORDINAL.has(next) && MONTHS.has(next2)))) w.num = { kind: 'day', value };
      else if ((value >= 1000 && value <= 2100 && !w.key.includes(',')) || (YEAR_BEFORE.has(prev) && value <= 2100)) w.num = { kind: 'year', value };
      else w.num = { kind: 'qty', value };
    } else {
      const r = roman(w.text);
      if (r) w.num = { kind: siecle(next) ? 'century' : 'roman', value: r };
    }
  });
}

// Pages enregistrées avant l'annotation : on devine la sorte d'un nombre d'après sa seule valeur.
function wordNum(w) {
  if (w.num !== undefined || !/^\d/.test(w.key)) return w.num ?? null;
  const value = Number(w.key.replace(',', '.'));
  return { kind: value >= 1000 && value <= 2100 ? 'year' : 'qty', value };
}

function guessNum(raw) {
  const k = keyOf(raw);
  if (/^\d/.test(k)) return { value: Number(k.replace(',', '.')) };
  if (MONTHS.has(k)) return { month: MONTHS.get(k) };
  if (WEEKDAYS.has(k)) return { weekday: WEEKDAYS.get(k) };
  if (NUMBER_WORDS.has(k)) return { value: NUMBER_WORDS.get(k) };
  const r = roman(raw);
  return r ? { value: r } : null;
}

// Écart d sur une échelle « range » : 1 pour un écart nul, 0,3 (à peine tiède) quand d = range, rien au-delà.
function scaled(d, range) {
  if (d === 0) return EQUAL;
  const t = 1 - 0.7 * Math.sqrt(d / range);
  return t >= HINT_MIN ? t : 0;
}

// Proximité entre deux nombres, de la même sorte que le nombre caché. null : pas des nombres, on compare le sens.
export function numberCloseness(g, h) {
  if (!g || !h) return null;
  if (h.kind === 'month' || h.kind === 'weekday') {
    const a = h.kind === 'month' ? g.month : g.weekday;
    if (!a) return null;
    const n = h.kind === 'month' ? 12 : 7, d = Math.abs(a - h.value);
    return scaled(Math.min(d, n - d), h.kind === 'month' ? 3 : 2);
  }
  if (g.value === undefined) return null;
  const v = g.value;
  if (h.kind === 'year') return scaled(Math.abs(Math.abs(v) - Math.abs(h.value)), 120);
  if (h.kind === 'century') {
    if (v <= 31) return scaled(Math.abs(v - h.value), 10);
    const lo = (h.value - 1) * 100 + 1, hi = h.value * 100;
    return v >= lo && v <= hi ? EQUAL : scaled(v < lo ? lo - v : v - hi, 120);
  }
  if (h.kind === 'day' || h.kind === 'roman') return scaled(Math.abs(v - h.value), 10);
  if (v === h.value) return EQUAL;

  // Une quantité ne se compare pas à une valeur qui ressemble à une année (« 1888 » et « 337 » mètres)
  const yearLike = x => x >= 1000 && x <= 2100;
  if (yearLike(v) !== yearLike(h.value)) return 0;
  const t = 1 - 0.7 * Math.sqrt(Math.abs(Math.log10((v + 1) / (h.value + 1))) / 0.8);
  return t >= HINT_MIN ? t : 0;
}

// Nationalités : mot de base, pays, formes en « -o » (« américano- »). La forme en « -o » se dévoile avec la nationalité,
// le pays donne un indice brûlant, et deux nationalités différentes ne se ressemblent plus.
const NATIONS = [
  ['americain', 'amerique', 'americano'], ['anglais', 'angleterre', 'anglo'], ['britannique', '', ''],
  ['francais', 'france', 'franco'], ['allemand', 'allemagne', 'germano'], ['italien', 'italie', 'italo'],
  ['espagnol', 'espagne', 'hispano'], ['portugais', 'portugal', 'luso'], ['russe', 'russie', 'russo'],
  ['chinois', 'chine', 'sino'], ['japonais', 'japon', 'nippo'], ['autrichien', 'autriche', 'austro'],
  ['suisse', '', 'helvetico'], ['belge', 'belgique', 'belgo'], ['grec', 'grece', 'greco'], ['turc', 'turquie', 'turco'],
  ['iranien', 'iran', 'irano'], ['irakien', 'irak', 'irako'], ['israelien', 'israel', 'israelo'],
  ['palestinien', 'palestine', 'palestino'], ['indien', 'inde', 'indo'], ['africain', 'afrique', 'afro'],
  ['europeen', 'europe', ''], ['arabe', '', 'arabo'], ['polonais', 'pologne', 'polono'],
  ['hongrois', 'hongrie', 'hungaro hongro'], ['tcheque', 'tchequie', 'tcheco'], ['serbe', 'serbie', 'serbo'],
  ['croate', 'croatie', 'croato'], ['bulgare', 'bulgarie', 'bulgaro'], ['roumain', 'roumanie', 'roumano'],
  ['finlandais', 'finlande', 'finno'], ['egyptien', 'egypte', 'egypto'], ['syrien', 'syrie', 'syro'],
  ['libanais', 'liban', 'libano'], ['saoudien', 'arabie', 'saoudo'], ['marocain', 'maroc', 'maroco'],
  ['algerien', 'algerie', 'algero'], ['tunisien', 'tunisie', 'tuniso'], ['senegalais', 'senegal', 'senegalo'],
  ['quebecois', 'quebec', 'quebeco'], ['mexicain', 'mexique', 'mexicano'], ['canadien', 'canada', 'canado'],
  ['ecossais', 'ecosse', ''], ['irlandais', 'irlande', ''], ['neerlandais', '', 'neerlando'], ['hollandais', 'hollande', ''],
  ['suedois', 'suede', 'suedo'], ['norvegien', 'norvege', 'norvego'], ['danois', 'danemark', 'dano'],
  ['bresilien', 'bresil', ''], ['argentin', 'argentine', 'argentino'], ['chilien', 'chili', ''],
  ['australien', 'australie', 'australo'], ['ukrainien', 'ukraine', 'ukraino'], ['coreen', 'coree', ''],
  ['vietnamien', 'vietnam', ''], ['cubain', 'cuba', 'cubano'], ['colombien', 'colombie', ''], ['peruvien', 'perou', ''],
  ['venezuelien', 'venezuela', ''], ['afghan', 'afghanistan', 'afghano'], ['pakistanais', 'pakistan', ''],
  ['thailandais', 'thailande', ''], ['indonesien', 'indonesie', ''], ['armenien', 'armenie', 'armeno'],
  ['georgien', 'georgie', ''], ['islandais', 'islande', ''], ['luxembourgeois', 'luxembourg', ''],
  ['sovietique', 'urss', 'sovieto'], ['nigerian', 'nigeria', ''], ['ethiopien', 'ethiopie', ''],
  ['lituanien', 'lituanie', 'lituano'], ['tibetain', 'tibet', 'tibeto'],
];
const NATION = new Set(NATIONS.map(([n]) => n));
const COUNTRY_OF = new Map(NATIONS.filter(([, c]) => c).map(([n, c]) => [c, n]));
const COMBO_OF = new Map(NATIONS.flatMap(([n, , c]) => (c ? c.split(' ').map(x => [x, n]) : [])));

// Petits mots qui se dévoilent ensemble : formes au féminin, au pluriel, contractées ou élidées (« de » dévoile « du », « à » dévoile « au »).
const GROUPS = [
  'le la les l',
  'un une',
  'de du des d',
  'à au aux',
  'se s',
  'si s',
  'je j',
  'me m',
  'te t',
  'ne n',
  'que qu',
  'jusque jusqu',
  'lorsque lorsqu',
  'puisque puisqu',
  'quoique quoiqu',
  'ce cet cette ces c',
  'mon ma mes',
  'ton ta tes',
  'son sa ses',
  'notre nos',
  'votre vos',
  'leur leurs',
  'il ils elle elles',
  'celui celle ceux celles',
  'quel quelle quels quelles',
  'lequel laquelle lesquels lesquelles',
  'tout toute tous toutes',
];
const GROUP_OF = new Map();
for (const words of GROUPS.map(g => g.split(' '))) {
  for (const w of words) GROUP_OF.set(w, [...(GROUP_OF.get(w) ?? []), `#${words[0]}`]);
}

// Formes élidées (l', s', qu'…) : rattachées seulement à leurs petits mots, pas au dictionnaire (« s » y est relié à « avoir »).
const ELIDED = new Set(['l', 'd', 'j', 'm', 't', 's', 'n', 'c', 'qu', 'jusqu', 'lorsqu', 'puisqu', 'quoiqu']);

export function describe(key, lex) {
  const groups = GROUP_OF.get(key) ?? [];
  if (ELIDED.has(key)) return { lemmas: new Set(groups), row: -1, stop: true, plain: key };
  const country = COUNTRY_OF.get(key) ?? null;
  const i = lex ? lex.find(key) : -1;
  const ids = i < 0 ? [] : [...lex.lemmas(i)];
  const bases = i < 0 ? [key] : ids.length ? ids.map(id => lex.keyAt(id)) : [key];
  const nation = COMBO_OF.get(key) ?? bases.find(b => NATION.has(b)) ?? null;
  const lemmas = new Set([...(i < 0 ? [key] : ids.length ? ids : [i]), ...groups]);
  if (nation) lemmas.add(`#nat-${nation}`);
  const stop = STOP.has(key);
  let row = -1;
  if (i >= 0 && !stop) {
    row = lex.row(i);
    for (let j = 0; row < 0 && j < ids.length; j++) row = lex.row(ids[j]);
  }
  return { lemmas, row, nation, country, stop, plain: normalize(key) };
}

export function analyze(page, lex) {
  const keys = new Map();
  page.words.forEach((w, i) => {
    if (!keys.has(w.key)) keys.set(w.key, { key: w.key, plain: normalize(w.key), pos: [], num: wordNum(w), ...describe(w.key, lex) });
    keys.get(w.key).pos.push(i);
  });
  return keys;
}

// Proximité de sens, calibrée sur le mot caché : brûlant si le mot proposé est parmi ses 10 plus proches voisins,
// chaud parmi ses 100, tiède parmi ses 500. Sans ces seuils (anciennes données), échelle fixe sur la similarité.
function semantic(g, e, lex) {
  if (g.row < 0 || e.row < 0) return 0;
  const cos = lex.cosine(g.row, e.row);
  const cut = lex.cutoffs?.(e.row);
  if (!cut) return cos >= 0.4 ? 0.3 + 0.7 * Math.min(1, (cos - 0.4) / 0.45) : 0;
  const [c10, c100, c500] = cut;
  if (cos < Math.max(c500, 0.25)) return 0;
  if (cos >= c10) return Math.min(0.99, 0.9 + (0.09 * (cos - c10)) / Math.max(0.01, 1 - c10));
  if (cos >= c100) return 0.6 + (0.3 * (cos - c100)) / Math.max(0.01, c10 - c100);
  return 0.3 + (0.3 * (cos - c500)) / Math.max(0.01, c100 - c500);
}

// Longueur du plus long morceau commun à deux mots.
function common(a, b) {
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = b.length; j >= 1; j--) {
      prev[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : 0;
      best = Math.max(best, prev[j]);
    }
  }
  return best;
}

// Mots sans vecteur (rares, noms savants) : on compare l'orthographe. Un morceau commun d'au moins 5 lettres
// donne un indice, au plus chaud (« tyrannosaure » et « Spinosaurus » partagent « osaur »).
export function spelling(a, b) {
  if (a.length < 6 || b.length < 6) return 0;
  const n = common(a, b);
  return n < 5 ? 0 : Math.min(0.7, 0.3 + (0.5 * n) / Math.min(a.length, b.length));
}

export function closeness(g, e, lex) {
  const n = numberCloseness(g.num, e.num);
  if (n !== null) return n;
  if ((g.nation && g.nation === e.country) || (g.country && g.country === e.nation)) return 0.9;
  let t = semantic(g, e, lex);
  if (!t && (g.row < 0 || e.row < 0) && !g.stop && !e.stop) t = spelling(g.plain, e.plain);
  return (g.nation || g.country) && (e.nation || e.country) ? Math.min(t, 0.35) : t;
}

export const newRun = () => ({ revealed: new Set(), hints: new Map(), tried: new Set(), guesses: [], foundAt: null });

function shares(a, b) {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

// Un mot caché se dévoile s'il s'écrit pareil, accents mis à part, ou s'il a la même forme de base.
function uncover(page, keys, run, g, key) {
  const plain = normalize(key);
  const out = [];
  for (const e of keys.values()) {
    if (run.revealed.has(e.key) || (e.plain !== plain && !shares(e.lemmas, g.lemmas))) continue;
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
    const w = raw.toLowerCase(), k = keyOf(raw), plain = normalize(k);
    const pending = [...keys.values()].some(e => e.plain === plain && !run.revealed.has(e.key));
    if (run.tried.has(k) || (run.revealed.has(k) && !pending)) {
      res.items.push({ w, dup: true });
      continue;
    }
    run.tried.add(k);
    const g = { ...describe(k, lex), num: guessNum(raw) };

    // Sans accent, « a » vaut aussi « à » : il en dévoile les formes (« au », « aux »).
    for (const a of ACCENTED) if (normalize(a) === plain) for (const grp of GROUP_OF.get(a) ?? []) g.lemmas.add(grp);

    const found = uncover(page, keys, run, g, k);
    res.revealed.push(...found);
    let best = 0;
    for (const e of keys.values()) {
      if (run.revealed.has(e.key)) continue;
      const s = closeness(g, e, lex);
      best = Math.max(best, s);
      if (s < HINT_MIN || s <= (run.hints.get(e.key)?.s ?? 0)) continue;
      run.hints.set(e.key, { w, s });
      for (const i of e.pos) res.hints.push([i, w, round(s)]);
    }
    const item = { w, n: found.length, s: best >= HINT_MIN ? round(best) : 0, at: found.map(([i]) => i) };
    run.guesses.push(item);
    res.items.push({ ...item });
  }
  return res;
}

export const revealedCount = (page, run) => page.words.reduce((n, w) => n + run.revealed.has(w.key), 0);

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

// Ce que voit un joueur, pour la caméra du meneur : positions dévoilées et mots proches affichés.
export function camView(page, run) {
  const revealed = [], hints = [];
  page.words.forEach((w, i) => {
    const h = run.hints.get(w.key);
    if (run.revealed.has(w.key)) revealed.push(i);
    else if (h) hints.push([i, h.w, round(h.s)]);
  });
  return { revealed, hints, found: run.foundAt != null };
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
    const count = revealedCount(page, r);
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

// Lit words.bin, vectors.bin et variantes.json, produits par tools/prepare_data.py.
const VALID = /^[a-z0-9]+$/;

export class Lexicon {
  constructor(words, vectors, variants = null) {
    // words.bin : « PKW1 », ou « PKW2 » qui dit en plus, pour chaque mot, s'il vient du dictionnaire des formes
    const w = new DataView(words);
    const version = w.getUint32(0, true);
    if (version !== 0x31574b50 && version !== 0x32574b50) throw new Error('words.bin invalide');
    const [n, size, poolSize, lemmaCount] = [4, 8, 12, 16].map(o => w.getUint32(o, true));
    let o = 20;
    const take = (Type, len) => {
      const a = new Type(words, o, len);
      o += len * Type.BYTES_PER_ELEMENT;
      return a;
    };
    this.keyOffset = take(Uint32Array, n + 1);
    this.vecRow = take(Int32Array, n);
    this.lemmaStart = take(Uint32Array, n + 1);
    this.lemmaPool = take(Uint32Array, lemmaCount);
    this.table = take(Uint32Array, size);
    this.pool = take(Uint8Array, poolSize);
    this.lexique = version === 0x32574b50 ? take(Uint8Array, n) : null;
    this.mask = size - 1;

    // vectors.bin : « PKV1 » les vecteurs seuls, « PKV2 » suivis de 3 seuils de proximité par mot (10e, 100e, 500e voisin),
    // « PKV3 » d'autant de seuils que l'en-tête l'indique (aujourd'hui 4 : 10e, 100e, 500e, 5 000e voisin)
    const v = new DataView(vectors);
    const magic = v.getUint32(0, true);
    if (magic !== 0x31564b50 && magic !== 0x32564b50 && magic !== 0x33564b50) throw new Error('vectors.bin invalide');
    const count = v.getUint32(4, true);
    this.dims = v.getUint32(8, true);
    this.ncut = magic === 0x33564b50 ? v.getUint32(12, true) : magic === 0x32564b50 ? 3 : 0;
    const start = magic === 0x33564b50 ? 16 : 12;
    this.vectors = new Int8Array(vectors, start, count * this.dims);
    this.cut = this.ncut ? new Int8Array(vectors, start + count * this.dims, count * this.ncut) : null;

    // variantes.json : écriture → ligne de son vecteur, pour les écritures dont le sens diffère de la plus courante
    this.variants = new Map(Object.entries(variants ?? {}));
  }

  // Ligne du vecteur d'une écriture précise (« vénus » la planète, « Mars »), ou -1 si elle n'a pas de sens à elle.
  variant(spelling) {
    return this.variants.get(spelling) ?? -1;
  }

  // Similarité du 10e, du 100e, du 500e et (données récentes) du 5 000e voisin le plus proche de ce mot.
  cutoffs(row) {
    if (!this.cut) return null;
    return Array.from(this.cut.subarray(row * this.ncut, (row + 1) * this.ncut), c => c / 127);
  }

  // Le mot vient-il du dictionnaire des formes ? Sans l'information (anciennes données), on le suppose.
  known(i) {
    return this.lexique ? this.lexique[i] === 1 : true;
  }

  keyAt(i) {
    let s = '';
    for (let j = this.keyOffset[i]; j < this.keyOffset[i + 1]; j++) s += String.fromCharCode(this.pool[j]);
    return s;
  }

  find(key) {
    if (!VALID.test(key)) return -1;
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
    for (let s = h & this.mask; ; s = (s + 1) & this.mask) {
      const e = this.table[s];
      if (!e) return -1;
      if (this.is(e - 1, key)) return e - 1;
    }
  }

  is(i, key) {
    const a = this.keyOffset[i];
    if (this.keyOffset[i + 1] - a !== key.length) return false;
    for (let j = 0; j < key.length; j++) if (this.pool[a + j] !== key.charCodeAt(j)) return false;
    return true;
  }

  lemmas(i) {
    return this.lemmaPool.subarray(this.lemmaStart[i], this.lemmaStart[i + 1]);
  }

  row(i) {
    return this.vecRow[i];
  }

  cosine(a, b) {
    const d = this.dims, v = this.vectors;
    let ab = 0, aa = 0, bb = 0;
    for (let j = 0, x = a * d, y = b * d; j < d; j++) {
      const p = v[x + j], q = v[y + j];
      ab += p * q;
      aa += p * p;
      bb += q * q;
    }
    return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
  }
}

// Lit words.bin et vectors.bin, produits par tools/prepare_data.py.
const VALID = /^[a-z0-9]+$/;

export class Lexicon {
  constructor(words, vectors) {
    const w = new DataView(words);
    if (w.getUint32(0, true) !== 0x31574b50) throw new Error('words.bin invalide');
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
    this.mask = size - 1;

    const v = new DataView(vectors);
    if (v.getUint32(0, true) !== 0x31564b50) throw new Error('vectors.bin invalide');
    this.dims = v.getUint32(8, true);
    this.vectors = new Int8Array(vectors, 12, v.getUint32(4, true) * this.dims);
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

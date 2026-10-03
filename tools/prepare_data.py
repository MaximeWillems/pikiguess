"""Prépare les données de Pikiguess : vecteurs de mots (Fauconnier) et formes des mots (Lexique 3.83).

Usage : python tools/prepare_data.py <modèle word2vec .bin> <Lexique383.tsv> <dossier de sortie> [--dims N]

Produit words.bin et vectors.bin, lus par src/lexicon.js.
Les mots y sont normalisés (minuscules, sans accents), comme dans src/game.js.
vectors.bin contient aussi, pour chaque mot, la similarité de son 10e, 100e et 500e voisin le plus proche :
c'est ce qui calibre les mots proches (tiède, chaud, brûlant) mot par mot.
"""
import argparse
import csv
import io
import re
import sys
import unicodedata
from pathlib import Path

import numpy as np

MAX_FILE = 25 * 1024 * 1024
RANKS = (10, 100, 500)
VALID = re.compile(r"[a-z0-9]+")
ELISIONS = {
    "l": {"le"}, "d": {"de"}, "j": {"je"}, "m": {"me"}, "t": {"te"}, "s": {"se", "si"},
    "n": {"ne"}, "c": {"ce"}, "qu": {"que"}, "jusqu": {"jusque"}, "lorsqu": {"lorsque"},
    "puisqu": {"puisque"}, "quoiqu": {"quoique"},
}
PROBES = ["roi", "napoléon", "paris", "1789", "guerre", "fleuve", "planète", "chat", "borgne", "manger", "tyrannosaure", "théropode", "spinosaurus"]


def normalize(s):
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.replace("œ", "oe").replace("æ", "ae")


def fnv1a(s):
    h = 0x811C9DC5
    for b in s.encode("ascii"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def read_word2vec(path):
    data = Path(path).read_bytes()
    nl = data.index(b"\n")
    n, dims = map(int, data[:nl].split())
    words = []
    vectors = np.empty((n, dims), dtype=np.float32)
    pos = nl + 1
    for i in range(n):
        while data[pos] in (10, 32):
            pos += 1
        end = data.index(b" ", pos)
        raw = data[pos:end]
        try:
            words.append(raw.decode("utf-8"))
        except UnicodeDecodeError:
            words.append(raw.decode("latin-1"))
        vectors[i] = np.frombuffer(data, dtype="<f4", count=dims, offset=end + 1)
        pos = end + 1 + 4 * dims
    return words, vectors


def read_lexique(path):
    raw = Path(path).read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    rows = csv.DictReader(io.StringIO(text), delimiter="\t", quoting=csv.QUOTE_NONE)
    if not {"ortho", "lemme"} <= set(rows.fieldnames or []):
        sys.exit(f"Colonnes ortho et lemme absentes de {path} : {rows.fieldnames}")
    forms = {}
    for row in rows:
        form, lemma = normalize(row["ortho"]), normalize(row["lemme"] or row["ortho"])
        if VALID.fullmatch(form) and VALID.fullmatch(lemma):
            forms.setdefault(form, set()).add(lemma)
    return forms


def unit(m):
    return m / np.maximum(np.linalg.norm(m, axis=1, keepdims=True), 1e-9)


def reduce_dims(m, dims):
    """Garde les « dims » directions principales des vecteurs, pour que le fichier tienne en ligne."""
    m = m - m.mean(axis=0)
    _, axes = np.linalg.eigh(m.T @ m)
    return m @ axes[:, -dims:]


def neighbour_cutoffs(q):
    """Pour chaque mot, la similarité de son 10e, 100e et 500e voisin le plus proche (lui-même exclu)."""
    f = unit(q.astype(np.float32))
    n = len(f)
    if n < 2:
        return np.zeros((n, len(RANKS)), dtype=np.int8)
    kth = [min(r, n - 1) - 1 for r in RANKS]
    out = np.zeros((n, len(RANKS)), dtype=np.float32)
    for start in range(0, n, 1000):
        s = f[start:start + 1000] @ f.T
        s[np.arange(len(s)), np.arange(start, start + len(s))] = -2
        out[start:start + len(s)] = -np.partition(-s, kth, axis=1)[:, kth]
    return np.clip(np.rint(out * 127), -127, 127).astype(np.int8)


def report(q, rows, cut):
    if len(q) < 2:
        return
    f = unit(q.astype(np.float32))
    by_row = {r: k for k, r in rows.items()}
    for j, r in enumerate(RANKS):
        print(f"Similarité du {r}e voisin : médiane {np.median(cut[:, j]) / 127:.2f}, 10e centile {np.percentile(cut[:, j], 10) / 127:.2f}, 90e centile {np.percentile(cut[:, j], 90) / 127:.2f}")
    a, b = np.random.default_rng(0).integers(0, len(f), (2, 20000))
    sims = np.sum(f[a] * f[b], axis=1)
    print("Proximité de mots pris au hasard : " + ", ".join(f"{p}e centile {np.percentile(sims, p):.2f}" for p in (50, 90, 99, 99.9)))
    for probe in PROBES:
        r = rows.get(normalize(probe))
        if r is None:
            print(f"{probe} : absent")
            continue
        s = f @ f[r]
        top = [t for t in np.argsort(-s)[:11] if t != r][:10]
        print(f"{probe} : " + ", ".join(f"{by_row[t]} {s[t]:.2f}" for t in top))


def main(model_path, lexique_path, out_dir, dims=None, max_vectors=None):
    words, vectors = read_word2vec(model_path)
    forms = read_lexique(lexique_path)
    for form, lemmas in ELISIONS.items():
        forms.setdefault(form, set()).update(lemmas)

    rows, order = {}, []
    for i, w in enumerate(words):
        k = normalize(w)
        if VALID.fullmatch(k) and k not in rows:
            rows[k] = len(order)
            order.append(i)
            if len(order) == max_vectors:
                break

    keys = list(rows)
    index = {k: i for i, k in enumerate(keys)}
    for form, lemmas in forms.items():
        for k in (form, *sorted(lemmas)):
            if k not in index:
                index[k] = len(keys)
                keys.append(k)

    lemma_start, lemma_pool = [0], []
    for k in keys:
        lemmas = forms.get(k, {k})
        if lemmas != {k}:
            lemma_pool += sorted(index[l] for l in lemmas)
        lemma_start.append(len(lemma_pool))

    size = 1
    while size < 2 * len(keys):
        size *= 2
    table = np.zeros(size, dtype="<u4")
    for i, k in enumerate(keys):
        h = fnv1a(k) & (size - 1)
        while table[h]:
            h = (h + 1) & (size - 1)
        table[h] = i + 1

    pool = "".join(keys).encode("ascii")
    offsets = np.cumsum([0] + [len(k) for k in keys])
    words_bin = b"".join([
        b"PKW1",
        np.array([len(keys), size, len(pool), len(lemma_pool)], dtype="<u4").tobytes(),
        offsets.astype("<u4").tobytes(),
        np.array([rows.get(k, -1) for k in keys], dtype="<i4").tobytes(),
        np.array(lemma_start, dtype="<u4").tobytes(),
        np.array(lemma_pool, dtype="<u4").tobytes(),
        table.tobytes(),
        pool,
    ])

    # Autant de dimensions que la limite de 25 Mio le permet (vecteurs + 3 seuils par mot), « dims » au plus
    m = unit(vectors[order])
    fit = (MAX_FILE - 12 - 3 * len(order)) // max(1, len(order))
    dims = min(m.shape[1], dims or m.shape[1], fit)
    if dims < m.shape[1]:
        m = unit(reduce_dims(m, dims))
    q = np.clip(np.rint(m * 127), -127, 127).astype(np.int8)
    cut = neighbour_cutoffs(q)
    vectors_bin = b"PKV2" + np.array([len(order), q.shape[1]], dtype="<u4").tobytes() + q.tobytes() + cut.tobytes()

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for name, content in (("words.bin", words_bin), ("vectors.bin", vectors_bin)):
        if len(content) > MAX_FILE:
            sys.exit(f"{name} dépasse 25 Mio ({len(content)} octets)")
        (out / name).write_bytes(content)
        print(f"{name} : {len(content) / 1e6:.1f} Mo")

    print(f"{len(words)} mots dans le modèle, {len(order)} vecteurs gardés de {q.shape[1]} dimensions, {len(keys)} mots connus, {len(forms)} formes")
    report(q, rows, cut)


if __name__ == "__main__":
    args = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    args.add_argument("model")
    args.add_argument("lexique")
    args.add_argument("out")
    args.add_argument("--dims", type=int, help="réduire les vecteurs à ce nombre de dimensions")
    args.add_argument("--max-vectors", type=int, help="ne garder que les N mots les plus fréquents (par défaut : tous)")
    a = args.parse_args()
    main(a.model, a.lexique, a.out, a.dims, a.max_vectors)

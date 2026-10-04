"""Prépare les données de Pikiguess : vecteurs de mots (Fauconnier) et formes des mots (Lexique 3.83).

Usage : python tools/prepare_data.py <modèle word2vec .bin> <Lexique383.tsv> <dossier de sortie> [--dims N]

Produit words.bin et vectors.bin, lus par src/lexicon.js, et formes.tsv, que tools/prepare_help.mjs transforme en aide.bin.
Les mots y sont normalisés (minuscules, sans accents), comme dans src/game.js.
vectors.bin contient aussi, pour chaque mot, la similarité de son 10e, 100e, 500e et 5 000e voisin le plus proche :
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
RANKS = (10, 100, 500, 5000)
VALID = re.compile(r"[a-z0-9]+")
ELISIONS = {
    "l": {"le"}, "d": {"de"}, "j": {"je"}, "m": {"me"}, "t": {"te"}, "s": {"se", "si"},
    "n": {"ne"}, "c": {"ce"}, "qu": {"que"}, "jusqu": {"jusque"}, "lorsqu": {"lorsque"},
    "puisqu": {"puisque"}, "quoiqu": {"quoique"},
}
PROBES = ["roi", "napoléon", "paris", "1789", "guerre", "fleuve", "planète", "chat", "borgne", "manger", "tyrannosaure", "théropode", "spinosaurus", "suite", "roche", "dur"]
# Paires signalées en partie : similarité et rang de chaque mot parmi les voisins de l'autre
PAIRS = [("suite", "saga"), ("suite", "trilogie"), ("suite", "film"), ("québec", "canadien"), ("tyrannosaure", "dinosaure"), ("roche", "dur"), ("roches", "dur"), ("roche", "dure"), ("roche", "pierre")]


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


def number(s):
    try:
        return float(s or 0)
    except ValueError:
        return 0.0


def read_lexique(path):
    """Les formes de chaque mot, et son orthographe la plus fréquente avec accents (fréquence films + livres)."""
    raw = Path(path).read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    rows = csv.DictReader(io.StringIO(text), delimiter="\t", quoting=csv.QUOTE_NONE)
    if not {"ortho", "lemme"} <= set(rows.fieldnames or []):
        sys.exit(f"Colonnes ortho et lemme absentes de {path} : {rows.fieldnames}")
    forms, spelled = {}, {}
    for row in rows:
        form, lemma = normalize(row["ortho"]), normalize(row["lemme"] or row["ortho"])
        if VALID.fullmatch(form) and VALID.fullmatch(lemma):
            forms.setdefault(form, set()).add(lemma)
            freq = number(row.get("freqfilms2")) + number(row.get("freqlivres"))
            best, top, total = spelled.get(form, (row["ortho"], -1.0, 0.0))
            spelled[form] = (row["ortho"], freq, total + freq) if freq > top else (best, top, total + freq)
    return forms, spelled


def unit(m):
    return m / np.maximum(np.linalg.norm(m, axis=1, keepdims=True), 1e-9)


def reduce_dims(m, dims):
    """Garde les « dims » directions principales des vecteurs, pour que le fichier tienne en ligne."""
    m = m - m.mean(axis=0)
    _, axes = np.linalg.eigh(m.T @ m)
    return m @ axes[:, -dims:]


def neighbour_cutoffs(q):
    """Pour chaque mot, la similarité de son 10e, 100e, 500e et 5 000e voisin le plus proche (lui-même exclu)."""
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
    for a, b in PAIRS:
        ra, rb = rows.get(normalize(a)), rows.get(normalize(b))
        if ra is None or rb is None:
            print(f"{a} / {b} : absent")
            continue
        cos = float(f[ra] @ f[rb])
        seuils = " / ".join(f"{c / 127:.2f}" for c in cut[ra])
        print(f"{a} / {b} : similarité {cos:.2f} ; {b} est le {int((f @ f[ra] > cos).sum())}e voisin de {a} (seuils de {a}, {' / '.join(f'{r}e' for r in RANKS)} voisin : {seuils}), {a} le {int((f @ f[rb] > cos).sum())}e de {b}")
    for probe in PROBES:
        r = rows.get(normalize(probe))
        if r is None:
            print(f"{probe} : absent")
            continue
        s = f @ f[r]
        top = [t for t in np.argsort(-s)[:11] if t != r][:10]
        print(f"{probe} : " + ", ".join(f"{by_row[t]} {s[t]:.2f}" for t in top))


def second_opinion(model_path, keys, out_dir):
    """Deuxième avis : les vecteurs d'un autre modèle (Wikipédia) pour les mots de words.bin, avec leurs seuils de voisins.

    wiki.bin (« PKS1 ») : nombre de mots, de vecteurs, de dimensions et de seuils, puis la ligne de chaque mot de words.bin
    dans ce modèle (-1 s'il n'y est pas), les vecteurs et les seuils, comme vectors.bin.
    """
    words, vectors = read_word2vec(model_path)
    first = {}
    for i, w in enumerate(words):
        k = normalize(w)
        if VALID.fullmatch(k) and k not in first:
            first[k] = i
    rows, order = {}, []
    for k in keys:
        if k in first:
            rows[k] = len(order)
            order.append(first[k])
    key_row = np.array([rows.get(k, -1) for k in keys], dtype="<i4")
    m = unit(vectors[order])
    del vectors

    # 200 dimensions au plus (le modèle en a 1 000), et pas plus que la limite de 25 Mio ne le permet
    fit = (MAX_FILE - 20 - 4 * len(keys) - len(RANKS) * len(order)) // max(1, len(order))
    dims = min(m.shape[1], fit, 200)
    if dims < m.shape[1]:
        m = unit(reduce_dims(m, dims))
    q = np.clip(np.rint(m * 127), -127, 127).astype(np.int8)
    cut = neighbour_cutoffs(q)
    head = np.array([len(keys), len(order), q.shape[1], len(RANKS)], dtype="<u4").tobytes()
    content = b"PKS1" + head + key_row.tobytes() + q.tobytes() + cut.tobytes()
    if len(content) > MAX_FILE:
        sys.exit(f"wiki.bin dépasse 25 Mio ({len(content)} octets)")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "wiki.bin").write_bytes(content)
    print(f"wiki.bin : {len(content) / 1e6:.1f} Mo, {len(words)} mots dans le modèle, {len(order)} mots du jeu gardés, {q.shape[1]} dimensions")
    report(q, rows, cut)


def main(model_path, lexique_path, out_dir, dims=None, max_vectors=None, second=None, second_out=None):
    words, vectors = read_word2vec(model_path)
    forms, spelled = read_lexique(lexique_path)
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

    # Mots du dictionnaire des formes (Lexique) : la règle du pluriel en -s ne s'applique qu'aux autres
    in_lexique = set(forms) | {l for ls in forms.values() for l in ls}
    known = np.array([k in in_lexique for k in keys], dtype=np.uint8)

    pool = "".join(keys).encode("ascii")
    offsets = np.cumsum([0] + [len(k) for k in keys])
    words_bin = b"".join([
        b"PKW2",
        np.array([len(keys), size, len(pool), len(lemma_pool)], dtype="<u4").tobytes(),
        offsets.astype("<u4").tobytes(),
        np.array([rows.get(k, -1) for k in keys], dtype="<i4").tobytes(),
        np.array(lemma_start, dtype="<u4").tobytes(),
        np.array(lemma_pool, dtype="<u4").tobytes(),
        table.tobytes(),
        pool,
        known.tobytes(),
    ])

    # Autant de dimensions que la limite de 25 Mio le permet (vecteurs + un seuil par rang et par mot), « dims » au plus
    m = unit(vectors[order])
    fit = (MAX_FILE - 16 - len(RANKS) * len(order)) // max(1, len(order))
    dims = min(m.shape[1], dims or m.shape[1], fit)
    if dims < m.shape[1]:
        m = unit(reduce_dims(m, dims))
    q = np.clip(np.rint(m * 127), -127, 127).astype(np.int8)
    cut = neighbour_cutoffs(q)
    vectors_bin = b"PKV3" + np.array([len(order), q.shape[1], len(RANKS)], dtype="<u4").tobytes() + q.tobytes() + cut.tobytes()

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    # Pour l'aide à l'écriture (tools/prepare_help.mjs en fait aide.bin) : orthographe avec accents et rang de fréquence
    # de chaque mot. Ceux du modèle sont déjà rangés par fréquence ; ceux du seul Lexique viennent après, par sa fréquence.
    rare = sorted((k for k in keys if k not in rows), key=lambda k: -spelled.get(k, ("", 0, 0))[2])
    rank = {k: len(order) + j for j, k in enumerate(rare)}
    lines = []
    for k in keys:
        shown = spelled[k][0] if k in spelled else words[order[rows[k]]] if k in rows else k
        lines.append(f"{shown if normalize(shown) == k else k}\t{rows[k] if k in rows else rank[k]}\n")
    (out / "formes.tsv").write_text("".join(lines), encoding="utf-8")

    for name, content in (("words.bin", words_bin), ("vectors.bin", vectors_bin)):
        if len(content) > MAX_FILE:
            sys.exit(f"{name} dépasse 25 Mio ({len(content)} octets)")
        (out / name).write_bytes(content)
        print(f"{name} : {len(content) / 1e6:.1f} Mo")

    print(f"{len(words)} mots dans le modèle, {len(order)} vecteurs gardés de {q.shape[1]} dimensions, {len(keys)} mots connus, {len(forms)} formes")
    report(q, rows, cut)

    if second:
        del words, vectors, m, q
        print("===== Deuxième avis")
        second_opinion(second, keys, second_out or out_dir)


if __name__ == "__main__":
    args = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    args.add_argument("model")
    args.add_argument("lexique")
    args.add_argument("out")
    args.add_argument("--dims", type=int, help="réduire les vecteurs à ce nombre de dimensions")
    args.add_argument("--max-vectors", type=int, help="ne garder que les N mots les plus fréquents (par défaut : tous)")
    args.add_argument("--second", help="autre modèle word2vec (Wikipédia) : écrit wiki.bin, le deuxième avis")
    args.add_argument("--second-out", help="dossier de wiki.bin (par défaut : celui des autres données)")
    a = args.parse_args()
    main(a.model, a.lexique, a.out, a.dims, a.max_vectors, a.second, a.second_out)

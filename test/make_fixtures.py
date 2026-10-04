"""Crée de petites données factices et lance tools/prepare_data.py dessus, pour les tests."""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import prepare_data  # noqa: E402

OUT = ROOT / "test" / ".data"
DIMS = 10


def vec(*axes):
    v = np.zeros(DIMS, dtype=np.float32)
    for axis, weight in axes:
        v[axis] = weight
    return v


MODEL = [
    ("</s>", vec((0, 0.1))),
    ("le", vec((0, 1))),
    ("une", vec((0, 1), (1, 0.1))),
    ("roi", vec((1, 1))),
    ("reine", vec((1, 1), (2, 0.6))),
    ("rois", vec((1, 1), (3, 0.2))),
    ("Paris", vec((4, 1))),
    ("paris", vec((5, 1))),
    ("1789", vec((6, 1))),
    ("révolution", vec((6, 1), (7, 0.5))),
    ("empire", vec((2, 1), (3, 0.3))),
    ("naquit", vec((7, 1), (3, 0.3))),
    # Loin de chaque mot caché, mais l'un colle au sujet de la page et l'autre non
    ("sceptre", vec((0, 0.9), (1, 0.22), (2, 0.2), (4, 0.2), (7, 0.2))),
    ("manette", vec((5, 0.98), (1, 0.2))),
    # Écritures au sens différent (« venus » de venir, plus fréquent, et « vénus » la planète), planètes pour « Mars »,
    # et des mois (« Avril » le prénom ne doit pas en prendre le sens)
    ("venus", vec((3, 1), (7, 0.3))),
    ("vénus", vec((8, 1), (9, 0.3))),
    ("jupiter", vec((8, 1), (9, 0.2))),
    ("saturne", vec((8, 1), (9, 0.25))),
    ("uranus", vec((8, 1), (9, 0.15))),
    ("neptune", vec((8, 1), (9, 0.1))),
    ("astre", vec((8, 0.8), (9, 0.6))),
    ("mars", vec((2, 0.5), (7, 0.6))),
    ("avril", vec((2, 0.5), (7, 0.5))),
    ("juin", vec((2, 0.6), (7, 0.5))),
]

LEXIQUE = [
    ("roi", "roi"), ("rois", "roi"), ("reine", "reine"),
    ("naquit", "naître"), ("né", "naître"), ("née", "naître"), ("nés", "naître"), ("naître", "naître"),
    ("est", "être"), ("est", "est"), ("sont", "être"), ("être", "être"),
    ("le", "le"), ("la", "le"), ("les", "le"),
    ("planète", "planète"), ("planètes", "planète"),
    ("a", "avoir"), ("ont", "avoir"), ("avoir", "avoir"), ("s", "avoir"),
    ("américain", "américain"), ("américaine", "américain"), ("américains", "américain"), ("britannique", "britannique"),
    ("québécois", "québécois"), ("québécoise", "québécois"),
    ("transformer", "transformer"), ("mai", "mai"), ("mais", "mais"),
    ("c'est-à-dire", "c'est-à-dire"),
]


def main():
    src = OUT / "src"
    src.mkdir(parents=True, exist_ok=True)
    with open(src / "model.bin", "wb") as f:
        f.write(f"{len(MODEL)} {DIMS}\n".encode())
        for w, v in MODEL:
            f.write(w.encode("utf-8") + b" " + v.astype("<f4").tobytes() + b"\n")
    lines = ["ortho\tphon\tlemme\tcgram"] + [f"{o}\t-\t{l}\tNOM" for o, l in LEXIQUE]
    (src / "Lexique.tsv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    prepare_data.main(src / "model.bin", src / "Lexique.tsv", OUT / "out")


if __name__ == "__main__":
    main()

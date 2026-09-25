"""Crée de petites données factices et lance tools/prepare_data.py dessus, pour les tests."""
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import prepare_data  # noqa: E402

OUT = ROOT / "test" / ".data"
DIMS = 8


def vec(*axes):
    v = np.zeros(DIMS, dtype=np.float32)
    for axis, weight in axes:
        v[axis] = weight
    return v


MODEL = [
    ("</s>", vec((0, 0.1))),
    ("le", vec((0, 1))),
    ("roi", vec((1, 1))),
    ("reine", vec((1, 1), (2, 0.6))),
    ("rois", vec((1, 1), (3, 0.2))),
    ("Paris", vec((4, 1))),
    ("paris", vec((5, 1))),
    ("1789", vec((6, 1))),
    ("révolution", vec((6, 1), (7, 0.5))),
    ("empire", vec((2, 1), (3, 1))),
    ("naquit", vec((7, 1), (3, 0.3))),
]

LEXIQUE = [
    ("roi", "roi"), ("rois", "roi"), ("reine", "reine"),
    ("naquit", "naître"), ("né", "naître"), ("née", "naître"), ("nés", "naître"), ("naître", "naître"),
    ("est", "être"), ("est", "est"), ("sont", "être"), ("être", "être"),
    ("le", "le"), ("la", "le"), ("les", "le"),
    ("planète", "planète"), ("planètes", "planète"),
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

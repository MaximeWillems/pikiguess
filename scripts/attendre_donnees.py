"""Attend la fin de l'Action « Données » lancée par le dernier commit poussé, puis affiche une partie de son rapport.

Usage : python scripts/attendre_donnees.py ["titre de section du rapport"]
Sans titre, affiche tout le rapport. S'arrête si aucune Action n'est lancée pour ce commit (rien dans tools/ n'a changé).
"""
import json
import subprocess
import sys
import time
import urllib.request

REPO = "MaximeWillems/pikiguess"


def latest_run(sha):
    with urllib.request.urlopen(f"https://api.github.com/repos/{REPO}/actions/runs?per_page=10") as res:
        runs = json.load(res)["workflow_runs"]
    return next((r for r in runs if r["name"] == "Données" and r["head_sha"] == sha), None)


def main(section=None):
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    for minute in range(120):
        run = latest_run(sha)
        print(time.strftime("%H:%M"), f"{run['status']} {run['conclusion'] or ''}" if run else "pas encore lancée", flush=True)
        if run and run["status"] == "completed":
            break
        if not run and minute >= 3:
            sys.exit("Aucune Action « Données » pour ce commit.")
        time.sleep(60)
    else:
        sys.exit("L'Action n'est pas finie au bout de 2 heures.")

    # Le rapport du commit de données, ajouté par l'Action
    subprocess.run(["git", "fetch", "-q", "origin", "main"], check=True)
    report = subprocess.check_output(["git", "show", "origin/main:public/data/rapport.txt"], encoding="utf-8")
    if not section:
        print(report)
        return
    parts = report.split("===== ")
    found = [p for p in parts if p.split("\n", 1)[0].find(section) >= 0]
    print("\n".join("===== " + p.rstrip() for p in found) if found else f"Section « {section} » absente du rapport.")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1] if len(sys.argv) > 1 else None)

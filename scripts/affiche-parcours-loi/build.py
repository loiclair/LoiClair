#!/usr/bin/env python3
# coding: utf-8
"""
Regenere `public/parcours-dune-loi.pdf`, l'affiche A4 du parcours legislatif
proposee en telechargement sur /processus-legislatif.

Enchaine trois etapes :
  1. build_flow.py produit flow.svg, le schema de la navette parlementaire
  2. flow.svg est injecte dans shell.html a la place du marqueur <!--FLOW-->
  3. Chrome headless imprime le HTML en PDF, puis on verifie qu'il tient bien
     sur une seule page

Usage : python3 scripts/affiche-parcours-loi/build.py
Depend de Google Chrome et d'un acces reseau (les polices IBM Plex viennent de
Google Fonts ; sans elles la mise en page change et la verification echoue).
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_PDF = os.path.join(ROOT, "public", "parcours-dune-loi.pdf")

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Chrome met du temps a peindre les webfonts ; en dessous, le PDF sort avec les
# polices de repli et une pagination differente.
BUDGET_MS = 7000


def run_chrome(html_path, pdf_path, profile):
    """Imprime un fichier HTML local en PDF via Chrome headless.

    Chrome ne rend pas la main apres --print-to-pdf : on le tue une fois le
    fichier ecrit plutot que d'attendre sa sortie.
    """
    proc = subprocess.Popen([
        CHROME, "--headless", "--disable-gpu", "--no-first-run",
        "--no-default-browser-check",
        "--user-data-dir=" + profile,
        "--virtual-time-budget=%d" % BUDGET_MS,
        "--no-pdf-header-footer",
        "--print-to-pdf=" + pdf_path,
        "file://" + html_path,
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        proc.wait(timeout=90)
    except subprocess.TimeoutExpired:
        proc.kill()
    if not os.path.exists(pdf_path):
        sys.exit("Chrome n'a produit aucun PDF (%s)" % pdf_path)


def page_count(pdf_path):
    with open(pdf_path, "rb") as f:
        return len(re.findall(rb"/Type\s*/Page[^sR]", f.read()))


def main():
    if not os.path.exists(CHROME):
        sys.exit("Google Chrome introuvable : " + CHROME)

    subprocess.check_call([sys.executable, "build_flow.py"], cwd=HERE)

    with open(os.path.join(HERE, "shell.html"), encoding="utf-8") as f:
        shell = f.read()
    with open(os.path.join(HERE, "flow.svg"), encoding="utf-8") as f:
        flow = f.read()
    if "<!--FLOW-->" not in shell:
        sys.exit("shell.html ne contient plus le marqueur <!--FLOW-->")

    page = shell.replace("<!--FLOW-->", flow)
    # L'artifact publie enveloppe le fichier ; pour Chrome il faut le squelette.
    doc = ('<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n'
           '</head>\n<body>\n' + page + '\n</body>\n</html>\n')

    tmp = tempfile.mkdtemp(prefix="affiche-parcours-")
    try:
        html = os.path.join(tmp, "page.html")
        with open(html, "w", encoding="utf-8") as f:
            f.write(doc)

        run_chrome(html, OUT_PDF, os.path.join(tmp, "profil-pdf"))

        # La feuille porte un `overflow: hidden` de securite qui rogne un
        # depassement sans rien dire : un PDF d'une page ne prouve donc rien
        # tant qu'on ne l'a pas regenere sans ce masque. C'est le seul controle
        # de pagination qui ne ment pas.
        check_html = os.path.join(tmp, "check.html")
        with open(check_html, "w", encoding="utf-8") as f:
            f.write(doc.replace("overflow: hidden;", "overflow: visible;"))
        check_pdf = os.path.join(tmp, "check.pdf")
        run_chrome(check_html, check_pdf, os.path.join(tmp, "profil-check"))

        pages = page_count(check_pdf)
        if pages != 1:
            sys.exit(
                "Le contenu deborde de la feuille : %d pages une fois le masque\n"
                "retire. Raccourcir un texte ou resserrer un ecart, puis relancer." % pages
            )

        size = os.path.getsize(OUT_PDF) // 1024
        print("OK  %s  (1 page A4, %d Ko)" % (os.path.relpath(OUT_PDF, ROOT), size))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()

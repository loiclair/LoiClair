#!/usr/bin/env python3
# coding: utf-8
"""
Genere le grand schema SVG de l'infographie « Le parcours d'une loi ».

Outil de build jetable : il produit un fragment SVG autonome (flow.svg) qui est
ensuite colle dans parcours-loi.html. Ecrit ici plutot qu'a la main parce que
les deux hemicycles demandent 925 cercles places par le calcul, et parce que
les coordonnees du graphe se re-derivent d'une constante quand on ajuste une
hauteur de bloc.

Regle de densite : les deux hemicycles partagent le meme rayon interieur et le
meme pas entre rangees, donc la surface occupee est proportionnelle au nombre
de sieges. Le Senat parait plus petit que l'Assemblee parce qu'il l'est.
"""

import io
import math

AN = "#0e7490"
SE = "#a9762a"
INK = "#1c1917"
TXT = "#44403c"
MUT = "#857d75"
HAIR = "#e4dfd9"
AN_BG = "#ecf9fc"
AN_LN = "#c3e6ef"
SE_BG = "#fdf6e8"
SE_LN = "#ebd9b6"

W = 620

# --- Hemicycles -------------------------------------------------------------

R_IN = 28.0      # rayon du creux, assez large pour loger le nombre de sieges
PITCH = 2.30     # pas entre deux rangees, identique pour les deux chambres
DOT = 1.05


def hemicycle(n, cx, cy, color):
    """Place n sieges en demi-couronne ouverte vers le bas, arc en haut.

    Le nombre de rangees se deduit de n a pas constant : on ajoute des rangees
    tant que la surface disponible ne suffit pas. Chaque rangee recoit un
    nombre de sieges proportionnel a son rayon, donc a la longueur de son arc.
    """
    rows = 1
    while True:
        radii = [R_IN + i * PITCH for i in range(rows)]
        # capacite d'une rangee : sa demi-circonference divisee par le pas
        capacity = sum(int(math.pi * r / PITCH) for r in radii)
        if capacity >= n:
            break
        rows += 1

    radii = [R_IN + i * PITCH for i in range(rows)]
    total = sum(radii)
    counts = [max(1, round(n * r / total)) for r in radii]

    # L'arrondi rangee par rangee ne retombe jamais juste : on corrige sur les
    # rangees exterieures, les plus longues, ou un siege de plus ne se voit pas.
    while sum(counts) > n:
        counts[counts.index(max(counts))] -= 1
    while sum(counts) < n:
        counts[counts.index(max(counts))] += 1

    out = []
    for r, c in zip(radii, counts):
        for j in range(c):
            t = 0.5 if c == 1 else j / (c - 1.0)
            a = math.pi * t
            x = cx - r * math.cos(a)
            y = cy - r * math.sin(a)
            out.append('<circle cx="%.1f" cy="%.1f" r="%s" fill="%s"/>'
                       % (x, y, DOT, color))
    return "".join(out), max(radii)


# --- Geometrie du graphe ----------------------------------------------------

CX_AN, CX_SE = 155, 465          # axes des deux colonnes
BOX_W, BOX_H = 250, 42
X_AN, X_SE = 30, 340

DEPOT_Y = 8                       # bandeau « le texte entre par une chambre »
_, R_MAX = hemicycle(577, 0, 0, AN)   # rayon du plus grand hemicycle
HEMI_CY = int(DEPOT_Y + 46 + R_MAX)   # base des hemicycles
Y1 = HEMI_CY + 32                     # premier bloc de lecture
GAP = 26                          # hauteur d'une traverse entre deux blocs

s = []
a = s.append

a('<defs>')
a('<marker id="tip" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="6.5" '
  'markerHeight="6.5" orient="auto"><path d="M0 0.5 L7 4 L0 7.5 Z" fill="%s"/></marker>' % MUT)
a('<style>')
a('.lead{font-family:"IBM Plex Sans",sans-serif;font-size:15px;font-weight:600;fill:%s}' % INK)
a('.desc{font-family:"IBM Plex Sans",sans-serif;font-size:11.5px;fill:%s}' % TXT)
a('.tag{font-family:"IBM Plex Sans",sans-serif;font-size:10px;fill:%s;text-anchor:middle}' % MUT)
a('.tagL{font-family:"IBM Plex Sans",sans-serif;font-size:10px;fill:%s;text-anchor:start}' % MUT)
a('.chamber{font-family:"IBM Plex Mono",monospace;font-size:11px;font-weight:600;'
  'letter-spacing:1.2px;text-anchor:middle}')
a('.entry{font-family:"IBM Plex Mono",monospace;font-size:9.5px;font-weight:500;'
  'letter-spacing:1.2px;fill:%s;text-anchor:middle}' % MUT)
a('.seats{font-family:"IBM Plex Serif",Georgia,serif;font-size:21px;font-weight:600;text-anchor:middle}')
a('.unit{font-family:"IBM Plex Mono",monospace;font-size:8.5px;letter-spacing:1px;'
  'fill:%s;text-anchor:middle}' % MUT)
a('.out{font-family:"IBM Plex Mono",monospace;font-size:10.5px;font-weight:600;'
  'letter-spacing:1px;fill:%s}' % INK)
a('.wire{fill:none;stroke:%s;stroke-width:1.2}' % MUT)
a('</style>')
a('</defs>')

# Le point d'entree : deux fleches, une par chambre. C'est ce qui manquait le
# plus dans la version precedente, ou le parcours semblait toujours partir de
# l'Assemblee.
a('<text class="entry" x="310" y="%d">LE TEXTE EST DÉPOSÉ DANS L\'UNE DES DEUX CHAMBRES</text>'
  % DEPOT_Y)
for cx in (CX_AN, CX_SE):
    a('<path class="wire" d="M%d %d V%d" marker-end="url(#tip)"/>'
      % (cx, DEPOT_Y + 8, DEPOT_Y + 19))
a('<text class="tag" x="310" y="%d">ou</text>' % (DEPOT_Y + 18))

# Hemicycles, avec le nombre de sieges loge dans leur propre creux.
for label, unit, n, cx, col in (
        ("ASSEMBLÉE NATIONALE", "DÉPUTÉS", 577, CX_AN, AN),
        ("SÉNAT", "SÉNATEURS", 348, CX_SE, SE)):
    dots, r_out = hemicycle(n, cx, HEMI_CY, col)
    a('<text class="chamber" x="%d" y="%d" fill="%s">%s</text>'
      % (cx, DEPOT_Y + 32, col, label))
    a(dots)
    a('<path d="M%.1f %d A %.1f %.1f 0 0 1 %.1f %d Z" fill="#ffffff"/>'
      % (cx - R_IN - 0.6, HEMI_CY, R_IN + 0.6, R_IN + 0.6, cx + R_IN + 0.6, HEMI_CY))
    a('<text class="seats" x="%d" y="%d" fill="%s">%d</text>' % (cx, HEMI_CY - 4, col, n))
    a('<text class="unit" x="%d" y="%d">%s</text>' % (cx, HEMI_CY + 18, unit))

# Frontiere entre les deux chambres, du haut jusqu'a la sortie de la navette.
a('<line x1="310" y1="%d" x2="310" y2="%d" stroke="%s" stroke-width="1" '
  'stroke-dasharray="2 4"/>' % (DEPOT_Y + 32, Y1 + 3 * BOX_H + 2 * GAP + 4, HAIR))


def box(x, y, side, lead, desc):
    col, bg, ln = (AN, AN_BG, AN_LN) if side == "an" else (SE, SE_BG, SE_LN)
    a('<rect x="%d" y="%d" width="%d" height="%d" rx="2" fill="%s" stroke="%s"/>'
      % (x, y, BOX_W, BOX_H, bg, ln))
    a('<rect x="%d" y="%d" width="3" height="%d" fill="%s"/>' % (x, y, BOX_H, col))
    a('<text class="lead" x="%d" y="%d">%s</text>' % (x + 15, y + 20, lead))
    a('<text class="desc" x="%d" y="%d">%s</text>' % (x + 15, y + 37, desc))


def zigzag(y_from, x_from, x_to, label, width):
    """Traverse en Z d'une chambre a l'autre, etiquetee au milieu.

    La traverse est placee au tiers haut du gap, pas au milieu : la descente
    qui suit doit rester plus longue que la pointe de fleche, sinon le triangle
    semble colle au trait horizontal.
    """
    mid = y_from + 9
    a('<path class="wire" d="M%d %d V%d H%d V%d" marker-end="url(#tip)"/>'
      % (x_from, y_from, mid, x_to, y_from + GAP - 3))
    a('<rect x="%d" y="%d" width="%d" height="12" fill="#ffffff"/>'
      % (310 - width // 2, mid - 8, width))
    a('<text class="tag" x="310" y="%d">%s</text>' % (mid + 1, label))


ORD = "<tspan font-size='10' dy='-4'>re</tspan><tspan dy='4'> lecture</tspan>"
ORD2 = "<tspan font-size='10' dy='-4'>e</tspan><tspan dy='4'> lecture</tspan>"

y = Y1
box(X_AN, y, "an", "1" + ORD, "Commission, séance publique, vote")
for i, line in enumerate(("Ici, le texte part de l'Assemblée.",
                          "Déposé au Sénat, les colonnes s'échangent.")):
    a('<text class="tagL" x="%d" y="%d">%s</text>' % (X_SE + 4, y + 8 + i * 14, line))
zigzag(y + BOX_H, CX_AN, CX_SE, "le texte adopté part au Sénat", 176)

y += BOX_H + GAP
box(X_SE, y, "se", "1" + ORD, "Le Sénat peut le modifier")
zigzag(y + BOX_H, CX_SE, CX_AN, "modifié, il revient à l'Assemblée", 188)

y += BOX_H + GAP
box(X_AN, y, "an", "2" + ORD2, "Seuls les points en désaccord")
y_out = y + BOX_H

# --- Sortie de la navette --------------------------------------------------
#
# La position porte le sens autant que la couleur : le dernier mot revient a
# l'Assemblee, son bloc est donc dans la colonne de gauche et reprend le teal
# des lectures de l'Assemblee. La CMP, elle, n'appartient a aucune chambre :
# elle est centree et neutre.
#
# La branche « accord » longe le bord gauche (X_OK = 12) pour passer a gauche
# du bloc du dernier mot sans le croiser. Ne pas la rapprocher du centre.

FORK = y_out + 20                 # barre de la premiere fourche
X_OK = 12                         # la branche « accord » longe le bord
X_MID = 310                       # axe des etapes qui ne sont d'aucune chambre

a('<text class="tagL" x="%d" y="%d">La navette peut se poursuivre</text>'
  % (X_SE + 4, y + 20))
a('<text class="tagL" x="%d" y="%d">sur plusieurs lectures.</text>'
  % (X_SE + 4, y + 36))

a('<path class="wire" d="M%d %d V%d"/>' % (CX_AN, y_out, FORK))
a('<path class="wire" d="M%d %d H%d"/>' % (X_OK, FORK, X_MID))
a('<text class="tagL" x="%d" y="%d">accord, possible dès la première lecture</text>'
  % (X_OK + 10, FORK + 15))

CMP_Y = FORK + 22
a('<path class="wire" d="M%d %d V%d" marker-end="url(#tip)"/>' % (X_MID, FORK, CMP_Y - 4))
a('<text class="tagL" x="%d" y="%d">désaccord</text>' % (X_MID + 10, FORK + 15))

CMP_H = 44
a('<rect x="%d" y="%d" width="280" height="%d" rx="2" fill="#ffffff" stroke="%s"/>'
  % (X_MID - 140, CMP_Y, CMP_H, HAIR))
a('<text class="out" x="%d" y="%d">COMMISSION MIXTE PARITAIRE</text>' % (X_MID - 124, CMP_Y + 20))
a('<text class="desc" x="%d" y="%d">7 + 7. Son compromis, voté, fait la loi.</text>'
  % (X_MID - 124, CMP_Y + 36))

# L'echec de la CMP renvoie a l'Assemblee : le trait part du centre et rejoint
# la colonne de gauche, ou le bloc porte les couleurs de l'Assemblee.
FORK2 = CMP_Y + CMP_H + 18
LAST_Y = FORK2 + 18
a('<path class="wire" d="M%d %d V%d H%d V%d" marker-end="url(#tip)"/>'
  % (X_MID, CMP_Y + CMP_H, FORK2, CX_AN, LAST_Y - 4))
_mid = (CX_AN + X_MID) // 2
a('<rect x="%d" y="%d" width="86" height="14" fill="#ffffff"/>' % (_mid - 43, FORK2 - 8))
a('<text class="tag" x="%d" y="%d">si elle échoue</text>' % (_mid, FORK2 + 3))

LAST_H = 44
a('<rect x="%d" y="%d" width="%d" height="%d" rx="2" fill="%s" stroke="%s"/>'
  % (X_AN, LAST_Y, BOX_W, LAST_H, AN_BG, AN_LN))
a('<rect x="%d" y="%d" width="3" height="%d" fill="%s"/>' % (X_AN, LAST_Y, LAST_H, AN))
a('<text class="out" x="%d" y="%d">LE DERNIER MOT</text>' % (X_AN + 15, LAST_Y + 20))
a('<text class="desc" x="%d" y="%d">L\'Assemblée nationale tranche seule</text>'
  % (X_AN + 15, LAST_Y + 36))

# --- Convergence : les chemins finissent tous au meme endroit ----------------

MEET = LAST_Y + LAST_H + 18
a('<path class="wire" d="M%d %d V%d"/>' % (X_OK, FORK, MEET))
a('<path class="wire" d="M%d %d V%d"/>' % (CX_AN, LAST_Y + LAST_H, MEET))
a('<path class="wire" d="M%d %d H%d"/>' % (X_OK, MEET, X_MID))

a('<path class="wire" d="M%d %d V%d" marker-end="url(#tip)"/>' % (X_MID, MEET, MEET + 14))

H = MEET + 18

svg = ('<svg class="flow" viewBox="0 0 %d %d" role="img" aria-label="%s">%s</svg>'
       % (W, H, "Schéma du parcours parlementaire : le texte fait la navette entre "
                "l'Assemblée nationale et le Sénat, passe si besoin par une commission "
                "mixte paritaire, et finit adopté quand les deux chambres votent le "
                "même texte.", "".join(s)))

io.open("flow.svg", "w", encoding="utf-8").write(svg)
print("viewBox 0 0 %d %d  |  ratio h/w = %.3f  |  rendu a 695px de large = %d px"
      % (W, H, H / float(W), round(695.0 * H / W)))

/**
 * Génère public/hemicycle-senat.svg
 * Fond : plan architectural du Sénat (950×659)
 * Cercles : 348 sièges positionnés en arcs, chacun avec place="N"
 *
 * Layout source : https://github.com/Kurea/visu_senat (MIT)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Layout : rangées × groupes × numéros de sièges ──────────────────────────
// 0 = espace vide (allée centrale ou marge)
const layout = [
  [[0,0,0,0,0,0],[1,2,3,4],[5,6,7,8],[9,10,11,12,13]],
  [[14,15,16,17,18,19,20],[21,22,23,24,25],[26,27,28,29,30],[31,32,33,34,35,36]],
  [[37,38,39,40,41,42,43,44,45],[46,47,48,49,50,51,52],[53,54,55,56,57,58,59],[60,61,62,63,64,65,66,67]],
  [[68,69,70,71,72,73,74,75,76,77],[78,79,80,81,82,83,84,85],[86,87,88,89,90,91,92,93],[94,95,96,97,98,99,100,101,102]],
  [[103,104,105,106,107,108,109],[110,111,112,113],[114,115,116,117],[118,119,120,121],[122,123,124,125],[126,127,128,129],[130,131,132,133],[134,135,136,137,138,139]],
  [[140,141,142,143,144,145,146],[147,148,149,150,151],[152,153,154,155,156],[157,158,159,160,161],[162,163,164,165,166],[167,168,169,170,171],[172,173,174,175,176],[177,178,179,180,181,182]],
  [[183,184,185,186,187,188,189,190],[191,192,193,194,195,196],[197,198,199,200,201,202],[203,204,205,206,207,208],[209,210,211,212,213,214],[215,216,217,218,219,220],[221,222,223,224,225,226],[227,228,229,230,231,232,233]],
  [[234,235,236,237,238,239,240,241],[242,243,244,245,246,247,248],[249,250,251,252,253,254,255],[256,257,258,259,260,261,262],[263,264,265,266,267,268,269],[270,271,272,273,274,275,276],[277,278,279,280,281,282,283],[284,285,286,287,288,289,290,291]],
  [[0,0,292,293,294,295,296,297,298],[299,300,301,302,303,304,305],[306,307,308,309,310,311,312],[313,314,315,316,317,318,319],[320,321,322,323,324,325,326],[327,328,329,330,331,332,333],[334,335,336,337,338,339,340],[341,342,343,344,345,346,347,348]],
];

// ─── Paramètres SVG ───────────────────────────────────────────────────────────
const SVG_W = 950;
const SVG_H = 659;

// Centre de l'arc (point focal de l'hémicycle, juste au-dessus de la tribune)
// Image 950×659 : zone de sièges ≈ x[135-815], y[100-430]
const CX = 475;
const CY = 445;

// Rayons par rangée (intérieure → extérieure), calibrés sur l'image
// Rangée 0 (intérieure) ≈ y 295 → radius = 445-295 = 150
// Rangée 8 (extérieure) ≈ y 100 → radius = 445-100 = 345
const ROW_RADII = [150, 174, 199, 223, 248, 272, 296, 321, 345];

// Arc : de ARC_START (gauche) à ARC_END (droite), en radians
// Étendue latérale : x≈135 à x≈815, radius=345 → cos=±0.985 → angle≈±170°
const ARC_START = Math.PI - 0.17;  // ~170°
const ARC_END   = 0.17;            // ~10°

// Rayon des cercles sièges — même taille relative que les paths de l'AN (viewBox ~900px, paths ~15-20px)
const SEAT_R = 47;

// Nombre de slots vides entre groupes (allées)
const GAP_WEIGHT = 2;

// ─── Calcul des positions ─────────────────────────────────────────────────────
function computeSeats(layout) {
  const seats = []; // { place, x, y }

  layout.forEach((row, rowIndex) => {
    const radius = ROW_RADII[rowIndex];

    // Aplatir la rangée en séquence de slots
    // Chaque groupe est séparé du suivant par GAP_WEIGHT slots vides
    const slots = []; // { place } ou { place: 0 } pour espace

    row.forEach((group, gi) => {
      if (gi > 0) {
        // Ajouter une allée entre groupes
        for (let g = 0; g < GAP_WEIGHT; g++) slots.push({ place: 0 });
      }
      group.forEach(n => slots.push({ place: n }));
    });

    const totalSlots = slots.length;
    const arcRange = ARC_START - ARC_END; // de gauche (grand angle) à droite (petit angle)

    slots.forEach((slot, si) => {
      if (slot.place === 0) return; // espace vide, pas de cercle

      // Angle de gauche à droite
      const angle = ARC_START - (si / (totalSlots - 1)) * arcRange;

      const x = CX + radius * Math.cos(angle);
      const y = CY - radius * Math.sin(angle);

      seats.push({ place: slot.place, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    });
  });

  return seats;
}

// ─── Génération SVG ───────────────────────────────────────────────────────────
const seats = computeSeats(layout);

const circles = seats
  .map(s =>
    `  <circle place="${s.place}" cx="${s.x}" cy="${s.y}" r="${SEAT_R}" fill="transparent" stroke="transparent" stroke-width="0.5" style="cursor:pointer"/>`
  )
  .join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}">
  <image href="/hemicycle-senat-bg.png" x="0" y="0" width="${SVG_W}" height="${SVG_H}" preserveAspectRatio="xMidYMid meet"/>
${circles}
</svg>`;

const outPath = path.join(__dirname, '..', 'public', 'hemicycle-senat.svg');
fs.writeFileSync(outPath, svg, 'utf-8');
console.log(`✅ hemicycle-senat.svg généré : ${seats.length} sièges`);
console.log(`   Fichier : ${outPath}`);

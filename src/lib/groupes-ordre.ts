// Ordre de gauche à droite des groupes parlementaires, tel qu'ils siègent dans chaque
// hémicycle. Sert à ranger les groupes du volet de détail d'un scrutin
// (/api/scrutin-votes) et ceux du graphique des amendements de la fiche dossier
// (`repartitionDuDossier`) : c'est la place attribuée par chaque chambre, pas un
// classement politique de LoiClair.
//
// Le rang d'un groupe est l'angle médian des sièges (`acteurs.place_hemicycle`) de ses
// élus en exercice, lu dans `hemicycle-angles.ts`. Rien n'est écrit à la main : un groupe
// renommé ou nouveau prend sa place dès que ses élus ont un siège en base.
//
// Médiane et non moyenne : trois paires partagent le même secteur et ne se départagent
// qu'à un degré près (relevé du 2026-10-25), LFI-NFP et GDR, HOR et DR, RDPI et Les
// Indépendants. GDR occupe les premiers rangs du secteur de LFI-NFP, qui en tient aussi
// les bords : la moyenne mettait GDR à gauche de LFI-NFP, contre l'ordre de l'Assemblée.
// La médiane redonne l'ordre publié par les deux chambres pour les trois paires.

import { sql } from '@/lib/db';
import { estNonInscrits } from '@/lib/non-inscrits';
import { ANGLES_SIEGES } from '@/lib/hemicycle-angles';

// Au-delà de 180°, l'angle le plus à droite : ces rangs passent après tous les groupes
// assis. Un groupe sans élu assis dans cette chambre (dissous, ou de l'autre chambre,
// comme un député devenu sénateur) se range avant les non-inscrits. Ceux-ci ferment la
// liste : leurs sièges vont d'un bord à l'autre, une position moyenne serait trompeuse.
const RANG_SANS_SIEGE = 1000;
const RANG_NON_INSCRITS = 2000;

type Siege = { uid: string; groupe: string | null; place_hemicycle: number | string | null };

/** Rang de chaque groupe de gauche à droite dans l'hémicycle de `chambre`, par uid
 *  d'organe. Une lecture des élus en exercice de ces groupes. Lève si elle échoue.
 *  Un rang égal se départage chez l'appelant. */
export async function rangsHemicycle(
  chambre: 'AN' | 'SEN',
  groupes: { uid: string; libelleAbrege: string | null }[],
): Promise<Map<string, number>> {
  const uids = groupes.map((g) => g.uid);
  const sieges = uids.length === 0 ? [] : await sql<Siege[]>`
    select uid, groupe, place_hemicycle
    from acteurs
    where groupe = any(${uids})
      and ${sql(chambre === 'SEN' ? 'est_senateur_actuel' : 'est_depute_actuel')} = true
      and place_hemicycle is not null
    order by uid`;

  const angles = ANGLES_SIEGES[chambre];
  const parGroupe = new Map<string, number[]>();
  for (const s of sieges) {
    const angle = angles[Number(s.place_hemicycle)];
    if (!s.groupe || angle === undefined) continue;
    parGroupe.set(s.groupe, [...(parGroupe.get(s.groupe) ?? []), angle]);
  }

  return new Map(groupes.map((g) => {
    if (estNonInscrits(g.libelleAbrege)) return [g.uid, RANG_NON_INSCRITS];
    const a = parGroupe.get(g.uid)?.sort((x, y) => x - y);
    if (!a) return [g.uid, RANG_SANS_SIEGE];
    const milieu = Math.floor(a.length / 2);
    return [g.uid, a.length % 2 ? a[milieu] : (a[milieu - 1] + a[milieu]) / 2];
  }));
}

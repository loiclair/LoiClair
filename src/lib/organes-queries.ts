// Effectifs et composition par groupe d'une institution, lus depuis `acteurs`
// et `organes`. Unique consommateur : les modales d'institution de
// /processus-legislatif, via getDashboardKpis().
import { sql } from '@/lib/db';

export type Institution = 'AN' | 'Senat' | 'Gouvernement';

// Libellé d'un organe. La modale rend une pastille de couleur, le nom,
// l'effectif et la part du groupe : ni les stats de vote de la table
// `organes`, ni le libellé abrégé n'y servent.
interface OrganeInfo {
  libelle: string;
}

// Palette de couleurs partagée (Tailwind 500/400)
const GROUP_COLOR_PALETTE = [
  '#06B6D4', '#D4A54A', '#8B5CF6', '#27AE60', '#E74C3C',
  '#0891B2', '#F39C12', '#6366F1', '#2ECC71', '#A8A29E',
  '#22D3EE', '#E67E22', '#7C3AED', '#1ABC9C', '#44403C',
] as const;

// Les trois seules colonnes lues sur `acteurs` : l'âge alimente la moyenne,
// la civilité la parité, le groupe le décompte par groupe.
type ActeurRecord = {
  age?: number | null;
  civ?: string | null;
  groupe?: string | null;
};

// Colonne booléenne qui retient les membres actuels de l'institution. Liste fermée :
// elle part en nom de colonne dans la requête (`sql(...)`).
function colonneInstitution(institution: Institution) {
  switch (institution) {
    case 'AN': return 'est_depute_actuel';
    case 'Senat': return 'est_senateur_actuel';
    case 'Gouvernement': return 'est_ministre_actuel';
  }
}

// Construit la map uid → OrganeInfo (libellé) en une seule requête. Lève sur une panne
// (D-136), comme la lecture des acteurs qui la précède : une carte vide rendrait les
// groupes sans libellé, figés jusqu'à la régénération suivante.
async function buildOrganesMap(acteurs: ActeurRecord[]): Promise<Map<string, OrganeInfo>> {
  const uids = new Set<string>();
  acteurs.forEach(a => { if (a.groupe) uids.add(a.groupe as string); });

  if (uids.size === 0) return new Map();

  const organesData = await sql<{ uid: string; libelle: string | null }[]>`
    select uid, libelle from organes where uid = any(${Array.from(uids)})`;

  const organesMap = new Map<string, OrganeInfo>();
  organesData.forEach(o => {
    organesMap.set(o.uid, { libelle: o.libelle || o.uid });
  });

  return organesMap;
}

// Une entrée par groupe pour la liste de la modale : libellé, effectif,
// et une couleur prise dans la palette, attribuée par rang décroissant.
function buildGroupesData(
  acteurs: ActeurRecord[],
  organesMap: Map<string, OrganeInfo>
): Array<{ name: string; value: number; fill: string }> | null {
  const groupesMap = new Map<string, number>();

  acteurs.forEach(a => {
    if (a.groupe) {
      const g = a.groupe as string;
      groupesMap.set(g, (groupesMap.get(g) || 0) + 1);
    }
  });

  if (groupesMap.size === 0) return null;

  // Deux groupes de même effectif sont départagés par leur uid (D-329) : leur rang
  // décide de leur couleur, qui suivait sinon l'ordre de lecture des élus.
  const groupes = Array.from(groupesMap.entries())
    .sort(([uidA, a], [uidB, b]) => b - a || uidA.localeCompare(uidB))
    .map(([uid, value]) => ({
      name: organesMap.get(uid)?.libelle || uid,
      value,
      fill: '#A8A29E',
    }))
    .map((g, index) => ({
      ...g,
      fill: GROUP_COLOR_PALETTE[index % GROUP_COLOR_PALETTE.length],
    }));

  return groupes;
}

export interface DashboardKpis {
  membres: number
  ageMoyen: number | null
  pariteFemmes: number | null
  nombreGroupes: number | null
  /** Même forme que le retour de buildGroupesData, qui la remplit. */
  groupes: Array<{ name: string; value: number; fill: string }> | null
}

export async function getDashboardKpis(institution: Institution): Promise<DashboardKpis> {
  // Sans tri : seuls des comptes en sortent, et `buildGroupesData` départage
  // lui-même les groupes de même effectif.
  const acteurs = await sql<ActeurRecord[]>`
    select age, civ, groupe
    from acteurs
    where en_exercice = true and ${sql(colonneInstitution(institution))} = true`;
  const membres = acteurs.length;
  const ages = acteurs.map(a => a.age).filter((a): a is number => a != null && !isNaN(a));
  const ageMoyen = ages.length > 0 ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null;
  const femmes = acteurs.filter(a => a.civ?.trim() === 'Mme').length;
  const pariteFemmes = membres > 0 ? Math.round((femmes / membres) * 100) : null;

  let groupes: DashboardKpis['groupes'] = null;
  let nombreGroupes: number | null = null;
  if (institution === 'AN' || institution === 'Senat') {
    const organesMap = await buildOrganesMap(acteurs);
    groupes = buildGroupesData(acteurs, organesMap);
    nombreGroupes = groupes ? groupes.length : null;
  }

  return { membres, ageMoyen, pariteFemmes, nombreGroupes, groupes };
}

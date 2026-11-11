// Score d'activité de deux élus, pour la modale « Comparer » (`ComparerElusModal`),
// ouverte depuis /les-elus ou depuis la fiche d'un élu. Rend, pour chacun, le score, le rang dans la chambre, le
// rang de chacune des quatre fonctions, les onze mesures brutes, la cohésion avec son
// groupe, le taux d'adoption de ses amendements et ses trois sujets de prédilection,
// plus le nombre d'élus classés de la chambre.
//
// Chargement à la demande plutôt que dans l'index de recherche des élus : tous les
// visiteurs de la recherche téléchargeraient le score de chaque élu pour une
// fonctionnalité que peu ouvrent.
//
// Les deux élus doivent siéger dans la même chambre : le score est un classement à
// l'intérieur d'une chambre, deux 70 de chambres différentes ne disent pas la même chose.
// La liste et la recherche de la modale empêchent déjà ce choix ; la règle est redite
// ici pour qu'un appel direct ne la contourne pas.

import { NextRequest, NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { sql } from '@/lib/db';
import { routing } from '@/i18n/routing';
import { libelleTheme } from '@/lib/themes-dossiers';
import { fonctionsDeLigne, type FonctionKey, type MetricKey } from '@/lib/activite-weights';

// Route dynamique, comme `scrutin-votes` : lire `searchParams` la sort du rendu statique,
// et une vue rafraîchie se voit à l'appel suivant.
export const runtime = 'nodejs';

// Les uid d'élu suivent PA<chiffres>. Valider la forme borne les valeurs qui atteignent
// la base, sans rate limit sur une route publique en lecture seule.
const ELU_UID = /^PA\d{1,10}$/;

// La valeur brute de chaque mesure dans `activite_elus_mv` : un compte, sauf la
// participation, qui est un taux en pourcentage. La fiche élu lit les mêmes colonnes
// (`metricCount`), la participation exceptée, qu'elle prend dans `acteurs` : la vue la
// recopie de là au rafraîchissement.
const COLONNE_BRUTE: Record<MetricKey, string> = {
  cpPart: 'taux_participation_votes_finaux',
  cpDoss: 'nb_dossiers_inities',
  cpCosign: 'nb_textes_cosignes',
  cpRapp: 'nb_rapporteur',
  cpRappCtrl: 'nb_rapports_controle',
  cpAmendAuteur: 'nb_amendements_auteur',
  cpAmendCosign: 'nb_amendements_cosignataire',
  cpQuestO: 'nb_questions_orales',
  cpQuestE: 'nb_questions_ecrites',
  cpPrisesParole: 'nb_prises_parole',
  cpCommPres: 'nb_commission_presences',
};

// Colonnes nommées : une ligne fait moins de 1 Ko, et `select('*')` rapatrierait aussi
// les onze centiles et les onze rangs par mesure, que la modale n'affiche pas.
// Une liste fermée de noms du code, que `sql(COLONNES)` cite comme identifiants.
const COLONNES = [
  'uid', 'chambre', 'score', 'rang_chambre', 'jours_actifs',
  'est_president_chambre', 'est_president_groupe',
  'rang_legiferer', 'rang_deliberer', 'rang_controler', 'rang_commission',
  ...Object.values(COLONNE_BRUTE),
];

type ActiviteRow = {
  uid: string;
  chambre: 'AN' | 'SN';
  score: number | null;
  rang_chambre: number | null;
  jours_actifs: number | null;
  est_president_chambre: boolean;
  est_president_groupe: boolean;
};

/** Pourquoi un élu n'a pas de score : les trois cas de `activite_elus_mv` (D-123), dans
 *  l'ordre où la fiche les teste. `null` pour un élu classé. */
export type MotifSansScore = 'presidentChambre' | 'presidentGroupe' | 'recent' | null;

export type EluCompare = {
  uid: string;
  score: number | null;
  rang: number | null;
  joursActifs: number;
  motif: MotifSansScore;
  /** Rang dans la chambre pour chaque fonction, comme sur la fiche ; `null` hors
   *  classement. */
  fonctions: Record<FonctionKey, number | null>;
  /** Valeur brute de chaque mesure, présente même hors classement : un compte, ou le
   *  taux de participation en % pour `cpPart`. `null` quand la source ne la suit pas
   *  (présence en commission au Sénat, participation d'un président de chambre). */
  mesures: Record<MetricKey, number | null>;
  /** Part des votes alignés sur la majorité de son groupe, en %, comme « Cohésion
   *  groupe » sur la fiche. */
  cohesion: number | null;
  /** Amendements adoptés sur amendements déposés, entre 0 et 1, calculé comme la
   *  section « Ses amendements » de la fiche. `null` sans amendement déposé. */
  adoptionAmendements: number | null;
  /** Ses sujets de prédilection (`themes_elus_mv`), traduits et dans l'ordre, au plus
   *  trois. Vide pour un élu sous le plancher de la méthode. */
  themes: string[];
};

/** Ce que la fiche lit dans `acteurs` et non dans la vue d'activité. */
type ActeurRow = {
  uid: string;
  taux_cohesion_groupe: number | null;
  nb_amendements_auteur: number | null;
  amendements_par_sort: { adopte?: number } | null;
};

export type ComparerElusResponse = {
  chambre: 'AN' | 'SN';
  /** Élus classés de la chambre, le « sur 554 » de la fiche. */
  total: number;
  /** Dans l'ordre des `uids` demandés. */
  elus: [EluCompare, EluCompare];
};

function versElu(row: ActiviteRow, acteur: ActeurRow | undefined, themes: string[]): EluCompare {
  // Même calcul que la fiche : `amendements_par_sort` n'existe que si l'élu a déposé
  // un amendement, et le dénominateur est le compteur de `acteurs`, écrit par la même
  // transaction, et non celui de la vue.
  const sorts = acteur?.amendements_par_sort ?? null;
  return {
    uid: row.uid,
    score: row.score,
    rang: row.rang_chambre,
    joursActifs: row.jours_actifs ?? 0,
    motif: row.est_president_chambre ? 'presidentChambre'
      : row.est_president_groupe ? 'presidentGroupe'
      : row.score === null ? 'recent'
      : null,
    fonctions: fonctionsDeLigne(row, 'rang'),
    mesures: Object.fromEntries(
      (Object.entries(COLONNE_BRUTE) as [MetricKey, string][]).map(([m, col]) => [m, (row as unknown as Record<string, number | null>)[col] ?? null]),
    ) as EluCompare['mesures'],
    cohesion: acteur?.taux_cohesion_groupe ?? null,
    adoptionAmendements: sorts ? (sorts.adopte ?? 0) / Math.max(acteur?.nb_amendements_auteur ?? 0, 1) : null,
    themes,
  };
}

export async function GET(req: NextRequest) {
  const uids = (req.nextUrl.searchParams.get('uids') ?? '').split(',').map((u) => u.trim());
  if (uids.length !== 2 || uids[0] === uids[1] || !uids.every((u) => ELU_UID.test(u))) {
    return NextResponse.json({ error: 'invalid_uids' }, { status: 400 });
  }
  // La langue sert aux seuls noms de thèmes, traduits ici comme sur la fiche : le
  // namespace `themesDossiers` n'a pas à partir chez tous les visiteurs de la liste.
  const langue = req.nextUrl.searchParams.get('locale') ?? routing.defaultLocale;
  if (!(routing.locales as readonly string[]).includes(langue)) {
    return NextResponse.json({ error: 'invalid_locale' }, { status: 400 });
  }

  // Les deux premières lectures sont rangées par uid dans une table : leur ordre ne
  // compte pas.
  let rows: ActiviteRow[];
  let acteurs: ActeurRow[];
  let themes: { uid: string; theme: string; rang: number }[];
  try {
    [rows, acteurs, themes] = await Promise.all([
      sql<ActiviteRow[]>`select ${sql(COLONNES)} from activite_elus_mv where uid = any(${uids})`,
      sql<ActeurRow[]>`
        select uid, taux_cohesion_groupe, nb_amendements_auteur, amendements_par_sort
        from acteurs where uid = any(${uids})`,
      // `rang` est unique par élu (vue `2026-10-27_themes_elus.sql`), l'uid départage.
      sql<{ uid: string; theme: string; rang: number }[]>`
        select uid, theme, rang from themes_elus_mv where uid = any(${uids}) order by rang, uid`,
    ]);
  } catch (e) {
    console.error('[comparer-elus]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'db_unavailable' }, { status: 503 });
  }
  const tThemes = await getTranslations({ locale: langue, namespace: 'themesDossiers' });
  const themesParUid = new Map<string, string[]>();
  for (const l of themes) {
    themesParUid.set(l.uid, [...(themesParUid.get(l.uid) ?? []), libelleTheme(l.theme, tThemes)]);
  }
  const acteurParUid = new Map(acteurs.map((r) => [r.uid, r]));
  const parUid = new Map(rows.map((r) => [r.uid, r]));
  const a = parUid.get(uids[0]);
  const b = parUid.get(uids[1]);
  // Un ministre en fonction n'a pas de ligne dans la vue : il n'est pas comparable.
  if (!a || !b) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (a.chambre !== b.chambre) {
    return NextResponse.json({ error: 'different_chambers' }, { status: 400 });
  }

  // Même compte que la fiche élu, sans transférer de ligne.
  let count: number;
  try {
    [{ n: count }] = await sql<{ n: number }[]>`
      select count(*) as n from activite_elus_mv where chambre = ${a.chambre} and score is not null`;
  } catch (e) {
    console.error('[comparer-elus] total', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'db_unavailable' }, { status: 503 });
  }

  const body: ComparerElusResponse = { chambre: a.chambre, total: count, elus: [
      versElu(a, acteurParUid.get(a.uid), themesParUid.get(a.uid) ?? []),
      versElu(b, acteurParUid.get(b.uid), themesParUid.get(b.uid) ?? []),
    ] };
  return NextResponse.json(body);
}

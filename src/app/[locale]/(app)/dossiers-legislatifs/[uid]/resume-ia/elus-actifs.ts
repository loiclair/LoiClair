// src/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/elus-actifs.ts
// Serveur uniquement. Classement des élus de la section « Les plus actifs dans ce
// dossier », partagé par la fiche (`page.tsx`, qui n'en envoie que la carte) et par
// la route `/api/dossiers/[uid]/elus-actifs` (la liste entière, chargée à
// l'ouverture du panneau).

import { auPlusUneLigne, sql } from '@/lib/db';
import { ACTIVITE_WEIGHTS } from '@/lib/activite-weights';
import { type DrapeauxMandat } from '@/lib/ancien-elu';
import { completerGroupesAnciens } from '@/lib/groupe-ancien-elu';
import { COLONNES_ELU_SOURCE, versEluSource, type RawActeur } from './amendements-adoptes';
import type { EluActif, ElusActifsChambre } from './ElusActifsSection';

/**
 * Centile « du milieu » de chaque valeur dans son ensemble, de 0 à 1 :
 * `(PERCENT_RANK + CUME_DIST) / 2`, la formule de `activite_elus_mv` (D-112). Un
 * bloc d'ex æquo reçoit le centile de son milieu, pas de son sommet, et un ensemble
 * d'une seule valeur reçoit 0,5.
 */
function centilesDuMilieu(valeurs: number[]): number[] {
  const n = valeurs.length;
  return valeurs.map((v) => {
    let dessous = 0;
    let jusqua = 0;
    for (const x of valeurs) {
      if (x < v) dessous++;
      if (x <= v) jusqua++;
    }
    return ((n > 1 ? dessous / (n - 1) : 0) + jusqua / n) / 2;
  });
}

type Orateur = { chambre: 'AN' | 'SN'; acteur_uid: string; nb_interventions: number };

/**
 * Prises de parole par élu et par chambre sur un dossier. Lues d'abord dans le
 * pré-calcul de la nuit (`dossier_debats_cache.orateurs`, une ligne, le résultat exact
 * de la vue), et à défaut dans la vue `dossier_orateurs`. La vue relit toutes les
 * interventions du dossier (38 131 pour le PLF 2026, 160 à 500 ms) : deux lectures de ce
 * poids en même temps pouvaient dépasser le délai de 8 s de la clé de service. Une
 * ligne absente (dossier neuf, pas encore passé dans l'étape `cache-debats`) ou illisible
 * (migration pas encore appliquée) ne coûte que ce calcul d'origine.
 */
async function orateursDuDossier(uid: string): Promise<Orateur[]> {
  try {
    const cache = await auPlusUneLigne(sql<{ orateurs: Orateur[] }[]>`
      select orateurs from dossier_debats_cache where dossier_uid = ${uid}`, 'dossier_debats_cache');
    if (cache) return cache.orateurs;
  } catch (error) {
    console.error(`[elus-actifs] pré-calcul des orateurs illisible pour ${uid} : ${error instanceof Error ? error.message : String(error)}`);
  }
  return sql<Orateur[]>`
    select chambre, acteur_uid, nb_interventions
    from dossier_orateurs
    where dossier_uid = ${uid}
    order by chambre, acteur_uid`;
}

/**
 * Élus de la section « Les plus actifs dans ce dossier », une liste par
 * chambre, triée par score décroissant. Lancée par `DossierBody` avec les autres
 * requêtes, et par la route `/api/dossiers/[uid]/elus-actifs` (liste entière du
 * panneau). `rapporteur` y vaut toujours false : le badge vient des rapporteurs
 * d'`elusDesSources`, que seule la page connaît, et `marquerRapporteurs` le pose
 * côté page comme côté panneau.
 *
 * Trois mesures : prises de parole en séance, amendements déposés comme auteur
 * principal, présences en commission (Assemblée seule). Leurs volumes n'ont rien de
 * commun (un rapporteur du Sénat prend 254 fois la parole sur la loi de finances, le
 * député le plus assidu y siège 33 fois en commission) : les additionner ferait des
 * amendements la seule mesure qui compte. Le score suit donc la méthode du score
 * d'activité, que le lecteur retrouve sur /Activite : pour chaque mesure, le centile
 * de l'élu parmi les élus de sa chambre actifs sur ce texte (zéro compris pour une
 * mesure où il n'a rien fait), puis la moyenne pondérée par les poids publiés
 * (`ACTIVITE_WEIGHTS`), ramenée sur 100. Une mesure que personne dans la chambre n'a
 * sur ce texte sort du calcul, poids compris, comme un centile NULL dans
 * `activite_elus_mv` : les présences au Sénat, ou des amendements sur un texte qui
 * n'en a pas reçu. Les deux chambres ne se comparent jamais.
 *
 * Les trois sources sont des agrégats par élu (vue `dossier_orateurs`, lue par son
 * pré-calcul `dossier_debats_cache`, vue `dossier_presences_elus`, table `dossier_amendements_elus`, voir la migration
 * `2026-10-26_elus_actifs_dossier.sql`) : une ligne par élu, quelques centaines au
 * plus, chacune lue en une fois, puis les élus nommés en une lecture d'`acteurs`.
 * Un élu inconnu d'`acteurs` est écarté, la ligne ne sachant pas le nommer, et il
 * sort aussi de la population des centiles. Le groupe est celui d'aujourd'hui, ou le
 * dernier pour un ancien élu (`completerGroupesAnciens`), comme dans « Sources et
 * acteurs ». Une chambre sans aucune donnée n'est pas rendue.
 */
export async function elusActifs(uid: string): Promise<ElusActifsChambre[]> {
  type Ligne = { chambre: 'AN' | 'SN'; acteur_uid: string; nombre: number };
  const [orateurs, amendements, presences] = await Promise.all([
    orateursDuDossier(uid),
    sql<{ chambre: 'AN' | 'SN'; acteur_uid: string; nb_deposes: number }[]>`
      select chambre, acteur_uid, nb_deposes
      from dossier_amendements_elus
      where dossier_uid = ${uid}
      order by chambre, acteur_uid`,
    sql<{ acteur_uid: string; nb_reunions: number }[]>`
      select acteur_uid, nb_reunions
      from dossier_presences_elus
      where dossier_uid = ${uid}
      order by acteur_uid`,
  ]);
  const parole: Ligne[] = orateurs.map((l) => ({ chambre: l.chambre, acteur_uid: l.acteur_uid, nombre: l.nb_interventions }));
  const deposes: Ligne[] = amendements.map((l) => ({ chambre: l.chambre, acteur_uid: l.acteur_uid, nombre: l.nb_deposes }));
  const presents: Ligne[] = presences.map((l) => ({ chambre: 'AN', acteur_uid: l.acteur_uid, nombre: l.nb_reunions }));

  const refs = [...new Set([...parole, ...deposes, ...presents].map((l) => l.acteur_uid))];
  const acteurs = await completerGroupesAnciens(refs.length > 0
    ? await sql<(RawActeur & DrapeauxMandat & { url_profil_officiel?: string | null })[]>`
        select ${COLONNES_ELU_SOURCE} from acteurs a where a.uid = any(${refs}) order by a.uid`
    : []);
  const elus = new Map(acteurs.map((a) => [a.uid ?? '', versEluSource(a)]));

  const mesures = [
    { lignes: parole, poids: ACTIVITE_WEIGHTS.cpPrisesParole },
    { lignes: deposes, poids: ACTIVITE_WEIGHTS.cpAmendAuteur },
    { lignes: presents, poids: ACTIVITE_WEIGHTS.cpCommPres },
  ];

  const chambreClassee = (chambre: 'AN' | 'SN'): ElusActifsChambre => {
    const parMesure = mesures.map((m) => ({
      poids: m.poids,
      nombres: new Map(m.lignes.filter((l) => l.chambre === chambre && elus.has(l.acteur_uid)).map((l) => [l.acteur_uid, l.nombre])),
    })).filter((m) => m.nombres.size > 0);
    const population = [...new Set(parMesure.flatMap((m) => [...m.nombres.keys()]))];
    const sommePoids = parMesure.reduce((s, m) => s + m.poids, 0);
    const scores = new Array<number>(population.length).fill(0);
    for (const m of parMesure) {
      centilesDuMilieu(population.map((ref) => m.nombres.get(ref) ?? 0))
        .forEach((c, i) => { scores[i] += c * m.poids; });
    }
    // Tri sur le score exact, affichage à une décimale comme sur /Activite : sur un
    // gros texte, les premiers se tiennent entre 98 et 100, et un arrondi à l'entier
    // les départageait par leur nom.
    const nomDe = (ref: string) => `${elus.get(ref)!.nom ?? ''} ${elus.get(ref)!.prenom ?? ''}`;
    const liste = population
      .map((ref, i) => ({ ref, brut: scores[i] / sommePoids }))
      .sort((a, b) => b.brut - a.brut || nomDe(a.ref).localeCompare(nomDe(b.ref), 'fr') || a.ref.localeCompare(b.ref))
      .map(({ ref, brut }): EluActif => ({
        ...elus.get(ref)!,
        badge: null,
        score: Math.round(brut * 1000) / 10,
        rapporteur: false,
      }));
    return { chambre, nb: liste.length, elus: liste };
  };

  return (['AN', 'SN'] as const).map(chambreClassee).filter((c) => c.elus.length > 0);
}

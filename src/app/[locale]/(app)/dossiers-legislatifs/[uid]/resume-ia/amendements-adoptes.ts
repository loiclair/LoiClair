// src/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/amendements-adoptes.ts
// Serveur uniquement. Lecture des amendements adoptés d'un dossier, regroupés par
// auteur, partagée par la fiche (`page.tsx`, qui n'en envoie que la carte) et par la
// route `/api/dossiers/[uid]/amendements` (la liste entière, chargée à l'ouverture
// du panneau). Le passage d'une ligne `acteurs` à l'élu affiché (`versEluSource`)
// vit ici pour la même raison : la page s'en sert aussi pour ses autres sections.

import { sql } from '@/lib/db';
import { COLONNES_MANDAT, estAncienElu, type DrapeauxMandat } from '@/lib/ancien-elu';
import { completerGroupesAnciens } from '@/lib/groupe-ancien-elu';
import { amendementsAvecVote } from '@/lib/scrutin-votes';
import type { AuteurAmendements } from './ModificationsSection';
import { AMENDEMENTS_VISIBLES, AUTEURS_VISIBLES } from './amendements-carte';

export type RawActeur = {
  uid?: string | null;
  prenom?: string | null;
  nom?: string | null;
  civ?: string | null;
  roles_text?: string | null;
  groupe?: { uid: string; libelle: string } | { uid: string; libelle: string }[] | null;
};

/** Colonnes d'une ligne `acteurs a` lue pour `versEluSource`, à poser après `select`
 *  dans une requête `from acteurs a`. `groupe` est l'objet jsonb `{ uid, libelle }`,
 *  ou null, en dernière position : la forme qu'attendent les appelants. jsonb range ses
 *  clés par longueur de nom puis par ordre alphabétique, et non dans l'ordre du select.
 *  `COLONNES_MANDAT` est une constante du code, jamais une valeur venue de l'extérieur :
 *  `sql.unsafe` ne fait que la recopier.
 *  Lues par `elusDesAuteurs`, par `elusActifs` et par `elusDesSources` (page.tsx). */
export const COLONNES_ELU_SOURCE = sql`a.uid, a.prenom, a.nom, a.civ, a.url_profil_officiel, ${sql.unsafe(COLONNES_MANDAT)},
  (select jsonb_build_object('uid', o.uid, 'libelle', o.libelle) from organes o where o.uid = a.groupe) as groupe`;

/** Élu de la section « Sources et acteurs », sans badge, depuis une ligne `acteurs`
 *  lue avec `COLONNES_ELU_SOURCE` : `civ`, `url_profil_officiel`, `COLONNES_MANDAT`
 *  (qui disent s'il est un ancien élu : photo grisée, badge au passé accordé par
 *  `civ`) et le groupe, complété par `completerGroupesAnciens` du dernier groupe d'un
 *  ancien élu.
 *  Partagée par `elusDesSources` et `amendementsAdoptes` (section « Modifications
 *  du texte »). */
export function versEluSource(a: RawActeur & DrapeauxMandat & { url_profil_officiel?: string | null }) {
  const groupe = Array.isArray(a.groupe) ? a.groupe[0] ?? null : a.groupe ?? null;
  return {
    uid: a.uid ?? '',
    prenom: a.prenom ?? null,
    nom: a.nom ?? null,
    civ: a.civ ?? null,
    url_profil_officiel: a.url_profil_officiel ?? null,
    groupe: groupe?.libelle ?? null,
    ancien: estAncienElu(a),
  };
}

/** Ce qui définit un auteur dans une ligne `amendements` : son type, son uid et son
 *  libellé, plus la chambre de la ligne, qui donne le rôle d'un parlementaire. */
type GroupeAuteur = {
  auteur_type: AuteurAmendements['type'];
  auteur_uid: string | null;
  auteur_libelle: string | null;
  chambre: 'AN' | 'SN';
};

/** Les élus des uid donnés, prêts pour l'affichage. Les auteurs d'un dossier se
 *  comptent au plus par centaines. */
async function elusDesAuteurs(refs: string[]) {
  const acteurs = await completerGroupesAnciens(refs.length > 0
    ? await sql<(RawActeur & DrapeauxMandat & { url_profil_officiel?: string | null })[]>`
        select ${COLONNES_ELU_SOURCE} from acteurs a where a.uid = any(${refs}) order by a.uid`
    : []);
  return new Map(acteurs.map((a) => [a.uid ?? '', versEluSource(a)]));
}

/**
 * Ajoute `nb` amendements d'un groupe (une ligne, ou toutes les lignes d'un même
 * auteur) à son auteur, et rend celui-ci. Une entrée par élu (un rapporteur qui a
 * aussi déposé en son nom reste une seule ligne, badge de rapporteur ajouté au rôle),
 * une pour le Gouvernement, une par commission ou par nom non résolu. Type, libellé
 * et rôle viennent du premier groupe vu : l'appelant les passe dans l'ordre des
 * amendements.
 */
function ajouterGroupe(
  parAuteur: Map<string, AuteurAmendements>,
  elus: Map<string, ReturnType<typeof versEluSource>>,
  g: GroupeAuteur,
  nb: number,
): AuteurAmendements {
  const elu = g.auteur_uid ? elus.get(g.auteur_uid) ?? null : null;
  // Un auteur sans fiche ni nom (député absent d'`acteurs`) se regroupe sous son
  // uid, et la ligne n'affiche alors que sa chambre.
  const cle = g.auteur_type === 'gouvernement' ? 'gouvernement'
    : elu ? `elu:${elu.uid}`
    : g.auteur_libelle ? `${g.auteur_type === 'commission' ? 'commission' : 'nom'}:${g.auteur_libelle}`
    : `inconnu:${g.auteur_uid ?? g.chambre}`;
  let auteur = parAuteur.get(cle);
  if (!auteur) {
    auteur = {
      cle,
      type: g.auteur_type,
      elu,
      libelle: g.auteur_libelle,
      // Une commission se nomme elle-même : pas de badge de rôle.
      role: g.auteur_type === 'gouvernement' || g.auteur_type === 'commission' ? null
        : g.chambre === 'AN' ? 'depute' : 'senateur',
      rapporteur: false,
      nb: 0,
      amendements: [],
    };
    parAuteur.set(cle, auteur);
  }
  if (g.auteur_type === 'rapporteur') auteur.rapporteur = true;
  auteur.nb += nb;
  return auteur;
}

/** Tri par nombre décroissant, puis par nom, puis par clé. */
function trierAuteurs(auteurs: AuteurAmendements[]): AuteurAmendements[] {
  const nom = (a: AuteurAmendements) => a.elu ? `${a.elu.nom ?? ''} ${a.elu.prenom ?? ''}` : a.libelle ?? '';
  return auteurs.sort((a, b) => b.nb - a.nb || nom(a).localeCompare(nom(b), 'fr') || a.cle.localeCompare(b.cle));
}

/**
 * Amendements adoptés du dossier, regroupés par auteur, pour le bloc « Amendements
 * adoptés » de la section « Modifications du texte ». Triés par nombre décroissant,
 * puis par nom.
 *
 * Deux usages, deux lectures. Par défaut, la carte de la fiche (`page.tsx`, lancée
 * par `DossierBody` avec `elusDesSources`) : tous les auteurs avec leur total `nb`,
 * mais les amendements des seuls AUTEURS_VISIBLES premiers, AMENDEMENTS_VISIBLES
 * chacun, ce que `carteAmendements` garde. Postgres compte et choisit
 * (`amendements_adoptes_auteurs`, `amendements_adoptes_premiers`, migration
 * `2026-10-29_amendements_adoptes_carte.sql`) : la loi de finances 2026 lisait ses
 * 3 306 amendements, environ 925 Ko, pour en afficher cent. `complet` : la liste
 * entière, pour le panneau (`/api/dossiers/[uid]/amendements`), en une lecture.
 *
 * La table `amendements` est remplie par `import_amendements.py`.
 */
export async function amendementsAdoptes(uid: string, complet = false): Promise<AuteurAmendements[]> {
  if (!complet) return carteDesAuteurs(uid);

  type LigneAmendement = GroupeAuteur & {
    uid: string;
    lieu: 'seance' | 'commission';
    numero: string;
    article: string | null;
    url: string;
  };
  const lignes = await sql<LigneAmendement[]>`
    select uid, chambre, lieu, numero, article, auteur_type, auteur_uid, auteur_libelle, url
    from amendements
    where dossier_uid = ${uid}
    order by date_amendement asc nulls last, uid`;
  if (lignes.length === 0) return [];

  const [elus, avecVote] = await Promise.all([
    elusDesAuteurs([...new Set(lignes.map((l) => l.auteur_uid).filter((r): r is string => !!r))]),
    amendementsAvecVote(lignes.map((l) => l.uid)),
  ]);
  const parAuteur = new Map<string, AuteurAmendements>();
  for (const l of lignes) {
    ajouterGroupe(parAuteur, elus, l, 1).amendements.push({ uid: l.uid, numero: l.numero, article: l.article, lieu: l.lieu, chambre: l.chambre, url: l.url, ...(avecVote.has(l.uid) && { avecVote: true }) });
  }
  return trierAuteurs([...parAuteur.values()]);
}

/** Le mode carte d'`amendementsAdoptes` : les mêmes auteurs, dans le même ordre et
 *  avec le même `nb` que la liste complète, les amendements des dix premiers seuls. */
async function carteDesAuteurs(uid: string): Promise<AuteurAmendements[]> {
  // Une ligne par groupe d'auteur et par chambre, rangées par premier amendement :
  // 655 pour la loi de finances 2026. L'ordre est celui de la fonction, qui est total.
  const groupes = await sql<(GroupeAuteur & { nb: number })[]>`
    select * from amendements_adoptes_auteurs(p_dossier => ${uid})`;
  if (groupes.length === 0) return [];

  const elus = await elusDesAuteurs([...new Set(groupes.map((g) => g.auteur_uid).filter((r): r is string => !!r))]);
  const parAuteur = new Map<string, AuteurAmendements>();
  // Les groupes qui composent chaque auteur, pour aller chercher ses amendements.
  const groupesDe = new Map<string, GroupeAuteur[]>();
  for (const g of groupes) {
    const { cle } = ajouterGroupe(parAuteur, elus, g, Number(g.nb));
    groupesDe.set(cle, [...(groupesDe.get(cle) ?? []), g]);
  }
  const auteurs = trierAuteurs([...parAuteur.values()]);

  const cles = auteurs.slice(0, AUTEURS_VISIBLES).map((a) => ({
    cle: a.cle,
    groupes: (groupesDe.get(a.cle) ?? []).map((g) => ({ type: g.auteur_type, uid: g.auteur_uid, libelle: g.auteur_libelle, chambre: g.chambre })),
  }));
  // `sql.json` et non `JSON.stringify(...)::jsonb` : postgres.js sérialise lui-même un
  // paramètre que Postgres type en jsonb, et une chaîne déjà sérialisée arriverait en
  // scalaire texte (« cannot extract elements from a scalar », constaté le 2026-11-05).
  const premiers = await sql<{ cle: string; uid: string; numero: string; article: string | null; lieu: 'seance' | 'commission'; chambre: 'AN' | 'SN'; url: string }[]>`
    select * from amendements_adoptes_premiers(p_dossier => ${uid}, p_cles => ${sql.json(cles)}, p_limite => ${AMENDEMENTS_VISIBLES})`;
  const avecVote = await amendementsAvecVote(premiers.map((p) => p.uid));
  for (const p of premiers) {
    parAuteur.get(p.cle)?.amendements.push({ uid: p.uid, numero: p.numero, article: p.article, lieu: p.lieu, chambre: p.chambre, url: p.url, ...(avecVote.has(p.uid) && { avecVote: true }) });
  }
  return auteurs;
}

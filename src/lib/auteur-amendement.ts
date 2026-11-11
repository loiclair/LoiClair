// L'auteur d'un amendement et la fiche de contact d'un élu, partagés par le tiroir de
// « Ce qui me concerne » (`api/ce-qui-me-concerne/element`) et par la page d'un amendement
// (`lib/amendement-page.ts`). Serveur uniquement : lit la base.

import { sql } from '@/lib/db';
import { COLONNES_MANDAT, estAncienElu } from '@/lib/ancien-elu';
import { completerGroupesAnciens } from '@/lib/groupe-ancien-elu';
import type { AuteurAmendement, AuteurElement, EluContactable } from '@/lib/ce-qui-me-concerne';

/** Les colonnes d'auteur d'une ligne `amendements`. */
export type LigneAuteur = { auteur_type: AuteurAmendement['type']; auteur_uid: string | null; auteur_libelle: string | null };

/** L'auteur d'un amendement, avec la fiche de l'élu quand `import_amendements.py` l'a
 *  rattaché à un acteur connu (même jointure que les amendements de la fiche dossier). */
export async function auteurDe(a: LigneAuteur): Promise<AuteurElement> {
  const elus = a.auteur_uid ? await elusContactables([a.auteur_uid]) : [];
  return { type: a.auteur_type, elus, libelle: a.auteur_libelle };
}

type LigneActeur = Omit<EluContactable, 'groupe' | 'chambre' | 'ancien'> & {
  est_depute_actuel: boolean | null;
  est_senateur_actuel: boolean | null;
  est_ministre_actuel: boolean | null;
  roles_text: string | null;
  groupe: { libelle: string | null } | null;
};

/** Les fiches de contact de quelques élus, dans l'ordre de `uids` ; un uid absent
 *  d'`acteurs` est sauté. La chambre est celle du mandat en cours, qui choisit la
 *  formule du courriel : un député devenu sénateur s'écrit « Monsieur le Sénateur »,
 *  même sur un amendement déposé à l'Assemblée. */
export async function elusContactables(uids: string[]): Promise<EluContactable[]> {
  // L'ordre des colonnes compte : `reste`, plus bas, les rend dans cet ordre. `groupe`
  // est l'objet du groupe actuel, `null` sans groupe. `COLONNES_MANDAT` est une
  // constante du code, jamais une valeur venue de l'extérieur, d'où `sql.unsafe`.
  const data = await sql<LigneActeur[]>`
    select a.uid, a.prenom, a.nom, a.civ, a.email, a.twitter_url, a.instagram_url, a.facebook_url,
      a.linkedin_url, a.url_profil_officiel, ${sql.unsafe(COLONNES_MANDAT)},
      (select jsonb_build_object('libelle', o.libelle) from organes o where o.uid = a.groupe) as groupe
    from acteurs a
    where a.uid = any(${uids})
    order by a.uid`;
  // Un ancien élu reçoit son dernier groupe, la colonne `groupe` étant vide pour lui.
  const parUid = new Map((await completerGroupesAnciens(data)).map((a) => [a.uid, a]));
  return uids.flatMap((uid) => {
    const a = parUid.get(uid);
    if (!a) return [];
    const { est_depute_actuel, est_senateur_actuel, est_ministre_actuel, roles_text, groupe, ...reste } = a;
    const chambre = est_depute_actuel ? 'AN' : est_senateur_actuel ? 'SN' : null;
    // Un ancien élu n'a ni courriel ni réseaux ici : la base garde l'adresse
    // parlementaire de 1 494 des 2 255 anciens élus (mesuré le 2026-10-19), que la
    // chambre ferme en fin de mandat. Son nom mène toujours à sa fiche.
    const contact = chambre ? {} : { email: null, twitter_url: null, instagram_url: null, facebook_url: null, linkedin_url: null };
    const ancien = estAncienElu({ est_depute_actuel, est_senateur_actuel, est_ministre_actuel, roles_text });
    return [{ ...reste, ...contact, groupe: groupe?.libelle ?? null, chambre, ancien }];
  });
}

// Qui a écrit un dossier, et comment lui écrire : l'auteur (initiateur, sinon le premier
// auteur nommé par ses textes) et sa forme de contact, pour la droite du bandeau « Écrire à
// mes élus » (`ContacterMesElusBanner`). Sorti de la fiche du texte (`resume-ia/page.tsx`),
// qui s'en sert aussi pour son hero, pour que la page d'un vote montre le même auteur.
// Serveur uniquement : lit la base.

import { sql, auPlusUneLigne } from '@/lib/db';
import { COLONNES_MANDAT, estAncienElu } from '@/lib/ancien-elu';
import { estOrigineGouvernementale } from '@/lib/origine-gouvernementale';
import type { DroiteBandeau, PersonneContact } from '@/components/ContacterMesElusBanner';
import type { RawActeur } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/amendements-adoptes';

/** Colonnes d'un auteur ou d'un rapporteur, lues par la requête du dossier
 *  (`initiateur_acteur_ref`), par `chargerAuteur` et par celle des rapporteurs : le
 *  hero en tire le nom et la fonction (`normalizeActeur`), la bande du pied de quoi
 *  écrire (`versPersonneContact`). `COLONNES_MANDAT` y porte ce dont `estAncienElu` et
 *  `fonctionElu` ont besoin ; c'est une constante du code, que `sql.unsafe` ne fait que
 *  recopier. À poser après `select` dans une requête `from acteurs a`. `groupe` est
 *  l'objet jsonb `{ uid, libelle }`, en dernière position : la forme qu'attendent les
 *  appelants (voir la requête du dossier pour l'ordre des clés). */
export const COLONNES_CONTACT = sql`a.uid, a.nom, a.prenom, a.civ, a.email, a.twitter_url, a.instagram_url, a.facebook_url,
  a.linkedin_url, ${sql.unsafe(COLONNES_MANDAT)}, a.date_debut_mandat, a.periodes_mandat_assemblee, a.url_profil_officiel,
  (select jsonb_build_object('uid', o.uid, 'libelle', o.libelle) from organes o where o.uid = a.groupe) as groupe`;

export type RawContact = RawActeur & {
  civ?: string | null;
  email?: string | null;
  twitter_url?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  linkedin_url?: string | null;
  est_depute_actuel?: boolean | null;
  est_senateur_actuel?: boolean | null;
  est_ministre_actuel?: boolean | null;
  date_debut_mandat?: string | null;
  periodes_mandat_assemblee?: PersonneContact['periodes_mandat_assemblee'];
  url_profil_officiel?: string | null;
};

/** L'auteur ou un rapporteur, tel que la bande du pied le montre à droite des élus du
 *  lecteur. Le `statut` dit comment lui écrire : `mandat` par courriel ou réseau dans sa
 *  chambre d'aujourd'hui (qui choisit la formule du courriel et le vote affiché),
 *  `ministre` par le formulaire du Premier ministre (sa boîte de député n'atteint pas le
 *  ministère), `ancien` et `sansContact` pas du tout. Null sans fiche. */
export function versPersonneContact(a: RawContact | null | undefined): PersonneContact | null {
  if (!a?.uid) return null;
  const chambre = a.est_depute_actuel ? 'AN' : a.est_senateur_actuel ? 'SN' : null;
  const joignable = !!(a.email || a.twitter_url || a.instagram_url || a.facebook_url || a.linkedin_url);
  // Le ministre passe avant la chambre : l'import pose `est_ministre_actuel` sans
  // toucher aux drapeaux de mandat (`import_acteurs_organes_cloud.py`), et un ministre
  // peut garder un mandat de parlementaire ouvert dans la source.
  const statut: PersonneContact['statut'] = a.est_ministre_actuel ? 'ministre'
    : estAncienElu(a) ? 'ancien'
    : joignable ? 'mandat' : 'sansContact';
  const groupe = Array.isArray(a.groupe) ? a.groupe[0] ?? null : a.groupe ?? null;
  return {
    uid: a.uid,
    prenom: a.prenom ?? null,
    nom: a.nom ?? null,
    civ: a.civ ?? null,
    email: a.email ?? null,
    twitter_url: a.twitter_url ?? null,
    instagram_url: a.instagram_url ?? null,
    facebook_url: a.facebook_url ?? null,
    linkedin_url: a.linkedin_url ?? null,
    groupe_libelle: groupe?.libelle ?? null,
    groupe_abrege: null,
    date_debut_mandat: a.date_debut_mandat ?? null,
    periodes_mandat_assemblee: a.periodes_mandat_assemblee ?? null,
    url_profil_officiel: a.url_profil_officiel ?? null,
    chambre,
    statut,
  };
}

/** Ce que les textes du dossier nomment, pour un dossier sans initiateur ni acte de
 *  nomination : le premier auteur, et les rapporteurs sans doublon. Une seule lecture
 *  pour les deux, dans l'ordre des textes (date de création, comme la section
 *  « Sources et acteurs ») : les dossiers sans auteur (rapports d'information sans
 *  mission, commissions d'enquête du Sénat, quelques pétitions, 552 mesurés le
 *  2026-10-19) n'ont plus à relire la table pour leurs rapporteurs. Cet ordre donne le
 *  même auteur que l'ancienne lecture sans ordre sur les 15 dossiers concernés
 *  (mesuré le 2026-10-20). */
export async function lireTextesDeRepli(uid: string): Promise<{ auteurRef: string | null; rapporteurRefs: string[] }> {
  const textes = await sql<{ auteurs_refs: string[] | string | null; rapporteurs_refs: string[] | null }[]>`
    select auteurs_refs, rapporteurs_refs
    from textes
    where dossier_ref = ${uid} and (auteurs_refs is not null or rapporteurs_refs is not null)
    order by date_creation asc, uid desc`;
  // `auteurs_refs` arrive parfois en chaîne séparée par des virgules.
  const auteurs = textes.find((t) => t.auteurs_refs)?.auteurs_refs;
  const auteurRef = (Array.isArray(auteurs) ? auteurs[0] : auteurs?.split(',')?.[0]?.trim()) || null;
  return { auteurRef, rapporteurRefs: [...new Set(textes.flatMap((t) => t.rapporteurs_refs ?? []))] };
}

/** La fiche de l'auteur de repli, brute : le hero la normalise, la bande du pied en
 *  tire le contact. */
export async function chargerAuteur(ref: string): Promise<RawContact | null> {
  const acteurData = await sql<RawContact[]>`
    select ${COLONNES_CONTACT} from acteurs a where a.uid = ${ref} limit 1`;
  return acteurData[0] ?? null;
}

/**
 * Ce que le bandeau des élus pose à droite : le Gouvernement pour ses textes, sinon
 * l'auteur, sinon les rapporteurs (fiche du texte seulement). Rien quand le dossier ne
 * nomme personne. Un projet de révision de la Constitution est présenté au nom du Président
 * (article 89), et la source le nomme parfois comme auteur à la place du Premier ministre :
 * au 2026-10-28, un seul des trois projets de la législature (DLR5L17N54218). Le lecteur est
 * alors envoyé à l'Élysée, comme le dit l'en-tête. `roles_text` porte cette valeur exacte
 * tant que le mandat de Président est en cours (`import_acteurs_organes_cloud.py`).
 */
export function droiteBandeau(
  origineGouvernementale: boolean,
  auteurBrut: RawContact | null | undefined,
  rapporteurs: { personnes: PersonneContact[]; total: number } | null = null,
): DroiteBandeau {
  const auteurContact = versPersonneContact(auteurBrut);
  const auteurPresident = (auteurBrut?.roles_text ?? '').trim() === 'Président de la République';
  return origineGouvernementale ? { kind: auteurPresident ? 'president' : 'gouvernement' }
    : auteurContact ? { kind: 'auteur', personnes: [auteurContact] }
    : rapporteurs && rapporteurs.personnes.length > 0 ? { kind: 'rapporteurs', ...rapporteurs }
    : null;
}

/**
 * La droite du bandeau des élus pour un dossier, sur la page d'un vote : le Gouvernement
 * (ou le Président) pour ses textes, sinon l'auteur, comme sur la fiche du texte. Les
 * rapporteurs que la fiche y met à défaut d'auteur n'y sont pas : ils n'y viennent que
 * pour les dossiers de contrôle et les dossiers sans auteur nommé, qu'aucun scrutin
 * public ne vote. Rien quand le dossier ne nomme personne.
 */
export async function droiteDuDossier(uid: string): Promise<DroiteBandeau> {
  type Ligne = {
    initiateur: RawContact | null;
    initiateur_groupe_libelle: string | null;
    textes_associes_refs: string[] | null;
  };
  const d = await auPlusUneLigne(sql<Ligne[]>`
    select (select to_jsonb(c) from (select ${COLONNES_CONTACT} from acteurs a where a.uid = d.initiateur_acteur_ref) c)
        as initiateur,
      d.initiateur_groupe_libelle, d.textes_associes_refs
    from dossiers_legislatifs d
    where d.uid = ${uid}`, 'dossiers_legislatifs (auteur)');
  if (!d) return null;
  // Même repli que la fiche du texte : sans initiateur, le premier auteur de ses textes.
  let auteurBrut = d.initiateur;
  if (!auteurBrut) {
    const repli = await lireTextesDeRepli(uid);
    if (repli.auteurRef) auteurBrut = await chargerAuteur(repli.auteurRef);
  }
  return droiteBandeau(estOrigineGouvernementale(d.textes_associes_refs, d.initiateur_groupe_libelle), auteurBrut);
}

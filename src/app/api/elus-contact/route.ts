// src/app/api/elus-contact/route.ts
// Liste des députés et sénateurs en exercice avec leurs moyens de contact, lue par la
// modale « Trouver mes élus » (`TrouverMonDeputeModal`), qui fait la recherche elle-même
// (`src/lib/trouver-elus.ts`). La route ne prend aucun paramètre, exprès : la réponse est
// la même pour tous les visiteurs, et LoiClair ne reçoit jamais le code postal ni le pays
// tapés. Remettre la recherche côté serveur casserait la promesse de la bulle d'info de la
// bande « Écrire à mes élus ».

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import type { EluContact, ElusContact } from '@/lib/trouver-elus';
import type { PeriodeMandat } from '@/hooks/useMesElus';

// Invalidée par `/api/revalidate` à la fin du run de nuit ; la minuterie de 24 h ne sert
// que de filet pour une nuit sans cet appel.
export const revalidate = 86400;

type ActeurRow = {
  uid: string;
  prenom: string | null;
  nom: string | null;
  civ: string | null;
  email: string | null;
  twitter_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  linkedin_url: string | null;
  num_circo: string | null;
  num_departement: string | null;
  departement_election: string | null;
  date_debut_mandat: string | null;
  periodes_mandat_assemblee: PeriodeMandat[] | null;
  est_depute_actuel: boolean | null;
  url_profil_officiel: string | null;
  groupe: { libelle: string | null; libelle_abrege: string | null } | null;
};

// Élus des Français établis hors de France : `departement_election` vaut
// « Français établis hors de France ». Insensible à la casse, comme un `ilike` PostgreSQL.
const HORS_DE_FRANCE = /^français.*hors de france/i;

export async function GET() {
  // Une erreur de lecture est relancée, jamais rendue en réponse 500 : Next.js met en cache
  // ISR toute réponse rendue, statut compris, et une coupure passagère de la base casserait
  // la recherche d'élus pour tous les visiteurs pendant 24 h. Sur une régénération par la
  // minuterie, une exception garde l'ancienne liste en cache. Après le marquage de
  // `/api/revalidate`, Next ne relit plus cette copie : la route rend 500 tant que la base
  // ne répond pas, et la modale affiche son message d'erreur.
  let rows: ActeurRow[];
  try {
    // Une seule lecture, triée par uid : l'ordre des listes de la réponse suit cet ordre.
    // `groupe` est l'objet du groupe actuel, `null` pour un élu sans groupe.
    rows = await sql<ActeurRow[]>`
      select a.uid, a.prenom, a.nom, a.civ, a.email, a.twitter_url, a.instagram_url, a.facebook_url,
        a.linkedin_url, a.num_circo, a.num_departement, a.departement_election, a.date_debut_mandat,
        a.periodes_mandat_assemblee, a.est_depute_actuel, a.url_profil_officiel,
        (select jsonb_build_object('libelle', o.libelle, 'libelle_abrege', o.libelle_abrege)
          from organes o where o.uid = a.groupe) as groupe
      from acteurs a
      where (a.est_depute_actuel = true or a.est_senateur_actuel = true)
      order by a.uid`;
  } catch (error) {
    console.error('[elus-contact]', error);
    throw new Error('[elus-contact] lecture des élus impossible');
  }

  const elus: ElusContact = { deputes: [], senateurs: [] };
  for (const r of rows) {
    const g = r.groupe;
    const elu: EluContact = {
      uid: r.uid,
      prenom: r.prenom,
      nom: r.nom,
      civ: r.civ,
      email: r.email,
      twitter_url: r.twitter_url,
      instagram_url: r.instagram_url,
      facebook_url: r.facebook_url,
      linkedin_url: r.linkedin_url,
      num_circo: r.num_circo,
      num_departement: r.num_departement,
      date_debut_mandat: r.date_debut_mandat,
      periodes_mandat_assemblee: r.periodes_mandat_assemblee,
      groupe_libelle: g?.libelle ?? null,
      groupe_abrege: g?.libelle_abrege ?? null,
      hors_de_france: HORS_DE_FRANCE.test(r.departement_election ?? ''),
      // Pour la photo d'un sénateur seulement (voir `EluLite`).
      url_profil_officiel: r.est_depute_actuel ? null : r.url_profil_officiel,
    };
    (r.est_depute_actuel ? elus.deputes : elus.senateurs).push(elu);
  }

  return NextResponse.json(elus, {
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800' },
  });
}

// src/app/api/search-index/acteurs/route.ts
// Index complet des acteurs (élus + gouvernement) pour la recherche client-side.
// Recherche 100 % keyword, comme celle des dossiers. Invalidée par `/api/revalidate`
// à la fin du run de nuit ; la minuterie de 24 h ne sert que de filet.

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { empreinte } from '@/lib/search/dossier-resumes';

export const revalidate = 86400;

type ActeurRow = {
  uid: string;
  prenom: string | null;
  nom: string | null;
  civ: string | null;
  en_exercice: boolean | null;
  est_depute_actuel: boolean | null;
  est_senateur_actuel: boolean | null;
  est_ministre_actuel: boolean | null;
  qualite_actuelle: string | null;
  departement_election: string | null;
  libelle_profession: string | null;
  ministere: string | null;
  url_profil_officiel: string | null;
  groupe_uid: string | null;
  groupe: { libelle: string | null } | null;
};

export async function GET() {
  let rows: ActeurRow[];
  try {
    // `groupe_uid` relit la colonne `groupe` sous un autre nom, `groupe` désignant
    // l'objet du groupe (`null` pour un élu sans groupe).
    rows = await sql<ActeurRow[]>`
      select a.uid, a.prenom, a.nom, a.civ, a.en_exercice, a.est_depute_actuel, a.est_senateur_actuel,
        a.est_ministre_actuel, a.qualite_actuelle, a.departement_election, a.libelle_profession,
        a.ministere, a.url_profil_officiel, a.groupe as groupe_uid,
        (select jsonb_build_object('libelle', o.libelle) from organes o where o.uid = a.groupe) as groupe
      from acteurs a
      where a.en_exercice = true
      order by a.uid`;
  } catch (error) {
    console.error('[search-index/acteurs]', error);
    // Relancée, jamais rendue en réponse 500 : Next met en cache ISR toute réponse rendue,
    // statut compris, et une coupure passagère de la base pendant la revalidation casserait
    // la recherche des nouveaux visiteurs pendant 24 h. Sur une régénération par la
    // minuterie, une exception garde l'ancien index.
    // Après le marquage de `/api/revalidate`, Next ne relit plus cette copie : la route
    // rend 500 tant que la base ne répond pas.
    throw new Error('[search-index/acteurs] lecture des acteurs impossible');
  }

  // Résoudre les libellés ministère (pas de FK sur la colonne `ministere`). Lève sur
  // une panne, pour la même raison que la lecture des acteurs plus haut : un index sans
  // libellés de ministère resterait en cache sans que rien ne le signale.
  const ministereUids = [...new Set(rows.map((a) => a.ministere).filter((u): u is string => !!u))];
  const ministereMap = new Map<string, string>();
  if (ministereUids.length > 0) {
    const organes = await sql<{ uid: string; libelle: string | null }[]>`
      select uid, libelle from organes where uid = any(${ministereUids})`;
    for (const o of organes) {
      if (o.libelle) ministereMap.set(o.uid, o.libelle);
    }
  }

  const acteurs = rows.map((a) => {
    const groupe = a.groupe;
    return {
      uid: a.uid,
      prenom: a.prenom ?? null,
      nom: a.nom ?? null,
      civ: a.civ ?? null,
      groupe_libelle: groupe?.libelle ?? null,
      // Le nom du fichier de logo (`public/images/groupes/{uid}.*`). La colonne
      // `groupe` est relue sous ce nom : `groupe` désigne déjà la jointure.
      groupe_uid: a.groupe_uid ?? null,
      departement_election: a.departement_election ?? null,
      libelle_profession: a.libelle_profession ?? null,
      ministere_libelle: a.ministere ? ministereMap.get(a.ministere) ?? null : null,
      en_exercice: !!a.en_exercice,
      est_depute_actuel: !!a.est_depute_actuel,
      est_senateur_actuel: !!a.est_senateur_actuel,
      est_ministre_actuel: !!a.est_ministre_actuel,
      qualite_actuelle: a.qualite_actuelle ?? null,
      // Sert à dériver l'URL du portrait officiel (`photoElu`), et n'est donc
      // porté que par les sénateurs : côté Assemblée l'`uid` suffit, et
      // embarquer 577 URL de fiches gonflerait l'index pour rien.
      url_profil_officiel: a.est_senateur_actuel ? a.url_profil_officiel ?? null : null,
    };
  });

  // La version pilote le cache IndexedDB du client, qui garde sa copie tant qu'elle
  // n'a pas bougé. Elle valait la date du jour (UTC) plus un numéro de schéma tenu à
  // la main : un groupe changé par le run de nuit n'atteignait pas un visiteur venu
  // plus tôt le même jour. L'empreinte change exactement quand le payload change,
  // forme comprise, comme celle de l'index des dossiers. Les lignes arrivent triées
  // par uid, l'empreinte est donc stable d'une génération à l'autre.
  const version = empreinte(acteurs);

  const res = NextResponse.json({ version, acteurs });
  res.headers.set(
    'Cache-Control',
    'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400'
  );
  return res;
}

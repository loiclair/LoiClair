// src/app/api/search-index/amendements/route.ts
// Endpoint statique de l'index des amendements de la page Textes (LOI-83) : les
// métadonnées de chaque amendement adopté ou rejeté par scrutin public (page
// `/Amendements/[uid]`) et de chaque scrutin public sur un amendement rattaché à son
// dossier que la table n'a pas (ligne vers la page officielle du scrutin). Chargé par `lib/search/amendement-index.ts` à la première requête
// tapée, jamais avant. Le dispositif et les résumés partent par
// `/api/search-index/amendements/textes` ; seule leur version est ici.
// Mêmes durées de cache que l'index des dossiers (D-263), et invalidée avec lui par
// `/api/revalidate` à la fin du run de nuit.

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { empreinte } from '@/lib/search/dossier-resumes';
import { lireVersionTextesAmendements } from '@/lib/search/amendement-textes';
import { COLONNE_ENSEMBLE as ENSEMBLE, JOINTURES_ETAT } from '@/lib/etat-amendement';
import type { AmendementMeta, VoteAmendementMeta } from '@/lib/search/amendement-index';

export const revalidate = 86400;

export async function GET() {
  let amendements: AmendementMeta[];
  let votes: VoteAmendementMeta[];
  let textesVersion: string;
  try {
    [amendements, votes, textesVersion] = await Promise.all([
      // L'auteur comme `auteurDe` (`lib/auteur-amendement.ts`) : l'élu rattaché par
      // `import_amendements.py`, sinon le libellé de la source. Le Gouvernement n'a ni
      // l'un ni l'autre : son nom se traduit à l'affichage, d'après `auteur_type`.
      // `hors_liste` : mêmes dossiers que la liste des textes, sans quoi un amendement
      // trouvé n'aurait pas de texte sous lequel se ranger.
      // Adoptés et rejetés par scrutin public (`sort`, LOI-85). Pour un adopté, où en est le
      // texte qui l'a reçu (`ensemble`, `ensemble_date`) : règle dans `lib/etat-amendement.ts`,
      // la même que lit la page de l'amendement.
      sql<AmendementMeta[]>`
        select a.uid, a.dossier_uid, a.numero, a.article, a.chambre, a.lieu, a.date_amendement as date,
          a.auteur_type, a.sort = 'adopte' as adopte,
          coalesce(nullif(trim(concat_ws(' ', ac.prenom, ac.nom)), ''), a.auteur_libelle) as auteur,
          e.d as ensemble_date, ${ENSEMBLE}
        from amendements a
        join dossiers_legislatifs d on d.uid = a.dossier_uid and d.hors_liste = false
        left join acteurs ac on ac.uid = a.auteur_uid
        ${JOINTURES_ETAT}
        order by a.uid`,
      // `dossier_uid` est posé par `import_amendements.py` (`RattachementVotes`). Un vote
      // déjà relié à un amendement présent dans la table (`votes_amendements`), adopté ou
      // rejeté, n'entre pas : sa ligne serait le double de celle de l'amendement. Ceux qui
      // restent n'ont pas de page sur LoiClair : leur ligne mène à la page officielle.
      sql<VoteAmendementMeta[]>`
        select s.uid, s.dossier_uid, s.titre, s.titre_en, s.date_scrutin::date as date,
          s.sort_code = 'adopté' as adopte
        from scrutins s
        join dossiers_legislatifs d on d.uid = s.dossier_uid and d.hors_liste = false
        where not exists (
          select 1 from votes_amendements v
          where v.uid = s.uid and exists (select 1 from amendements a where a.uid = any(v.amendement_uids))
        )
        order by s.uid`,
      lireVersionTextesAmendements(),
    ]);
  } catch (e) {
    console.error('[search-index/amendements]', e);
    // Relancée, jamais rendue en réponse 500 : Next mettrait l'erreur en cache ISR pour
    // 24 h. Sur une régénération par la minuterie, une exception garde l'ancien index.
    // Après le marquage de `/api/revalidate`, Next ne relit plus cette copie : la route
    // rend 500 tant que la base ne répond pas.
    throw new Error('[search-index/amendements] lecture des amendements impossible');
  }

  // Empreinte du payload, comme l'index des dossiers : elle change exactement quand le
  // payload change, et pilote la copie IndexedDB du client.
  const version = empreinte({ amendements, votes });
  const res = NextResponse.json({ version, textesVersion, amendements, votes });
  res.headers.set(
    'Cache-Control',
    'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800'
  );
  return res;
}

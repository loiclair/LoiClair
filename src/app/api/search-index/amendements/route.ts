// src/app/api/search-index/amendements/route.ts
// Endpoint statique de l'index des amendements de la page Textes (LOI-83) : les
// métadonnées de chaque amendement adopté (page `/Amendements/[uid]`) et de chaque
// scrutin public sur un amendement rattaché à son dossier (page `/Scrutins/[uid]`), la
// plupart rejetés. Chargé par `lib/search/amendement-index.ts` à la première requête
// tapée, jamais avant. Le dispositif et les résumés partent par
// `/api/search-index/amendements/textes` ; seule leur version est ici.
// Mêmes durées de cache que l'index des dossiers (D-263), et invalidée avec lui par
// `/api/revalidate` à la fin du run de nuit.

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { empreinte } from '@/lib/search/dossier-resumes';
import { lireVersionTextesAmendements } from '@/lib/search/amendement-textes';
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
      // Adoptés et rejetés par scrutin public (`sort`, LOI-85). Pour un adopté, où en est
      // le texte qui l'a reçu (`ensemble`, `ensemble_date`), par la lecture de l'amendement :
      //   - début : dernier dépôt de sa chambre (ou de CMP) au plus tard le jour de
      //     l'amendement ; fin : premier dépôt du texte, toutes chambres, après ce début ;
      //   - entre les deux, le vote de la chambre sur l'ensemble (`…-DEBATS-DEC`) donne
      //     'adopte' ou 'rejete' ; sans lui, 'sans_vote' si la lecture est close (un dépôt a
      //     suivi), sinon 'en_attente' ; NULL quand la lecture ou l'issue ne se lit pas.
      // Bornée par la lecture et non par la date de l'amendement : une séance qui déborde
      // après minuit date l'amendement du lendemain du vote (fauteuils roulants, vote du
      // 3 décembre 2024, amendement n° 25 daté du 4). `CMP-DEBATS-DEC` compte pour
      // l'Assemblée : la source y range parfois sa nouvelle lecture (loi PLM, 7 juillet
      // 2025). Dix cas témoins vérifiés le 2026-11-20 contre leur parcours.
      sql<AmendementMeta[]>`
        select a.uid, a.dossier_uid, a.numero, a.article, a.chambre, a.lieu, a.date_amendement as date,
          a.auteur_type, a.sort = 'adopte' as adopte,
          coalesce(nullif(trim(concat_ws(' ', ac.prenom, ac.nom)), ''), a.auteur_libelle) as auteur,
          e.d as ensemble_date,
          case
            when l.debut is null then null
            when e.d is not null and e.s ilike 'rejet%' then 'rejete'
            when e.d is not null and coalesce(e.s, '') <> '' then 'adopte'
            when e.d is not null then null
            when n.fin is not null then 'sans_vote'
            else 'en_attente'
          end as ensemble
        from amendements a
        join dossiers_legislatifs d on d.uid = a.dossier_uid and d.hors_liste = false
        left join acteurs ac on ac.uid = a.auteur_uid
        left join lateral (
          select max(x.date_acte::date) as debut from actes_legislatifs x
          where a.sort = 'adopte' and x.dossier_uid = a.dossier_uid and x.date_acte::date <= a.date_amendement
            and (x.code_acte = 'CMP-DEPOT'
              or x.code_acte ~ (case when a.chambre = 'AN' then '^AN[A-Z0-9]*-DEPOT$' else '^SN[A-Z0-9]*-DEPOT$' end))
        ) l on true
        left join lateral (
          select min(x.date_acte::date) as fin from actes_legislatifs x
          where l.debut is not null and x.dossier_uid = a.dossier_uid and x.code_acte like '%-DEPOT'
            and x.date_acte::date > l.debut
        ) n on true
        left join lateral (
          select x.date_acte::date as d, x.statut_conclusion as s from actes_legislatifs x
          where l.debut is not null and x.dossier_uid = a.dossier_uid and x.date_acte is not null
            and x.date_acte::date >= l.debut and (n.fin is null or x.date_acte::date <= n.fin)
            and (case when a.chambre = 'AN'
                      then x.code_acte ~ '^AN[A-Z0-9]*-DEBATS-DEC$' or x.code_acte in ('CMP-DEBATS-AN-DEC', 'CMP-DEBATS-DEC')
                      else x.code_acte ~ '^SN[A-Z0-9]*-DEBATS-DEC$' or x.code_acte = 'CMP-DEBATS-SN-DEC' end)
          order by x.date_acte, x.uid
          limit 1
        ) e on true
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

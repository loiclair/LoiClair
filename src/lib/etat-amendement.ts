// Où en est un amendement : le vote de sa chambre sur l'ensemble du texte, à la lecture où il a
// été adopté (LOI-85). Serveur uniquement : morceaux de SQL partagés par l'index de recherche
// (`api/search-index/amendements`, toutes les lignes) et la page d'un amendement
// (`lib/amendement-page.ts`, une ligne), pour que la ligne de recherche et la page disent la
// même chose. Les deux requêtes lisent `amendements a` joint à `dossiers_legislatifs d`.
//
// La règle :
//   - début de la lecture : dernier dépôt de la chambre de l'amendement (ou de CMP) au plus
//     tard le jour de l'amendement ; fin : premier dépôt du texte, toutes chambres, après ce
//     début (`lecture_suivie` : il y en a un, la navette a continué) ;
//   - entre les deux, le vote de la chambre sur l'ensemble (`…-DEBATS-DEC`) donne 'adopte'
//     ou 'rejete' ; sans lui, 'sans_vote' si la lecture est close, sinon 'en_attente' ;
//     NULL quand la lecture ou l'issue ne se lit pas.
// Bornée par la lecture et non par la date de l'amendement : une séance qui déborde après
// minuit date l'amendement du lendemain du vote (fauteuils roulants, vote du 3 décembre 2024,
// amendement n° 25 daté du 4). `CMP-DEBATS-DEC` compte pour l'Assemblée : la source y range
// parfois sa nouvelle lecture (loi PLM, 7 juillet 2025). Vérifiée le 2026-11-21 : contrôles
// sur les 29 484 adoptés listés à 0 (issue contredite par le scrutin cité, « en attente » sur
// texte fini, vote antérieur à l'amendement), 27 cas comparés aux sites des deux chambres.

import { sql } from '@/lib/db';

/** La colonne `ensemble`, à placer dans le `select`. Les jointures exposent aussi `e.d`, date
 *  du vote sur l'ensemble, et `n.fin`, non nul quand un dépôt a suivi la lecture (la navette
 *  a continué) : chaque requête choisit lesquels lire. */
export const COLONNE_ENSEMBLE = sql`
  case
    when l.debut is null then null
    -- Un vote antérieur de plus d'un jour à l'amendement dit une lecture mal bornée
    -- (dépôts absents de la source) : 151 amendements du PLFSS 2025, adoptés en
    -- commission le 29 janvier 2025, se seraient dits dans le texte voté le 4 décembre.
    when e.d is not null and e.d < a.date_amendement - 1 then null
    when e.d is not null and e.s ilike 'rejet%' then 'rejete'
    when e.d is not null and coalesce(e.s, '') <> '' then 'adopte'
    when e.d is not null then null
    -- Au Sénat, l'absence de vote ne prouve rien : la source (dump de l'Assemblée) n'a pas
    -- les votes des textes restés au Sénat. « Écosystèmes marins », rejeté par le Sénat le
    -- 12 juin 2025, s'arrête au rapport de commission ; un texte retiré en séance par son
    -- auteur n'y laisse aucune trace (vérifié le 2026-11-21 sur senat.fr). Seuls 'adopte'
    -- et 'rejete', lus dans un acte, s'y affichent.
    when a.chambre = 'SN' then null
    when n.fin is not null then 'sans_vote'
    -- Texte fini ou retiré sans vote retrouvé : « pas encore voté » serait faux, ou
    -- laisserait croire qu'il le sera (le vote manque parfois à la source : conclusions de
    -- CMP au Sénat ; « Protéger l'eau potable », retiré).
    when d.statut_final in ('Promulguée', 'Appliquée', 'Adopté par le Parlement', 'Retiré')
      or d.statut_final like 'Rejeté%' then null
    else 'en_attente'
  end as ensemble`;

/** Les trois jointures latérales que lit `COLONNE_ENSEMBLE`, à placer après les jointures de
 *  `a` et `d`. Un amendement rejeté par scrutin n'a pas d'état : sa page et sa ligne disent
 *  déjà qu'il ne figure dans aucun texte. */
export const JOINTURES_ETAT = sql`
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
  ) e on true`;

export type EtatEnsemble = 'adopte' | 'rejete' | 'sans_vote' | 'en_attente' | null;

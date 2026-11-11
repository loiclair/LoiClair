// Ce qu'une barre de vote a le droit de montrer, pour un scrutin donné.
//
// Deux endroits du site dessinent la même barre : la carte de décision de la fiche
// dossier (`ScrutinScore.tsx`, partagée avec le volet nominatif) et la carte du fil
// Actualité (`Month/MonthFeedClient.tsx`). Elles ont chacune leur habillage, mais
// doivent s'accorder sur les chiffres, sinon un même vote se lit différemment selon
// la page. Ce module porte cette règle ; les couleurs et les libellés restent chez
// l'appelant, qui a son propre namespace de traduction.
//
// Il dit aussi quel vote montrer quand une étape en porte plusieurs
// (`voteLePlusRecent`), règle partagée par la fiche, le fil et la newsletter, et si un
// scrutin porte sur une motion de procédure dont le sort n'est pas celui du texte
// (`estMotionProcedure`), règle partagée par la fiche et le fil.
//
// Il reconnaît une motion de rejet à son intitulé (`estMotionRejet`), pour qu'un
// vote « pour » la motion se lise comme un vote contre le texte.
//
// Enfin, il lit le sort d'un vote (`parseSortLibelle`) et la chambre d'un acte de décision
// (`deriveChambreKey`), règles partagées par la fiche d'un texte et la page d'un vote.
//
// Ce fichier n'importe rien : il est utilisable des deux côtés du rendu.

import { LEGAL_AN, LEGAL_SN } from '@/lib/parliament-constants';

/** Couleurs des positions de vote, communes à la barre, à la légende, aux pastilles
 *  nominatives, à l'hémicycle et à l'image de partage d'un vote. Une position garde la
 *  même teinte partout. */
export const SCRUTIN_COLORS = {
  pour: '#27AE60',
  contre: '#E74C3C',
  abstentions: '#A8A29E',
  nonVotants: '#F39C12',
  institutionnels: '#A8A29E',
  absents: '#8A827C',
} as const;

/** Segments possibles d'une barre de vote, dans leur ordre d'affichage. */
export type PositionScrutin =
  | 'pour'
  | 'contre'
  | 'abstentions'
  | 'nonVotants'
  | 'absents'
  | 'nonRecenses';

export type ChiffresScrutin = {
  /** `MOC`, `SPS`, `SPO` côté AN ; null côté Sénat, qui ne publie pas de type. */
  typeVoteCode: string | null;
  pour: number;
  contre: number;
  abstentions: number;
  nonVotants: number;
  /** Votants publiés par la chambre (pour + contre + abstentions). */
  votants: number;
  /** Seuil d'adoption publié, 0 quand la chambre n'en publie pas. */
  suffragesRequis: number;
  chambre: string | null;
};

export type SegmentScrutin = { cle: PositionScrutin; valeur: number };

/**
 * Le vote à montrer pour une étape qui en porte plusieurs : le plus récent.
 *
 * Lire le premier de `vote_refs` montrait un vote au hasard de l'ordre stocké, trié
 * comme du texte côté AN (`sorted` de l'import) et laissé dans l'ordre de la source côté
 * Sénat. La décision du
 * PLFSS 2027 (L17-VD234494DEC) porte V8707, motion de rejet du PLF citée par erreur
 * par l'AN, et V9097, le vrai vote du 23 octobre 2026 : trié, V8707 passait devant.
 * Au Sénat, la nouvelle lecture du PLFSS 2025 (L17-VD223916DEC) montrait le vote sur la
 * deuxième partie au lieu de celui sur l'ensemble, émis juste après. Le dernier vote
 * d'une étape est celui qui tranche : c'était le vote sur l'ensemble pour les quatre
 * décisions du Sénat à plusieurs votes de la base au 2026-10-27, comme pour le PLFSS 2027.
 *
 * Le numéro suffit, sans date : chaque chambre numérote ses scrutins dans l'ordre, par
 * législature à l'AN (`VTANR5L17V9097`), par session au Sénat (`VTSNR2024V195`). On
 * compare donc le préfixe (législature ou session), puis le numéro. Une référence d'une
 * autre forme passe derrière les autres ; si aucune n'a la forme attendue, la première
 * est rendue, comme avant.
 *
 * L'appelant ne passe que les références dont le scrutin est chargé : une référence
 * orpheline (préfixe `VTSNR` écrit par l'AN sur un numéro AN, scrutin d'avant la 17ᵉ)
 * pourrait sinon l'emporter et cacher le vote réel de l'étape.
 */
export function voteLePlusRecent(refs: readonly string[]): string | undefined {
  let meilleur: { ref: string; prefixe: string; numero: number } | undefined;
  for (const ref of refs) {
    const m = /^(.*)V(\d+)$/.exec(ref);
    if (!m) continue;
    const candidat = { ref, prefixe: m[1], numero: Number(m[2]) };
    if (
      !meilleur
      || candidat.prefixe > meilleur.prefixe
      || (candidat.prefixe === meilleur.prefixe && candidat.numero > meilleur.numero)
    ) {
      meilleur = candidat;
    }
  }
  return meilleur?.ref ?? refs[0];
}

/**
 * Vrai quand le scrutin porte sur une motion dont l'adoption rejette le texte : motion
 * de rejet préalable à l'Assemblée, question préalable au Sénat, exception
 * d'irrecevabilité. Voter « pour » une telle motion, c'est voter contre le texte.
 *
 * L'intitulé est le seul indice commun aux deux chambres : l'AN marque ses motions de
 * rejet `SPO`, comme bien d'autres scrutins, et le Sénat ne publie aucun type. Formes
 * constatées : « la motion de rejet préalable, déposée par… » (AN), « sur la motion
 * n° 2, … tendant à opposer la question préalable à… » (Sénat).
 *
 * La motion de renvoi en commission est exclue : l'adopter suspend l'examen sans
 * rejeter le texte. Le motif ne contient pas d'apostrophe, car le Sénat écrit parfois
 * la sienne `\u0092` au lieu de `'`.
 *
 * L'intitulé doit commencer par « la motion » ou « sur la motion » : il porte aussi le
 * nom du texte voté, et un vote sur l'ensemble d'un texte qui parlerait
 * d'« irrecevabilité » serait sinon pris pour une motion, Pour et Contre inversés. Au
 * 2026-11-03, les 67 intitulés de la base qui contiennent l'un des trois termes
 * commencent tous ainsi.
 */
export function estMotionRejet(titre: string | null | undefined): boolean {
  return !!titre
    && /^(la|sur la) motion/i.test(titre)
    && /motion de rejet|question pr[ée]alable|irrecevabilit/i.test(titre);
}

export type AffichageScrutin = {
  /** Effectif légal de la chambre : dénominateur de la barre. */
  total: number;
  /** Segments à dessiner, dans l'ordre. Le dernier est toujours le reste neutre. */
  segments: SegmentScrutin[];
  /** Position du repère de majorité en pourcentage de la barre, 0 s'il n'y en a pas. */
  majoritePct: number;
  /** Taux de participation en pourcentage, null quand il n'a pas de sens à afficher. */
  participationPct: number | null;
  /** Vrai pour une motion de censure : l'appelant ajoute la phrase d'explication. */
  estMotionCensure: boolean;
};

/**
 * Décide des segments, du repère de majorité et du taux de participation d'un scrutin.
 *
 * Cas général : pour / contre / abstentions / non-votants, le reste en absents.
 *
 * Motion de censure : l'article 49 de la Constitution ne fait recenser que les votes
 * favorables. Sur les 23 scrutins MOC de la 17ᵉ législature (mesuré au 2026-08-31),
 * `contre` et `abstentions` valent zéro sans exception, et les 246 à 469 députés que la
 * barre rangeait en « absents » n'étaient pas absents : leur position n'est pas
 * enregistrable. On ne garde donc que les voix favorables et le reste, libellé
 * « non recensés », sans taux de participation qui n'aurait rien mesuré.
 */
export function affichageScrutin(s: ChiffresScrutin): AffichageScrutin {
  const total = s.chambre === 'Sénat' ? LEGAL_SN : LEGAL_AN;
  const majoritePct = s.suffragesRequis > 0 ? (s.suffragesRequis / total) * 100 : 0;
  const estMotionCensure = s.typeVoteCode === 'MOC';

  if (estMotionCensure) {
    return {
      total,
      segments: [
        { cle: 'pour', valeur: s.pour },
        { cle: 'nonRecenses', valeur: Math.max(total - s.pour, 0) },
      ],
      majoritePct,
      participationPct: null,
      estMotionCensure,
    };
  }

  return {
    total,
    segments: [
      { cle: 'pour', valeur: s.pour },
      { cle: 'contre', valeur: s.contre },
      { cle: 'abstentions', valeur: s.abstentions },
      { cle: 'nonVotants', valeur: s.nonVotants },
      { cle: 'absents', valeur: Math.max(total - s.votants - s.nonVotants, 0) },
    ],
    majoritePct,
    participationPct: total > 0 ? Math.round((s.votants / total) * 100) : 0,
    estMotionCensure,
  };
}

/**
 * Le scrutin porte-t-il sur une motion de procédure plutôt que sur le texte ? Son sort est
 * alors celui de la motion : « l'Assemblée nationale a adopté » une motion de rejet veut
 * dire que le texte est rejeté. Appelée par la carte de décision du parcours
 * (`resume-ia/page.tsx`) et par le fil du mois (`Month/page.tsx`), qui lisent alors le
 * statut dans l'acte de décision et non dans le sort du scrutin.
 *
 * Assemblée : motion de rejet ou de renvoi, les motifs de `MOTION_PROCEDURE_PATTERNS`
 * (`import_actes_legislatifs_cloud.py`), qui relie ces motions aux actes de décision.
 * Sénat : question préalable et exception d'irrecevabilité, que `sync_senat.py` importe
 * quand elles sont adoptées. « irrecevabilit » sans apostrophe : le dump du Sénat la perd
 * parfois (« dirrecevabilité »). Au 2026-11-03, aucun scrutin lié à une décision ne cite
 * ces mots sans être une motion. Le renvoi en commission est compris : adopté, il ne rejette
 * pas le texte, mais son sort n'est pas davantage celui du texte.
 */
export function estMotionProcedure(titre: string | null | undefined): boolean {
  return /motion de (rejet|renvoi)|question préalable|irrecevabilit/i.test(titre ?? '');
}

/** Sort d'un vote ramené à « Adopté » ou « Rejeté », depuis `scrutins.sort_libelle` ou
 *  `actes_legislatifs.statut_conclusion` ; `null` quand le libellé ne dit ni l'un ni
 *  l'autre. La valeur rendue est française : elle choisit la couleur du badge
 *  (`getStatusBadgeClass`), et l'appelant la traduit pour l'affichage. */
export function parseSortLibelle(sortLibelle: string | null): string | null {
  if (!sortLibelle) return null;
  const l = sortLibelle.toLowerCase();
  if (l.includes('rejet') || l.includes("n'a pas adopt") || l.includes('pas adopté')) return 'Rejeté';
  if (l.includes('adopt')) return 'Adopté';
  return null;
}

/** Chambre d'un acte de décision, lue dans son `code_acte`. Un vote en séance sur les
 *  conclusions d'une CMP (`CMP-DEBATS-AN-…`, `CMP-DEBATS-SN-…`) appartient à la chambre
 *  qui vote, pas à la CMP. */
export function deriveChambreKey(code: string): 'AN' | 'SEN' | 'CMP' | 'CC' | null {
  if (code === 'CC-CONCLUSION') return 'CC';
  if (code.startsWith('CMP-DEBATS-AN')) return 'AN';
  if (code.startsWith('CMP-DEBATS-SN')) return 'SEN';
  if (code.startsWith('CMP')) return 'CMP';
  if (code.startsWith('AN')) return 'AN';
  if (code.startsWith('SN')) return 'SEN';
  return null;
}

/** Statut d'un vote (« Adopté », « Rejeté » ou le libellé de l'acte) : la même règle que
 *  la carte de décision de la fiche du texte (`resume-ia/page.tsx`). Une motion de
 *  procédure a pour sort celui de la motion : quand un acte de décision cite le vote, le
 *  statut se lit alors dans l'acte. Lu par la page d'un vote et son image de partage. */
export function statutDuVote(titre: string | null, sortLibelle: string | null, statutActe: string | null, aUnActe: boolean): string | null {
  return (estMotionProcedure(titre) && aUnActe ? null : parseSortLibelle(sortLibelle))
    ?? parseSortLibelle(statutActe)
    ?? statutActe
    ?? null;
}

/**
 * Page officielle d'un scrutin, reconstruite depuis l'uid : ni l'AN ni le Sénat ne publient
 * cette URL dans leurs données, mais toutes deux la dérivent de la même façon.
 *   VTANR5L17V2107 → assemblee-nationale.fr/dyn/17/scrutins/2107
 *   VTSNR2019V19   → senat.fr/scrutin-public/2019/scr2019-19.html
 * Les deux motifs couvrent les 479 scrutins rattachés à un acte de décision, sans reste.
 * Attention à ne pas lire la législature dans la colonne `legislature` pour le Sénat : elle
 * y porte la législature de l'Assemblée, pas l'année de session. Lue par le tiroir d'un vote
 * et l'en-tête de sa page.
 */
export function urlScrutinOfficiel(uid: string): string | null {
  const an = /^VTANR5L(\d+)V(\d+)$/.exec(uid);
  if (an) return `https://www.assemblee-nationale.fr/dyn/${an[1]}/scrutins/${an[2]}`;
  const sn = /^VTSNR(\d{4})V(\d+)$/.exec(uid);
  if (sn) return `https://www.senat.fr/scrutin-public/${sn[1]}/scr${sn[1]}-${sn[2]}.html`;
  return null;
}

// src/lib/ce-qui-me-concerne.ts
// Lectures serveur de « Ce qui me concerne » : l'index des profils par dossier, que la
// page embarque, et le contenu des dossiers par blocs fixes, que sert
// `/api/ce-qui-me-concerne/tout`. Le classement est fait à l'avance par
// `pipeline/classer_articles.py` ; la vue `impacts_courants` en donne l'état en
// cours, une ligne par (élément, profil).
//
// Promesse de LoiClair : rien de ce qui part vers le serveur ne dit ce que le lecteur
// est ni ce qu'il cherche (D-243). L'index porte tous les profils, et le navigateur
// charge tous les blocs, les mêmes pour tout le monde, avec les phrases de tous les
// profils : tri, filtres et recherche se font chez lui. Charger seulement les dossiers
// affichés trahissait les profils cochés, la liste en découlant.
//
// Rangement d'un texte en discussion : un amendement qui modifie un article
// (« Art. 7 ») est rattaché à cet article (`sous`), et le client l'affiche en retrait
// sous lui quand l'article concerne aussi le profil, seul sinon ; un amendement qui
// ajoute un article (« Après art. 7 ») est un « nouvel article proposé », au niveau
// des articles, sans lien avec l'article 7 autre que sa place dans le texte.

import { getTranslations } from 'next-intl/server';
import { sql } from '@/lib/db';
import { amendementsAvecVote } from '@/lib/scrutin-votes';
import { translateStatut, statutBulletColor } from '@/lib/statut';
import { dateTexte } from '@/lib/texte-date';
import { titreDossier, titreTraduit } from '@/lib/titre-dossier';

/** Un amendement adopté, avec la phrase neutre qui dit ce qu'il change. */
export type AmendementLie = {
  uid: string;
  numero: string;
  lieu: 'seance' | 'commission';
  chambre: 'AN' | 'SN';
  url: string;
  /** Null tant que `classer_articles.py` ne l'a pas classé. */
  resume: string | null;
  /** Vrai quand un vote public y est relié, dit sur la ligne de la liste. */
  avecVote?: boolean;
};

/** Qui a proposé un amendement. Le tiroir le reçoit sous la forme d'`AuteurElement`,
 *  qui en reprend les types et étend l'élu en `EluContactable`. `elu` est rempli pour
 *  un député ou un sénateur présent dans `acteurs` ; sinon `libelle` (nom d'une
 *  commission, nom brut d'un sénateur inconnu), ou rien pour le Gouvernement.
 *  `AuteurAmendements` (section « Modifications du texte » de la fiche d'un texte) l'étend : un
 *  nouveau type d'auteur s'ajoute ici, pour les deux. `ancien` (voir `estAncienElu`)
 *  grise sa photo ; sur la fiche du texte, il passe aussi son badge au passé, accordé
 *  par `civ` (« Ancienne députée »). */
export type AuteurAmendement = {
  type: 'parlementaire' | 'rapporteur' | 'commission' | 'gouvernement';
  elu: { uid: string; prenom: string | null; nom: string | null; civ: string | null; url_profil_officiel: string | null; groupe: string | null; ancien: boolean } | null;
  libelle: string | null;
};

/** Un élu qu'on peut joindre depuis le tiroir : l'élu d'`AuteurAmendement`, plus de quoi
 *  préparer un courriel (`buildMailto`) ou, sans adresse, ses réseaux. `chambre` est
 *  celle de son mandat en cours (« Monsieur le Député »), null pour un ancien élu, dont
 *  la route vide alors adresse et réseaux (on ne le joint plus par le site). */
export type EluContactable = NonNullable<AuteurAmendement['elu']> & {
  email: string | null;
  twitter_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  linkedin_url: string | null;
  chambre: 'AN' | 'SN' | null;
};

/** Qui écrire à propos d'un élément, rendu par `/api/ce-qui-me-concerne/element`.
 *  Amendement : son auteur (types d'`AuteurAmendement`, `elus` d'au plus un élu).
 *  Article : l'élu qui a déposé le texte (`initiateur`) ; pour un texte du Gouvernement,
 *  `gouvernement` et ses rapporteurs dans `elus`, au plus un par chambre. */
export type AuteurElement = {
  type: AuteurAmendement['type'] | 'initiateur';
  elus: EluContactable[];
  libelle: string | null;
};

export type ElementConcerne = {
  id: string;
  /** « Art. 12 bis », ou « Amendement n° 42 (Après art. 4) ». */
  libelle: string;
  rang: number;
  /** De quoi charger le détail de l'élément quand son tiroir s'ouvre (texte, passages
   *  cités, amendements de l'article) : `/api/ce-qui-me-concerne/element`. */
  source: { texte: string; ordre: number; loi: boolean } | { amendement: string };
  /** L'amendement lui-même, quand l'élément en est un. */
  propre: AmendementLie | null;
  /** Jour civil (AAAA-MM-JJ) affiché sur la ligne, formaté par le client selon la
   *  langue. Un article porte la date de sa version du texte (`dateTexte`, celle que
   *  la fiche dossier affiche pour cette version) ; pour une loi, sa publication au
   *  Journal officiel. Un amendement porte `date_amendement`, qui n'a pas le même
   *  sens selon la chambre : date du sort à l'Assemblée, du dépôt au Sénat (seule
   *  date de son dump). D'où une date seule sur la ligne, sans verbe. Null quand la
   *  source n'en donne pas. */
  date: string | null;
  /** Vide quand l'élément ne concerne aucun profil : un article peut n'apparaître
   *  que pour porter un amendement qui, lui, concerne le lecteur. La phrase d'un
   *  amendement est vide : son résumé, le même pour tous, est dans `propre`. */
  impacts: { profil: string; phrase: string }[];
  /** Amendements classés qui modifient cet article, affichés sous lui. */
  sous: ElementConcerne[];
};

export type DossierConcerne = {
  uid: string;
  /** Titre affiché : sur /en, sa traduction par l'IA quand elle existe (`lib/titre-dossier.ts`). */
  titre: string;
  /** Titre officiel français, présent seulement quand `titre` en est la traduction :
   *  la recherche cherche dans les deux, et le courriel aux élus garde celui-ci. */
  titreOfficiel?: string;
  statut: string;
  /** Date de promulgation, déjà formatée : celle de la parution au Journal officiel,
   *  comme la frise de la fiche ; null pour un texte en discussion. */
  date: string | null;
  couleurStatut: string;
  /** Le statut brut, qui choisit la couleur de la pastille du tiroir. */
  statutFinal: string | null;
  /** Vrai pour le budget (PLF, PLFSS, PLFR) : ses amendements de commission sont
   *  revotés en séance (art. 42 de la Constitution), ce que dit leur note. */
  budget: boolean;
  elements: ElementConcerne[];
};

/** Les trois statuts que distingue le lecteur : pas encore voté, adopté par au moins
 *  une chambre, promulgué (ou déjà appliqué). */
export type Etat = 'aVoter' | 'adopte' | 'promulgue';

/** Statut en base → groupe du filtre de statut. « Publié » et les rejets (« Rejeté »,
 *  « Rejeté par le Sénat »…) n'entrent dans aucun des trois et ne sortent que sous
 *  « Tous ». */
export function etatDe(statut: string | null): Etat | null {
  if (statut === 'Déposé - pas encore voté') return 'aVoter';
  if (statut === 'Promulguée' || statut === 'Appliquée') return 'promulgue';
  if (statut?.startsWith('Adopté')) return 'adopte';
  return null;
}

export const PROCEDURES_BUDGET = new Set([
  "Projet de loi de finances de l'année",
  'Projet de loi de financement de la sécurité sociale',
  'Projet de loi de finances rectificative',
]);

type LigneCourante = {
  element_type: 'article' | 'amendement';
  element_id: string;
  dossier_uid: string;
  profil: string;
  phrase_fr: string | null;
  phrase_en: string | null;
};
type LigneAmendement = {
  uid: string;
  dossier_uid: string;
  numero: string;
  article: string | null;
  lieu: 'seance' | 'commission';
  chambre: 'AN' | 'SN';
  url: string;
  date_amendement: string | null;
};

/** Un texte publié au Journal officiel : son uid Légifrance commence par « LOI ». Ses
 *  amendements sont déjà dedans, et son article se nomme sans « texte en discussion ». */
export function estLoiPubliee(texteUid: string): boolean {
  return texteUid.startsWith('LOI');
}

/** Le résumé du classement le plus récent de chaque amendement classé, par uid, lu
 *  par dossier (`assemblerDossiers`) ou par amendement (le tiroir). Seuls les
 *  amendements classés y figurent : `classer_articles.py` a déjà écarté ceux de
 *  l'autre chambre et les doublons. */
export async function resumesAmendements(par: 'dossier_uid' | 'element_id', valeurs: string[], en: boolean): Promise<Map<string, string | null>> {
  // `par` vient d'une liste fermée de deux noms de colonne, que `sql(par)` cite.
  const lignes = await sql<{ element_id: string; resume_fr: string | null; resume_en: string | null }[]>`
    select element_id, resume_fr, resume_en
    from impacts
    where element_type = 'amendement' and modele = 'claude-haiku-5-5' and ${sql(par)} = any(${valeurs})
    order by element_id, created_at, prompt_version`;
  // Le plus récent l'emporte : le dernier de l'ordre de tri.
  return new Map(lignes.map((r) => [r.element_id, en ? r.resume_en : r.resume_fr]));
}

/** Les profils touchés par dossier, selon le classement en cours : de tout le
 *  classement pour l'index, ou des seuls `dossiers` donnés pour la lettre du lundi,
 *  qui ne lit que les textes de sa semaine. */
export async function profilsParDossier(dossiers?: string[]): Promise<Map<string, string[]>> {
  const lignes = await sql<{ dossier_uid: string; profil: string }[]>`
    select dossier_uid, profil
    from impacts_profils_dossiers
    ${dossiers ? sql`where dossier_uid = any(${dossiers})` : sql``}
    order by dossier_uid, profil`;
  const m = new Map<string, string[]>();
  for (const l of lignes) m.set(l.dossier_uid, [...(m.get(l.dossier_uid) ?? []), l.profil]);
  return m;
}

/** Dossiers par bloc de `/api/ce-qui-me-concerne/tout`. Un bloc de 500 pèse environ
 *  1 Mo brut (4,15 Mo pour les 1 928 dossiers classés au 2026-10-17). Le client
 *  charge tous les blocs. */
export const DOSSIERS_PAR_BLOC = 500;

/** Le bloc `k` : les dossiers classés rangés par uid, du `k × 500`-ième au suivant.
 *  Le découpage ne dépend que du classement, jamais du lecteur. Un seul appel à
 *  `assemblerDossiers` pour tout le bloc : chaque élément y est rangé par des clés
 *  propres à son dossier (article par `texte_uid#ordre`, clé primaire de
 *  `texte_articles` ; amendement par uid ; aucun élément de `impacts_courants` sur
 *  deux dossiers au 2026-11-05), donc le résultat est celui des anciens lots de 100. */
export async function assemblerBloc(k: number, locale: string): Promise<DossierConcerne[]> {
  const uids = [...(await profilsParDossier()).keys()].sort()
    .slice(k * DOSSIERS_PAR_BLOC, (k + 1) * DOSSIERS_PAR_BLOC);
  return uids.length ? assemblerDossiers(uids, locale) : [];
}

/** Le contenu de quelques dossiers, dans la langue de la page, pour tous les profils.
 *  L'ordre rendu suit `uids`. */
export async function assemblerDossiers(uids: string[], locale: string): Promise<DossierConcerne[]> {
  const en = locale === 'en';
  const t = await getTranslations({ locale, namespace: 'ceQuiMeConcerne' });
  const tDossiers = await getTranslations({ locale, namespace: 'dossiers' });

  type LigneDossier = {
    uid: string; titre: string | null; titre_en: string | null; statut_final: string | null; date_promulgation: string | null; procedure_libelle: string | null;
  };
  const [courantes, resumeDe, articles, amendements, dossiers, lois] = await Promise.all([
    sql<LigneCourante[]>`
      select element_type, element_id, dossier_uid, profil, phrase_fr, phrase_en
      from impacts_courants
      where dossier_uid = any(${uids})
      order by element_type, element_id, profil`,
    // Le résumé de chaque amendement classé : il tient lieu de phrase pour tous ses
    // profils, et seuls les amendements classés sont montrés.
    resumesAmendements('dossier_uid', uids, en),
    sql<{ texte_uid: string; dossier_uid: string; ordre: number; numero: string }[]>`
      select texte_uid, dossier_uid, ordre, numero
      from texte_articles
      where dossier_uid = any(${uids})
      order by texte_uid, ordre`,
    sql<LigneAmendement[]>`
      select uid, dossier_uid, numero, article, lieu, chambre, url, date_amendement
      from amendements
      where dossier_uid = any(${uids})
      order by uid`,
    sql<LigneDossier[]>`
      select uid, titre, titre_en, statut_final, date_promulgation, procedure_libelle
      from dossiers_legislatifs
      where uid = any(${uids})`,
    // La loi parue au Journal officiel, hors version consolidée : sa date est celle que
    // la frise de la fiche donne à la promulgation (voir `dateJO` dans resume-ia/page.tsx).
    // Les deux lectures concordent sur les 152 lois au 2026-10-29.
    sql<{ dossier_ref: string; date_publication: string | null }[]>`
      select dossier_ref, date_publication
      from textes
      where dossier_ref = any(${uids}) and uid like 'LOI%' and not (is_version_consolidee is true)`,
  ]);

  // La date de chaque version d'où viennent les articles : une ligne par version, lue
  // après les articles (elle dépend de leurs `texte_uid`) plutôt qu'embarquée dans
  // leur requête, qui la répéterait sur chaque article.
  const texteUids = [...new Set(articles.map((a) => a.texte_uid))];
  const classes = new Set(resumeDe.keys());
  const retenus = amendements.filter((a) => classes.has(a.uid));
  // Les votes publics des amendements retenus se lisent en même temps que les versions :
  // deux lectures indépendantes.
  const [versions, avecVote] = await Promise.all([
    texteUids.length
      ? sql<{ uid: string; date_creation: string | null; date_publication: string | null; date_depot: string | null }[]>`
          select uid, date_creation, date_publication, date_depot from textes where uid = any(${texteUids})`
      : Promise.resolve([]),
    amendementsAvecVote(retenus.map((a) => a.uid)),
  ]);
  // Ces colonnes sont des horodatages sans fuseau (« 2026-10-14T00:00:00 ») : les
  // dix premiers caractères sont déjà le jour, sans conversion.
  const dateVersion = new Map(versions.map((v) => [v.uid, dateTexte(v)?.slice(0, 10) ?? null]));

  // La première version par uid, comme `charger_versions` de `classer_articles.py`
  // (DISTINCT ON … ORDER BY texte_uid) : si deux versions coexistent (une passe de
  // `decouper_textes.py` coupée avant sa purge), les amendements se rangent sous celle
  // qui a servi à les classer.
  const texteDuDossier = new Map<string, string>();
  for (const a of articles) if (!texteDuDossier.has(a.dossier_uid)) texteDuDossier.set(a.dossier_uid, a.texte_uid);
  const articleParCle = new Map(articles.map((a) => [`${a.texte_uid}#${a.ordre}`, a]));
  const articleParNumero = new Map(articles.map((a) => [`${a.texte_uid}|${a.numero}`, a]));
  const parUid = new Map(retenus.map((a) => [a.uid, a]));

  const versAmendementLie = (a: LigneAmendement): AmendementLie => (
    { uid: a.uid, numero: a.numero, lieu: a.lieu, chambre: a.chambre, url: a.url, resume: resumeDe.get(a.uid) ?? null, ...(avecVote.has(a.uid) && { avecVote: true }) });

  // Les profils d'un élément, avec leur phrase (vide pour un amendement).
  const impactsDe = new Map<string, { profil: string; phrase: string }[]>();
  for (const l of courantes) {
    const cle = `${l.element_type}:${l.element_id}`;
    const phrase = (en ? l.phrase_en : l.phrase_fr) ?? '';
    impactsDe.set(cle, [...(impactsDe.get(cle) ?? []), { profil: l.profil, phrase }]);
  }

  const elementArticle = (a: { texte_uid: string; ordre: number; numero: string }): ElementConcerne => ({
    id: `article:${a.texte_uid}#${a.ordre}`,
    libelle: a.numero,
    rang: a.ordre,
    source: { texte: a.texte_uid, ordre: a.ordre, loi: estLoiPubliee(a.texte_uid) },
    propre: null,
    date: dateVersion.get(a.texte_uid) ?? null,
    impacts: impactsDe.get(`article:${a.texte_uid}#${a.ordre}`) ?? [],
    sous: [],
  });

  // Par dossier : les articles (par clé `texte#ordre`) et les éléments de premier niveau.
  const parDossier = new Map<string, Map<string, ElementConcerne>>();
  const niveau = (d: string) => parDossier.get(d) ?? parDossier.set(d, new Map()).get(d)!;
  for (const l of courantes) {
    if (l.element_type !== 'article' || niveau(l.dossier_uid).has(l.element_id)) continue;
    const a = articleParCle.get(l.element_id);
    if (a) niveau(l.dossier_uid).set(l.element_id, elementArticle(a));
  }
  for (const uid of new Set(courantes.filter((l) => l.element_type === 'amendement').map((l) => l.element_id))) {
    const a = parUid.get(uid);
    const texteUid = a && texteDuDossier.get(a.dossier_uid);
    if (!a || !texteUid) continue;
    const element: ElementConcerne = {
      id: `amendement:${a.uid}`,
      libelle: t('amendementNumero', { numero: a.numero }),
      rang: 0,
      source: { amendement: a.uid },
      propre: versAmendementLie(a),
      date: a.date_amendement,
      impacts: impactsDe.get(`amendement:${a.uid}`) ?? [],
      sous: [],
    };
    const vise = a.article ? articleParNumero.get(`${texteUid}|${a.article}`) : undefined;
    if (vise) {
      // Il modifie un article : sous cet article, qui s'affiche même sans profil.
      const cle = `${texteUid}#${vise.ordre}`;
      const parent = niveau(a.dossier_uid).get(cle) ?? elementArticle(vise);
      parent.sous.push(element);
      niveau(a.dossier_uid).set(cle, parent);
      continue;
    }
    // Il ajoute un article : rangé juste après (ou avant) celui qu'il suit.
    const m = a.article?.match(/^(Après|Avant) (art\..*)$/i);
    const suivi = m ? articleParNumero.get(`${texteUid}|${m[2].replace(/^art\./i, 'Art.')}`) : undefined;
    element.libelle = suivi
      // « après l'art. 7 » : en milieu de phrase, l'abréviation perd sa capitale.
      ? t(m![1].toLowerCase() === 'après' ? 'nouvelArticleApres' : 'nouvelArticleAvant', { article: suivi.numero.replace(/^Art\./, 'art.') })
      : t('amendement', { numero: a.numero, article: a.article ?? '' });
    element.rang = suivi ? suivi.ordre + (m![1].toLowerCase() === 'après' ? 0.5 : -0.5) : 100_000;
    niveau(a.dossier_uid).set(element.id, element);
  }

  const parUidDossier = new Map(dossiers.map((d) => [d.uid, d]));
  // Parution au Journal officiel par dossier. `date_promulgation` porte la signature,
  // un à deux jours plus tôt : elle ne sert plus que de repli (choix d'Alex, 2026-10-29,
  // pour que la fiche ne montre qu'une date). Si un dossier portait plusieurs lois, la
  // plus ancienne l'emporte, quel que soit l'ordre des lignes (aucun cas au 2026-10-29).
  const dateJO = new Map<string, string>();
  for (const l of lois) {
    const deja = dateJO.get(l.dossier_ref);
    if (l.date_publication && (!deja || l.date_publication < deja)) dateJO.set(l.dossier_ref, l.date_publication);
  }
  const formatDate = new Intl.DateTimeFormat(en ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return uids.flatMap((uid) => {
    const d = parUidDossier.get(uid);
    if (!d) return [];
    return [{
      uid: d.uid,
      titre: titreDossier(d, locale) || d.uid,
      ...(titreTraduit(d, locale) && d.titre ? { titreOfficiel: d.titre } : {}),
      statut: translateStatut(d.statut_final, tDossiers),
      date: d.date_promulgation ? formatDate.format(new Date(dateJO.get(d.uid) ?? d.date_promulgation)) : null,
      couleurStatut: statutBulletColor(d.statut_final),
      statutFinal: d.statut_final,
      budget: PROCEDURES_BUDGET.has(d.procedure_libelle ?? ''),
      elements: [...(parDossier.get(d.uid)?.values() ?? [])]
        .map((e) => ({ ...e, sous: e.sous.sort((x, y) => x.id.localeCompare(y.id)) }))
        .sort((a, b) => a.rang - b.rang || a.id.localeCompare(b.id)),
    }];
  });
}

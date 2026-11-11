// Détail d'un élément de « Ce qui me concerne », chargé quand le lecteur ouvre son
// tiroir : le texte (contenu d'un article de `texte_articles`, ou dispositif d'un
// amendement adopté), le passage cité pour chaque profil, et pour un article de texte
// en discussion, les amendements classés qui le modifient. À la demande plutôt que
// dans la liste : un article du budget dépasse parfois 200 000 caractères (les états
// annexés), et la liste des amendements du budget pesait 68 Ko à elle seule.
//
// Les passages viennent pour tous les profils de l'élément : la requête ne dit rien de
// ce que le lecteur a coché (voir `src/lib/ce-qui-me-concerne.ts`).
//
//   GET /api/ce-qui-me-concerne/element?texte=PRJLANR5L17B3210&ordre=8&locale=fr
//   GET /api/ce-qui-me-concerne/element?amendement=AMANR5L17PO59048B3210P1D1N001588&locale=fr
// `sans_texte=1` (article résumé, dont le tiroir ne montre que le lien source) : `texte`
// part à `null`, sauf quand l'article n'a pas de lien source, le texte restant alors le
// seul accès. Pour un amendement, `texte` part toujours à `null` : `fiche` porte son
// dispositif.
// Réponse : { texte: string | null, passages: Record<profil, passage>, amendements: AmendementLie[],
// auteur: AuteurElement | null, fiche: DetailAmendement | null, source: string | null } (`auteur` : à qui écrire,
// l'auteur d'un amendement ou celui qui a déposé le texte d'un article, voir
// `AuteurElement` ; `fiche` : pour un amendement, ce que montrent sa page et ses tiroirs ;
// `source` : pour un article, l'adresse officielle de son texte) ;
// une erreur rend un code (voir CLAUDE.md, pas de phrase). L'auteur ne dépend que de
// l'élément : les élus du lecteur ne quittent jamais son navigateur (D-243).

import { NextRequest, NextResponse } from 'next/server';
import { routing } from '@/i18n/routing';
import { sql, auPlusUneLigne } from '@/lib/db';
import { chargerDetailAmendement, lireAmendement, type DetailAmendement } from '@/lib/amendement-page';
import { elusContactables } from '@/lib/auteur-amendement';
import { estLoiPubliee, resumesAmendements, type AmendementLie, type AuteurElement } from '@/lib/ce-qui-me-concerne';
import { estUidAmendement } from '@/lib/uid-fiches';
import { estOrigineGouvernementale } from '@/lib/origine-gouvernementale';
import { elementRateLimit, getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// Valider la forme des identifiants borne ce qui atteint la base sur une route
// publique en lecture seule, comme `/api/scrutin-votes`.
const TEXTE_UID = /^[A-Z0-9-]{4,40}$/;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const texte = p.get('texte');
  const ordre = Number(p.get('ordre'));
  const amendement = p.get('amendement');
  const sansTexte = p.get('sans_texte') === '1';
  const locale = p.get('locale') ?? '';
  const en = locale === 'en';
  if (!(routing.locales as readonly string[]).includes(locale)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  // Voir `elementRateLimit` : `v` rend chaque adresse neuve pour le CDN. Redis en
  // panne laisse passer : la limite protège la base, elle ne doit pas fermer les
  // tiroirs du site quand la base va bien.
  try {
    const { success } = await elementRateLimit.limit(getClientIp(req));
    if (!success) return NextResponse.json({ error: 'rate_limit' }, { status: 429 });
  } catch (e) {
    console.error('[ce-qui-me-concerne/element] limite non lue :', e);
  }

  try {
    let contenu: string | null = null;
    let elementId: string;
    let elementType: 'article' | 'amendement';
    // Les amendements liés partent avec les passages et l'auteur, pas avant eux : ce
    // sont trois lectures indépendantes, une fois l'existence de l'élément vérifiée.
    let liesP: Promise<AmendementLie[]> = Promise.resolve([]);
    // L'auteur se lit en même temps que les passages, une fois l'existence de l'élément
    // vérifiée : la fiche d'un amendement le porte, l'article a son dossier.
    let ficheP: Promise<DetailAmendement> | null = null;
    let dossierArticle: string | null = null;
    if (texte && TEXTE_UID.test(texte) && Number.isInteger(ordre) && ordre > 0 && ordre < 10_000) {
      elementId = `${texte}#${ordre}`;
      elementType = 'article';
      const data = await auPlusUneLigne(sql<{ contenu: string | null; numero: string; dossier_uid: string }[]>`
        select contenu, numero, dossier_uid from texte_articles
        where texte_uid = ${texte} and ordre = ${ordre}`, 'texte_articles');
      contenu = data?.contenu ?? null;
      dossierArticle = data?.dossier_uid ?? null;
      // Une loi publiée contient déjà ses amendements : aucun n'est classé pour elle.
      // `contenu` d'abord : sans lui la route rend 404 sans attendre la promesse, dont
      // un rejet ne serait alors rattrapé par personne.
      if (data?.contenu && !estLoiPubliee(texte)) liesP = amendementsDe(data.dossier_uid, data.numero, texte, en);
    } else if (amendement && estUidAmendement(amendement)) {
      elementId = amendement;
      elementType = 'amendement';
      const data = await lireAmendement(amendement);
      contenu = data?.dispositif ?? null;
      // Après la vérification de `contenu`, comme `liesP` : un 404 sans attendre la promesse
      // laisserait son rejet rattrapé par personne.
      if (data?.dispositif) ficheP = chargerDetailAmendement(data, locale);
    } else {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    if (!contenu) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    // Le type avec l'identifiant : ce sont les deux premières colonnes de la clé primaire
    // d'`impacts`. Sans le type, Postgres parcourait tout l'index (251 ms contre 0,1 ms,
    // mesuré le 2026-10-17).
    // Un profil par ligne : (element_type, element_id, profil) est unique dans la vue.
    const [lignes, auteur, lies, fiche, ligneTexte] = await Promise.all([
      sql<{ profil: string; passage: string | null }[]>`
        select profil, passage from impacts_courants
        where element_type = ${elementType} and element_id = ${elementId}
        order by profil`,
      ficheP ? ficheP.then((f) => f.auteur) : dossierArticle ? auteurArticle(dossierArticle) : null,
      liesP,
      ficheP,
      elementType === 'article' ? auPlusUneLigne(sql<{ lien_texte: string | null; url_accessible: boolean | null }[]>`
        select lien_texte, url_accessible from textes where uid = ${texte}`, 'textes (source)') : null,
    ]);
    // `url_accessible` à faux : l'import a trouvé ce lien mort, on ne l'envoie pas au lecteur.
    const source = ligneTexte?.lien_texte && ligneTexte.url_accessible !== false ? ligneTexte.lien_texte : null;
    const passages = Object.fromEntries(lignes.map((l) => [l.profil, l.passage ?? '']));

    // Un amendement part sans `texte` : son dispositif est déjà dans `fiche`, et le tiroir
    // ne lit que celle-ci (jusqu'à 60 000 caractères envoyés deux fois sinon).
    const sansDoublon = elementType === 'amendement' || (sansTexte && source);
    return reponse({ texte: sansDoublon ? null : contenu, passages, amendements: lies, auteur, fiche, source });
  } catch (e) {
    console.error('[ce-qui-me-concerne/element]', e);
    return NextResponse.json({ error: 'db_unavailable' }, { status: 503 });
  }
}

/** La réponse, gardée une journée par le CDN : elle est la même pour tous. */
function reponse(corps: { texte: string | null; passages: Record<string, string>; amendements: AmendementLie[]; auteur: AuteurElement | null; fiche: DetailAmendement | null; source: string | null }) {
  const res = NextResponse.json(corps);
  res.headers.set('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=86400');
  return res;
}

/** Rapporteurs nommés pour un article d'un texte du Gouvernement : un par chambre, le
 *  premier à l'Assemblée puis le premier au Sénat. Un budget en compte jusqu'à 171
 *  (mesuré le 2026-10-19) : la liste entière ne dirait plus à qui écrire. */
const CHAMBRES_RAPPORTEURS = ['AN', 'SN'] as const;

/** Qui a déposé le texte d'un article : l'initiateur du dossier, ou pour un texte du
 *  Gouvernement, qu'on ne joint pas par courriel, ses rapporteurs. Un initiateur absent
 *  d'`acteurs` (ou jamais renseigné) se remplace par le premier auteur du premier texte
 *  déposé, le repli de l'en-tête de la fiche du texte (`loadAuteurFallback`) : au
 *  2026-10-19, il couvrait les deux propositions de loi découpées sans initiateur
 *  connu, et l'article a ainsi toujours un auteur à la place de son squelette. Les
 *  rapporteurs se lisent
 *  dans les `rapporteurs_refs` des textes du dossier, du premier déposé au dernier ;
 *  la chambre du rapporteur est celle du texte, lue dans son uid (`PIONANR5…`,
 *  `RAPPSNR5…`), comme dans « Sources et acteurs » de la fiche du texte. */
async function auteurArticle(dossier: string): Promise<AuteurElement | null> {
  const d = await auPlusUneLigne(sql<{
    initiateur_acteur_ref: string | null;
    initiateur_groupe_libelle: string | null;
    textes_associes_refs: string[] | null;
  }[]>`
    select initiateur_acteur_ref, initiateur_groupe_libelle, textes_associes_refs
    from dossiers_legislatifs where uid = ${dossier}`, 'dossiers_legislatifs');
  if (!d) return null;
  if (!estOrigineGouvernementale(d.textes_associes_refs, d.initiateur_groupe_libelle)) {
    let elus = d.initiateur_acteur_ref ? await elusContactables([d.initiateur_acteur_ref]) : [];
    if (!elus.length) {
      // Une seule ligne : le premier texte du dossier qui nomme ses auteurs.
      const t = await auPlusUneLigne(sql<{ auteurs_refs: string[] | null }[]>`
        select auteurs_refs from textes
        where dossier_ref = ${dossier} and auteurs_refs is not null
        order by date_depot asc nulls last, uid
        limit 1`, 'textes');
      const ref = t?.auteurs_refs?.[0];
      if (ref) elus = await elusContactables([ref]);
    }
    return elus.length ? { type: 'initiateur', elus, libelle: null } : null;
  }
  // Une ligne par texte du dossier qui nomme des rapporteurs : 79 au plus (les budgets,
  // mesuré le 2026-10-19).
  const textes = await sql<{ uid: string; rapporteurs_refs: string[] | null }[]>`
    select uid, rapporteurs_refs from textes
    where dossier_ref = ${dossier} and rapporteurs_refs is not null
    order by date_depot asc nulls last, uid`;
  const premiers = new Map<string, string>();
  for (const t of textes) {
    const chambre = t.uid.match(/^[A-Z]+?(AN|SN)R\d/)?.[1];
    const ref = t.rapporteurs_refs?.[0];
    if (chambre && ref && !premiers.has(chambre)) premiers.set(chambre, ref);
  }
  const refs = CHAMBRES_RAPPORTEURS.flatMap((c) => premiers.get(c) ?? []);
  // `elusContactables` rend une ligne par uid demandé : dédoublonné, un même élu
  // rapporteur dans les deux chambres ne fait qu'une ligne.
  return { type: 'gouvernement', elus: refs.length ? await elusContactables([...new Set(refs)]) : [], libelle: null };
}

/** Les amendements adoptés sur l'article de la version `texte`, dans la chambre qui
 *  l'examine, avec leur résumé quand il existe. Tous partent, classés ou non : le tiroir
 *  retire ceux qui concernent les profils du lecteur, qu'il est seul à connaître, et n'en
 *  montre d'abord que dix. Au plus un millier de lignes, sur les plus gros articles du budget. */
async function amendementsDe(dossier: string, numero: string, texte: string, en: boolean): Promise<AmendementLie[]> {
  // La chambre qui examine la version de l'article, et depuis quand : même règle que le
  // classement (`chambre_qui_examine` et `amendements_retenus` de `classer_articles.py`).
  // Sans elle, l'« Art. 2 » du Sénat, qui renumérote, passait pour celui de l'Assemblée.
  const amdts = await sql<Omit<AmendementLie, 'resume'>[]>`
    with v as (
      select case when (t.chambre = 'Assemblée Nationale') <> (t.provenance = 'Séance') then 'AN' else 'SN' end as chambre,
        coalesce(t.date_depot, t.date_publication, t.date_creation)::date as depuis
      from textes t where t.uid = ${texte}
    )
    select a.uid, a.numero, a.lieu, a.chambre, a.url from amendements a, v
    where a.dossier_uid = ${dossier} and a.article = ${numero} and a.chambre = v.chambre
      and (a.date_amendement is null or a.date_amendement >= v.depuis)
    order by a.uid`;
  if (!amdts.length) return [];
  const resumeDe = await resumesAmendements('element_id', amdts.map((a) => a.uid), en);
  return amdts.map((a) => ({
    uid: a.uid, numero: a.numero, lieu: a.lieu, chambre: a.chambre, url: a.url, resume: resumeDe.get(a.uid) ?? null,
  }));
}

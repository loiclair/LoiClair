// Liste unique des sources de données de LoiClair, lue par `/about` (section « Nos
// sources », une ligne par source), par l'accueil (`NosSources.tsx`, chaque nom court une
// fois, et la carte « Sources officielles » de `MethodeCard.tsx`) et par les mentions
// légales (« Nature des données », les noms courts en deux listes). Le libellé et
// la description de chaque entrée vivent dans les messages, sous
// `about.sources.<key>Label` et `about.sources.<key>Desc` ; son nom court, sous
// `landing.<accueil>`.
//
// `officielle` sépare ce que publient les institutions (assemblées, administrations,
// autorités indépendantes) de ce que publient des tiers (encyclopédies, agrégateur de
// presse). La page ne peut écrire « tout vient des institutions » que de la première
// liste : jusqu'au 2026-10-28, Wikipédia y figurait comme une institution, et Wikidata,
// Google Actualités et les registres de déontologie des deux assemblées n'y étaient pas.
//
// L'ordre est celui de l'accueil, les sources d'un même nom court à la suite : `/about`
// le suit aussi. Une source ajoutée ici apparaît sur `/about` ; elle n'ajoute un nom à
// l'accueil que si son nom court est nouveau, et une source officielle au nom nouveau
// entre aussi dans la carte de `MethodeCard`, qui doit tenir sur deux lignes au bureau
// (`HORS_CARTE_SOURCES`). Le chapô de `/documentation/mcp` ne lit pas encore cette
// liste et se met à jour à la main.
//
// `lienSource` sert aussi les pastilles de sources des articles des faits
// (`navigation.tsx`) et la méthodologie de `/Activite`, pour les sources qui y pointent
// sur la même adresse qu'ici.

/** Logo affiché devant la source, défini dans `about/page.tsx` (`LOGOS`). */
export type LogoSource = 'an' | 'senat' | 'cc' | 'insee' | 'hatvp' | 'datagouv' | 'piste' | 'wikipedia'

/** Nom court sur l'accueil, clé du namespace `landing`. Plusieurs sources peuvent
 *  partager le même (les trois de l'Assemblée), qui ne s'affiche qu'une fois. */
export type CleAccueil =
  | 's5LogoAnLabel' | 's5LogoSenatLabel' | 's5LogoCcLabel' | 's5LogoInseeLabel'
  | 's5LogoHatvpLabel' | 's5LogoBarometreLabel' | 's5LogoRneLabel' | 's5LogoElectionsLabel'
  | 's5LogoGeoLabel' | 's5LogoLegifranceLabel' | 's5LogoWikipediaLabel'
  | 's5LogoWikidataLabel' | 's5LogoGoogleActuLabel'

export type Source = {
  key: string
  href: string
  /** Absent : aucun logo dans `public/images/institutions/`, la ligne garde la place vide. */
  logo?: LogoSource
  accueil: CleAccueil
  officielle: boolean
}

export const SOURCES: readonly Source[] = [
  { key: 'source1', href: 'https://data.assemblee-nationale.fr/', logo: 'an', accueil: 's5LogoAnLabel', officielle: true },
  { key: 'source3', href: 'https://www.assemblee-nationale.fr/', logo: 'an', accueil: 's5LogoAnLabel', officielle: true },
  // Dons et invitations, voyages financés par des tiers, déports (`import_transparence_an.py`).
  // Le lien mène au seul registre des déports, et porte le numéro de la 17ᵉ législature :
  // à changer avec la législature.
  { key: 'source14', href: 'https://www.assemblee-nationale.fr/dyn/17/deports', logo: 'an', accueil: 's5LogoAnLabel', officielle: true },
  { key: 'source2', href: 'https://data.senat.fr/', logo: 'senat', accueil: 's5LogoSenatLabel', officielle: true },
  { key: 'source4', href: 'https://www.senat.fr/', logo: 'senat', accueil: 's5LogoSenatLabel', officielle: true },
  // Cadeaux et déplacements, registre des déports (`import_transparence_senat.py`).
  { key: 'source15', href: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/les-obligations-deontologiques-des-senateurs.html', logo: 'senat', accueil: 's5LogoSenatLabel', officielle: true },
  { key: 'source7', href: 'https://www.conseil-constitutionnel.fr/', logo: 'cc', accueil: 's5LogoCcLabel', officielle: true },
  { key: 'source10', href: 'https://www.insee.fr/', logo: 'insee', accueil: 's5LogoInseeLabel', officielle: true },
  { key: 'source12', href: 'https://www.hatvp.fr/', logo: 'hatvp', accueil: 's5LogoHatvpLabel', officielle: true },
  { key: 'source6', href: 'https://www.assemblee-nationale.fr/dyn/taux-application-lois', logo: 'an', accueil: 's5LogoBarometreLabel', officielle: true },
  { key: 'source9', href: 'https://www.data.gouv.fr/datasets/repertoire-national-des-elus-1', logo: 'datagouv', accueil: 's5LogoRneLabel', officielle: true },
  { key: 'source13', href: 'https://www.data.gouv.fr/pages/donnees-des-elections/', logo: 'datagouv', accueil: 's5LogoElectionsLabel', officielle: true },
  { key: 'source11', href: 'https://geo.api.gouv.fr/', logo: 'datagouv', accueil: 's5LogoGeoLabel', officielle: true },
  { key: 'source5', href: 'https://www.legifrance.gouv.fr/', logo: 'piste', accueil: 's5LogoLegifranceLabel', officielle: true },
  { key: 'source8', href: 'https://fr.wikipedia.org/', logo: 'wikipedia', accueil: 's5LogoWikipediaLabel', officielle: false },
  // Identifiants qui relient chaque élu à son article Wikipédia (`enrich_wikipedia_acteurs.py`).
  { key: 'source16', href: 'https://www.wikidata.org/', accueil: 's5LogoWikidataLabel', officielle: false },
  // Articles de presse liés aux dossiers (`import_articles_presse.py`, flux RSS).
  { key: 'source17', href: 'https://news.google.com/', accueil: 's5LogoGoogleActuLabel', officielle: false },
]

export const SOURCES_OFFICIELLES = SOURCES.filter((s) => s.officielle)

/** Lien court vers une source de la liste : son adresse, et pour libellé son domaine
 *  sans `www.`. Lève sur une clé absente : ses appelants sont évalués au build, qui
 *  échoue alors au lieu d'afficher une source sans lien. Lu par `navigation.tsx`
 *  (en-têtes des faits) et `Activite/page.tsx` (méthodologie). */
export function lienSource(key: string): { key: string; label: string; href: string } {
  const source = SOURCES.find((s) => s.key === key)
  if (!source) throw new Error(`Source ${key} absente de src/lib/sources.ts`)
  return { key, label: new URL(source.href).host.replace(/^www\./, ''), href: source.href }
}
export const SOURCES_TIERCES = SOURCES.filter((s) => !s.officielle)

/** Les noms courts de l'accueil, une fois chacun, dans l'ordre de `SOURCES`.
 *  `officielle` est celle de la première source du nom court : les sources qui
 *  partagent un nom court doivent avoir la même valeur. */
export const SOURCES_ACCUEIL: readonly { cle: CleAccueil; officielle: boolean }[] = SOURCES.reduce<
  { cle: CleAccueil; officielle: boolean }[]
>((acc, s) => (acc.some((x) => x.cle === s.accueil) ? acc : [...acc, { cle: s.accueil, officielle: s.officielle }]), [])

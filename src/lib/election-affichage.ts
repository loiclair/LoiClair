// src/lib/election-affichage.ts
// Le bloc élection de la fiche élu (D-298, D-289), préparé côté serveur.
//
// `page.tsx` lit les lignes `election_elus` de l'élu avec leurs résultats
// (`election_resultats`, écrites par `pipeline/import_elections.py`), choisit la
// bonne avec `choisirElection`, puis la passe à `preparerElection`. Le composant client
// (`BlocElection.tsx`) ne reçoit que du prêt-à-afficher : textes traduits, pourcentages
// formatés, lignes déjà coupées entre visibles et repliées. Les données brutes
// (`tours` entiers, inscrits, voix) restent au serveur : le prop d'un composant client
// compte deux fois dans le poids ISR de la fiche, dans le HTML et dans le flux RSC.

export type ElectionId = 'LEG2024' | 'SEN2023' | 'SEN2026';

/** Un candidat (`nom`, `prenom`, `sexe`) ou une liste (`intitule`, `sieges`), tel que l'import l'écrit. */
type EntreeBrute = {
  cle: string;
  nom: string | null;
  prenom: string | null;
  sexe: 'F' | 'M' | null;
  nuance: string | null;
  voix: number;
  elu: boolean;
  sieges: number | null;
  intitule: string | null;
};

type TourBrut = { numero: number; exprimes: number; entrees: EntreeBrute[] };

/** Une ligne de `election_elus` et l'embed `election_resultats` que lit `page.tsx`. */
export type ElectionEluBrute = {
  election: ElectionId;
  nature: 'elu' | 'suppleant' | 'suivant_liste' | 'partielle';
  cle: string | null;
  liste_id: string | null;
  remplace_nom: string | null;
  remplace_uid: string | null;
  date_partielle: string | null;
  election_resultats: { mode: 'majoritaire' | 'liste'; date_scrutin: string; tours: TourBrut[] } | null;
};

/** Une ligne du scrutin. `elu` porte la coche, `moi` la graisse et le remplissage turquoise. */
export type LigneElection = {
  cle: string;
  nom: string;
  nuance: string | null;
  /** Listes qui ont au moins un siège : « 3 sièges ». */
  sieges: string | null;
  pct: string;
  /** Part des exprimés, 0 à 100 : largeur du remplissage, sur une échelle absolue (D-298). */
  part: number;
  elu: boolean;
  moi: boolean;
  /** « élu » ou « élue » pour les lecteurs d'écran, la coche étant muette. */
  srElu: string | null;
};

export type BlocLignes = { intertitre: string | null; lignes: LigneElection[] };

export type ElectionAffichee =
  | {
      sorte: 'scrutin';
      intertitre: string;
      visibles: LigneElection[];
      /** `mention` (« Nuance attribuée par… ») ne s'affiche que déplié : visible d'office, elle détonnait. */
      replie: { ouvrir: string; fermer: string; blocs: BlocLignes[]; mention: string } | null;
    }
  /** Suppléant, suivant de liste, partielle (D-289) : une phrase, sans résultats. */
  | { sorte: 'phrase'; texte: string; lien: { nom: string; uid: string | null } | null };

/** Le `t` du namespace `election`, de `getTranslations` côté serveur. */
type Traduction = {
  (cle: string, valeurs?: Record<string, string | number>): string;
  has: (cle: string) => boolean;
};

/**
 * La ligne à afficher parmi celles de l'élu (deux au plus : un député de 2024 devenu
 * sénateur en 2026 en a une par chambre).
 *
 * Un élu en exercice voit l'élection de sa chambre, et aucune s'il n'en a pas pour
 * elle : celle de l'autre chambre ne dit pas d'où vient son siège. Un ancien élu, ou
 * un ministre, garde la plus récente (D-298), le nom d'élection départageant deux
 * scrutins du même jour.
 */
export function choisirElection(lignes: ElectionEluBrute[], chambre: 'AN' | 'SN' | null): ElectionEluBrute | null {
  const candidates = chambre === null
    ? lignes
    : lignes.filter((l) => l.election.startsWith(chambre === 'AN' ? 'LEG' : 'SEN'));
  return [...candidates].sort((a, b) =>
    (b.election_resultats?.date_scrutin ?? '').localeCompare(a.election_resultats?.date_scrutin ?? '')
    || b.election.localeCompare(a.election),
  )[0] ?? null;
}

/**
 * Prépare le bloc. Rend `null` quand il n'y a rien de sûr à montrer : résultats
 * absents, ou élu introuvable parmi les entrées (un bloc sans la personne de la fiche
 * se lirait comme le sien).
 *
 * - Élu au 2ᵈ tour : ce tour en entier, le 1ᵉʳ replié.
 * - Élu au 1ᵉʳ tour, ou scrutin de liste : l'élu et le premier adversaire, le reste
 *   replié, sauf à trois entrées ou moins.
 * - `feminin` accorde la phrase de la partielle, qui n'a pas d'entrée où lire le sexe.
 */
export function preparerElection(
  brute: ElectionEluBrute,
  { locale, t, feminin }: { locale: string; t: Traduction; feminin: boolean },
): ElectionAffichee | null {
  const intl = locale === 'en' ? 'en-GB' : 'fr-FR';

  if (brute.nature === 'suppleant') {
    return brute.remplace_nom
      ? { sorte: 'phrase', texte: t('siege.remplacement'), lien: { nom: brute.remplace_nom, uid: brute.remplace_uid } }
      : { sorte: 'phrase', texte: t('siege.remplacementInconnu'), lien: null };
  }
  if (brute.nature === 'suivant_liste') {
    return { sorte: 'phrase', texte: t('siege.suivantListe'), lien: null };
  }
  if (brute.nature === 'partielle') {
    if (!brute.date_partielle) return null;
    // `timeZone: 'UTC'` : la date est un jour civil, lu à minuit UTC.
    const date = new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${brute.date_partielle}T00:00:00Z`));
    return { sorte: 'phrase', texte: t('siege.partielle', { sexe: feminin ? 'F' : 'M', date }), lien: null };
  }

  const resultat = brute.election_resultats;
  const tours = [...(resultat?.tours ?? [])].sort((a, b) => a.numero - b.numero);
  const liste = resultat?.mode === 'liste';
  const cleMoi = liste ? brute.liste_id : brute.cle;
  if (!resultat || !cleMoi || tours.length === 0) return null;

  // Le tour où la personne de la fiche est élue ; en liste, l'unique tour, à condition
  // que sa liste y figure (un `liste_id` d'avant une réimportation n'y serait plus).
  const indexTour = liste
    ? (tours[0].entrees.some((e) => e.cle === cleMoi) ? 0 : -1)
    : tours.findIndex((tour) => tour.entrees.some((e) => e.cle === cleMoi && e.elu));
  if (indexTour < 0) {
    console.warn(`[election] ${brute.election} : élu ${cleMoi} introuvable dans les résultats`);
    return null;
  }

  const nf = new Intl.NumberFormat(intl, {
    style: 'percent',
    minimumFractionDigits: liste ? 1 : 2,
    maximumFractionDigits: liste ? 1 : 2,
  });
  const nuance = (code: string | null): string | null => {
    if (!code) return null;
    if (t.has(`nuance.${code}`)) return t(`nuance.${code}`);
    // Les codes de liste sont ceux des candidats précédés d'un L (`LRN`, `LUG`) :
    // seuls ceux qui n'ont pas d'équivalent individuel ont leur propre clé.
    if (liste && code.startsWith('L') && t.has(`nuance.${code.slice(1)}`)) return t(`nuance.${code.slice(1)}`);
    // Jamais le code brut (D-298) : la ligne s'affiche sans nuance, et le build le signale.
    console.warn(`[election] nuance sans libellé : ${code}`);
    return null;
  };
  const lignes = (tour: TourBrut): LigneElection[] =>
    [...tour.entrees]
      // Voix, puis nom, puis clé : un ordre total, stable d'un rendu à l'autre.
      .sort((a, b) =>
        b.voix - a.voix
        || (a.intitule ?? `${a.nom} ${a.prenom}`).localeCompare(b.intitule ?? `${b.nom} ${b.prenom}`, intl)
        || a.cle.localeCompare(b.cle))
      .map((e) => {
        const part = tour.exprimes > 0 ? (100 * e.voix) / tour.exprimes : 0;
        const moi = e.cle === cleMoi;
        return {
          cle: e.cle,
          nom: liste ? (e.intitule ?? '') : `${e.prenom ?? ''} ${e.nom ?? ''}`.trim(),
          nuance: nuance(e.nuance),
          // Rien pour une liste battue : « 0 siège » sur sept listes sur neuf en Gironde
          // n'apprenait rien et chargeait le bloc.
          sieges: liste && (e.sieges ?? 0) > 0 ? t('sieges', { count: e.sieges ?? 0 }) : null,
          pct: nf.format(part / 100),
          // Deux décimales suffisent à une largeur, et allègent le prop.
          part: Math.round(part * 100) / 100,
          // En liste, la coche ne marque que la liste de la fiche : sur toutes les
          // listes qui ont un siège, elle en cocherait trois en Gironde.
          elu: liste ? moi : e.elu,
          moi,
          srElu: !liste && e.elu ? t('elu', { sexe: e.sexe ?? 'M' }) : null,
        };
      });

  const libelleTour = (numero: number) => (t.has(`detail.tour${numero}`) ? t(`detail.tour${numero}`) : null);
  const tour = tours[indexTour];
  const morceaux = [t(`scrutin.${brute.election}`)];
  if (!liste) {
    const libelle = libelleTour(tour.numero);
    if (libelle) morceaux.push(libelle);
  }
  if (brute.election.startsWith('SEN')) morceaux.push(t('detail.grandsElecteurs'));
  const intertitre = morceaux.join(' · ');
  const mention = t('mention');
  const toutes = lignes(tour);

  if (indexTour > 0) {
    // Élu au 2ᵈ tour : le 1ᵉʳ, replié, en entier.
    return {
      sorte: 'scrutin',
      intertitre,
      visibles: toutes,
      replie: {
        ouvrir: t('repli.premierTour'),
        fermer: t('repli.masquerPremierTour'),
        blocs: tours.slice(0, indexTour).map((precedent) => ({ intertitre: libelleTour(precedent.numero), lignes: lignes(precedent) })),
        mention,
      },
    };
  }
  if (toutes.length <= 3) return { sorte: 'scrutin', intertitre, visibles: toutes, replie: null };

  const adversaire = toutes.find((l) => !l.moi);
  const visibles = toutes.filter((l) => l.moi || l === adversaire);
  return {
    sorte: 'scrutin',
    intertitre,
    visibles,
    replie: {
      ouvrir: liste ? t('repli.toutesListes', { count: toutes.length }) : t('repli.tousCandidats', { count: toutes.length }),
      fermer: liste ? t('repli.masquerListes') : t('repli.masquerCandidats'),
      blocs: [{ intertitre: null, lignes: toutes.filter((l) => !visibles.includes(l)) }],
      mention,
    },
  };
}

// Construction d'URI mailto: pour les CTA contact élu, et de la façon de nommer
// l'élu sur ces boutons. Le client mail (Mail.app, Gmail, etc.) reçoit le
// brouillon pré-rempli — aucun envoi côté LoiClair, aucune donnée transmise à
// nos serveurs.
//
// Appelé par `ContacterEluCard` (fiche élu), `ContacterMesElusBanner` (fiche
// dossier, pour les élus du lecteur comme pour l'auteur et les rapporteurs du texte)
// et le tiroir d'un article ou d'un amendement de « Ce qui me concerne »
// (`ChangementsConcernes`), qui nomme l'élément dans le brouillon.

export type ActeurCible = {
  prenom: string | null;
  nom: string | null;
  email: string | null;
  /** « M. » ou « Mme », colonne `acteurs.civ`. Absente des élus mémorisés dans
   *  le navigateur avant qu'on la stocke : la formule retombe alors sur le nom complet. */
  civ?: string | null;
  /** La chambre de l'élu, qui choisit « Monsieur le Député » ou « Monsieur le Sénateur ». */
  chambre?: 'AN' | 'SN' | null;
};

export type DossierContext = {
  uid: string;
  titre: string | null;
  statut: string | null;
};

/** L'article ou l'amendement dont parle le courriel, à l'intérieur d'un texte
 *  (`DossierContext`). `numero` : « Art. 12 bis » pour un article, tel que
 *  `texte_articles` l'écrit, « 42 » pour un amendement. `url` : la page officielle de
 *  l'amendement, ajoutée au corps. */
export type ElementContext = { type: 'article' | 'amendement'; numero: string; url?: string };

export type Locale = 'fr' | 'en';

const SITE_ORIGIN = 'https://loiclair.fr';

/** La civilité normalisée : la colonne porte parfois des espaces autour. Exportée
 *  pour accorder « mon député / ma députée » dans les libellés ICU (`select`). */
export function genre(civ: string | null | undefined): 'F' | 'M' | null {
  const c = civ?.trim();
  if (c === 'Mme') return 'F';
  if (c === 'M.') return 'M';
  return null;
}

/**
 * Comment nommer un élu sur un bouton ou une formule : « M. Ciotti »,
 * « Mme Le Pen », « Mr Ciotti » en anglais. Sans civilité ou sans nom, repli
 * sur « Prénom Nom », jamais sur le prénom seul, qui sonnait familier face à un
 * parlementaire.
 *
 * Espace insécable entre la civilité et le nom : sur un bouton qui passe à la
 * ligne, « M. » ne doit pas rester seul en bout de ligne.
 */
export function appellation(cible: Pick<ActeurCible, 'prenom' | 'nom' | 'civ'>, locale: Locale): string {
  const g = genre(cible.civ);
  if (g && cible.nom) {
    const titre = locale === 'en' ? (g === 'F' ? 'Ms' : 'Mr') : (g === 'F' ? 'Mme' : 'M.');
    return `${titre} ${cible.nom}`;
  }
  return [cible.prenom, cible.nom].filter(Boolean).join(' ');
}

/**
 * Première ligne du brouillon. En français, la formule protocolaire d'un
 * courrier à un parlementaire (« Madame la Sénatrice, ») ; en anglais, « Dear
 * Ms Dupont, ». `null` pour un envoi groupé à plusieurs élus.
 */
function salutation(cible: ActeurCible | null, locale: Locale): string {
  if (!cible) {
    return locale === 'en' ? 'Dear Sir or Madam,' : 'Mesdames, Messieurs,';
  }
  if (locale === 'en') return `Dear ${appellation(cible, locale)},`;

  const g = genre(cible.civ);
  if (!g) return `Bonjour ${appellation(cible, locale)},`;
  if (cible.chambre === 'AN') return g === 'F' ? 'Madame la Députée,' : 'Monsieur le Député,';
  if (cible.chambre === 'SN') return g === 'F' ? 'Madame la Sénatrice,' : 'Monsieur le Sénateur,';
  return g === 'F' ? 'Madame,' : 'Monsieur,';
}

// Sépare body avec CRLF pour compatibilité maximale (Mail.app, Outlook, Gmail
// web, iOS Mail). Encode tout via encodeURIComponent (et pas URLSearchParams
// qui transforme les espaces en + et confond certains clients).
function encodeMailtoQuery(subject: string, body: string): string {
  return `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** L'élément nommé en milieu de phrase : « l'art. 12 bis », « l'amendement n° 42 » ;
 *  « Art. 12 bis », « amendment no. 42 » en anglais, comme dans les libellés du site. */
function nommerElement(e: ElementContext, locale: Locale): string {
  if (locale === 'en') return e.type === 'article' ? e.numero : `amendment no. ${e.numero}`;
  return e.type === 'article' ? `l'${e.numero.charAt(0).toLowerCase()}${e.numero.slice(1)}` : `l'amendement n° ${e.numero}`;
}

/**
 * Un élu (brouillon adressé à lui) ou une liste d'adresses séparées par des
 * virgules (brouillon groupé, salutation collective). `null` sans adresse.
 * `element` ne sert qu'avec `dossier` : le brouillon parle alors de cet article ou de
 * cet amendement du texte, et non du texte entier.
 *
 * `role` : ce que l'élu destinataire a fait du `dossier`. Sans `element`, la phrase
 * d'introduction le dit (« le texte que vous avez déposé », « les travaux dont
 * vous êtes rapporteure ») ; l'objet ne change pas.
 */
export function buildMailto(
  acteurOrEmails: ActeurCible | string,
  opts: { locale?: Locale; dossier?: DossierContext; element?: ElementContext; role?: 'auteur' | 'rapporteur' } = {},
): string | null {
  const locale: Locale = opts.locale ?? 'fr';
  const rapporteure = typeof acteurOrEmails !== 'string' && genre(acteurOrEmails.civ) === 'F';

  let to: string;
  let cible: ActeurCible | null;
  if (typeof acteurOrEmails === 'string') {
    to = acteurOrEmails;
    if (!to) return null;
    cible = null;
  } else {
    if (!acteurOrEmails.email) return null;
    to = acteurOrEmails.email;
    cible = acteurOrEmails;
  }

  let subject: string;
  let body: string;

  if (opts.dossier) {
    const titre = opts.dossier.titre ?? '';
    const dossierUrl = `${SITE_ORIGIN}/dossiers-legislatifs/${opts.dossier.uid}/resume-ia`;
    const element = opts.element;
    const nom = element ? nommerElement(element, locale) : null;
    if (locale === 'en') {
      // « Art. 12 of the bill », « amendment no. 42 to the bill ».
      const prep = element?.type === 'amendement' ? 'to' : 'of';
      subject = nom ? `About ${nom} ${prep} the bill “${titre}”` : `About the bill “${titre}”`;
      body = [
        salutation(cible, locale),
        '',
        nom ? `I am writing to you as a citizen regarding ${nom} ${prep} the following bill:`
          : opts.role === 'auteur'
          ? `I am writing to you as a citizen regarding the bill you introduced:`
          : opts.role === 'rapporteur'
            ? `I am writing to you as a citizen regarding the following work, for which you are rapporteur:`
            : `I am writing to you as a citizen regarding the following bill:`,
        '',
        `“${titre}”`,
        '',
        `Link: ${dossierUrl}`,
        ...(element?.url ? [`Official page of the amendment: ${element.url}`] : []),
        '',
        `[write your opinion or question here]`,
        '',
        `Best regards`,
      ].join('\r\n');
    } else {
      // « l'art. 12 du texte », « l'amendement n° 42 au texte ».
      const prep = element?.type === 'amendement' ? 'au' : 'du';
      subject = nom ? `À propos de ${nom} ${prep} texte « ${titre} »` : `À propos du texte « ${titre} »`;
      body = [
        salutation(cible, locale),
        '',
        nom ? `Je vous écris en tant que citoyen au sujet de ${nom} ${prep} texte suivant :`
          : opts.role === 'auteur'
          ? `Je vous écris en tant que citoyen au sujet du texte que vous avez déposé :`
          : opts.role === 'rapporteur'
            ? `Je vous écris en tant que citoyen au sujet des travaux suivants, dont vous êtes ${rapporteure ? 'rapporteure' : 'rapporteur'} :`
            : `Je vous écris en tant que citoyen au sujet du texte suivant :`,
        '',
        `« ${titre} »`,
        '',
        `Lien : ${dossierUrl}`,
        ...(element?.url ? [`Page officielle de l'amendement : ${element.url}`] : []),
        '',
        `[écrivez ici votre opinion ou question]`,
        '',
        `Cordialement`,
      ].join('\r\n');
    }
  } else {
    if (locale === 'en') {
      subject = `Question from a citizen`;
      body = [
        salutation(cible, locale),
        '',
        `[write your message here]`,
        '',
        `Best regards`,
      ].join('\r\n');
    } else {
      subject = `Question d'un citoyen`;
      body = [
        salutation(cible, locale),
        '',
        `[écrivez ici votre message]`,
        '',
        `Cordialement`,
      ].join('\r\n');
    }
  }

  return `mailto:${to}?${encodeMailtoQuery(subject, body)}`;
}

// Pool statique du quiz "Processus législatif" : 60 questions de connaissances
// générales sur le fonctionnement du Parlement français (24 faciles / 22
// moyennes / 14 difficiles), rédigées et vérifiées à la main — pas de données
// en base ici (contrairement au quiz d'affinité), donc pas de fichier
// `-queries.ts` séparé. Chaque question porte une `source` : la page
// institutionnelle (Constitution, fiches de l'Assemblée nationale, Sénat,
// Légifrance) qui établit la bonne réponse, affichée au joueur après une
// mauvaise réponse et dans le détail des réponses. Chaque partie tire 8/7/5
// (cf. `QUIZ_PROCESSUS_ROUND_SIZE` dans quiz-processus.ts), donc le pool a
// volontairement plus de questions que ce qui est joué en une partie, pour
// varier les parties rejouées.
//
// Convention d'auteur : la 1ère entrée de `propositions` est toujours la
// bonne réponse (`reponseCorrecteIndex: 0`) — l'ordre est mélangé à chaque
// partie par `drawQuizProcessusRound` (src/lib/quiz-processus.ts).
//
// Les `id` ne changent jamais quand on corrige une question : l'empreinte du
// pool est calculée sur eux (`quiz-processus-selection.ts`), et en changer un
// marquerait périmés tous les résultats enregistrés des joueurs.

export type QuizProcessusDifficulte = 'facile' | 'moyen' | 'difficile'

export type QuizProcessusSource = {
  /** Nom court affiché après « Source : ». */
  label: string
  /** Même valeur dans les deux pools, sauf pour une page de LoiClair, dont le
   *  chemin porte le préfixe de langue (`localePrefix: 'always'`). */
  href: string
}

export type QuizProcessusQuestion = {
  id: string
  difficulte: QuizProcessusDifficulte
  enonce: string
  propositions: [string, string, string]
  reponseCorrecteIndex: 0 | 1 | 2
  explication: string
  source: QuizProcessusSource
}

// Texte intégral de la Constitution sur le site du Conseil constitutionnel :
// chaque article y porte une ancre `article_N` (tiret remplacé par `_`, par
// exemple `article_34_1`), vérifiée sur la page, ce qui permet de pointer
// l'article exact depuis une seule URL stable. Exporté pour le jumeau anglais,
// qui doit pointer les mêmes ancres.
const CONSTITUTION_URL =
  'https://www.conseil-constitutionnel.fr/le-bloc-de-constitutionnalite/texte-integral-de-la-constitution-du-4-octobre-1958-en-vigueur'

export function constitutionHref(article: string): string {
  return `${CONSTITUTION_URL}#article_${article.replace('-', '_')}`
}

function constitution(article: string): QuizProcessusSource {
  return { label: `Constitution, article ${article}`, href: constitutionHref(article) }
}

export const QUIZ_PROCESSUS_POOL: QuizProcessusQuestion[] = [
  // ─── Facile (24) ────────────────────────────────────────────────────────
  {
    id: 'proc-f01',
    difficulte: 'facile',
    enonce: "Comment s'appelle la chambre basse du Parlement français ?",
    propositions: ["L'Assemblée nationale", 'Le Sénat', "Le Conseil d'État"],
    reponseCorrecteIndex: 0,
    explication:
      "L'Assemblée nationale est composée de 577 députés élus au suffrage universel direct. En cas de désaccord persistant avec le Sénat, le Gouvernement peut lui donner le dernier mot, sauf pour les lois constitutionnelles et les lois organiques relatives au Sénat.",
    source: {
      label: "Assemblée nationale, fiche « L'Assemblée nationale et le Sénat »",
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/assemblee-nationale-generalites/l-assemblee-nationale-et-le-senat-caracteres-generaux-du-parlement',
    },
  },
  {
    id: 'proc-f02',
    difficulte: 'facile',
    enonce: "Combien de députés compte l'Assemblée nationale ?",
    propositions: ['577', '348', '925'],
    reponseCorrecteIndex: 0,
    explication:
      "La Constitution interdit d'en compter davantage (article 24). Élu dans une circonscription, chaque député représente pourtant la Nation tout entière.",
    source: {
      label: "Assemblée nationale, fiche « L'élection des députés »",
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/deputes-groupes-parlementaires/l-election-des-deputes',
    },
  },
  {
    id: 'proc-f03',
    difficulte: 'facile',
    enonce: 'Combien de sénateurs siègent au Sénat ?',
    propositions: ['348', '577', '200'],
    reponseCorrecteIndex: 0,
    explication:
      "Le Sénat représente les collectivités territoriales de la République (communes, départements, régions) et compte 348 membres.",
    source: {
      label: "Sénat, « Mode d'élection des sénateurs »",
      href: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/mode-delection-des-senateurs.html',
    },
  },
  {
    id: 'proc-f04',
    difficulte: 'facile',
    enonce: "Quelle est la durée du mandat d'un député ?",
    propositions: ['5 ans', '6 ans', '7 ans'],
    reponseCorrecteIndex: 0,
    explication:
      "Le mandat dure 5 ans, mais l'Assemblée peut être dissoute avant terme par le Président de la République, ce qui déclenche de nouvelles élections.",
    source: {
      label: "Assemblée nationale, fiche « L'élection des députés »",
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/deputes-groupes-parlementaires/l-election-des-deputes',
    },
  },
  {
    id: 'proc-f05',
    difficulte: 'facile',
    enonce: "Quelle est la durée du mandat d'un sénateur ?",
    propositions: ['6 ans', '5 ans', '9 ans'],
    reponseCorrecteIndex: 0,
    explication:
      "Depuis 2011, le Sénat se renouvelle par moitié tous les 3 ans : il n'est donc jamais renouvelé en totalité d'un seul coup.",
    source: {
      label: "Sénat, « Mode d'élection des sénateurs »",
      href: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/mode-delection-des-senateurs.html',
    },
  },
  {
    id: 'proc-f06',
    difficulte: 'facile',
    enonce: 'Comment le Président de la République est-il élu ?',
    propositions: ['Au suffrage universel direct', 'Au suffrage universel indirect', 'Nommé par le Parlement'],
    reponseCorrecteIndex: 0,
    explication:
      "Il est élu pour cinq ans à la majorité absolue des suffrages exprimés, au besoin en deux tours (articles 6 et 7). Nul ne peut exercer plus de deux mandats consécutifs.",
    source: constitution('6'),
  },
  {
    id: 'proc-f07',
    difficulte: 'facile',
    enonce: 'Comment les sénateurs sont-ils élus ?',
    propositions: [
      'Au suffrage universel indirect, par des grands électeurs',
      'Au suffrage universel direct',
      'Nommés par le Président de la République',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Le collège compte environ 162 000 grands électeurs : députés, sénateurs, conseillers régionaux et départementaux, et surtout délégués des conseils municipaux, qui en représentent 95 %.",
    source: {
      label: "Sénat, « Mode d'élection des sénateurs »",
      href: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/mode-delection-des-senateurs.html',
    },
  },
  {
    id: 'proc-f08',
    difficulte: 'facile',
    enonce: 'Qui dirige le Gouvernement ?',
    propositions: ['Le Premier ministre', "Le président de l'Assemblée nationale", 'Le président du Conseil constitutionnel'],
    reponseCorrecteIndex: 0,
    explication:
      "Nommé par le Président de la République, le Premier ministre dirige l'action du Gouvernement (article 21). C'est le Gouvernement qui détermine et conduit la politique de la Nation (article 20).",
    source: constitution('21'),
  },
  {
    id: 'proc-f09',
    difficulte: 'facile',
    enonce: 'Qui nomme le Premier ministre ?',
    propositions: ['Le Président de la République', "L'Assemblée nationale", 'Le Conseil constitutionnel'],
    reponseCorrecteIndex: 0,
    explication:
      "Les autres membres du Gouvernement sont ensuite nommés par le Président sur proposition du Premier ministre. Le Gouvernement reste responsable devant l'Assemblée, qui peut le renverser.",
    source: constitution('8'),
  },
  {
    id: 'proc-f10',
    difficulte: 'facile',
    enonce: 'Qui promulgue les lois votées par le Parlement ?',
    propositions: ['Le Président de la République', 'Le Premier ministre', 'Le Conseil constitutionnel'],
    reponseCorrecteIndex: 0,
    explication:
      "Il dispose de 15 jours pour promulguer une loi ; avant cela, il peut demander une nouvelle délibération au Parlement ou saisir le Conseil constitutionnel.",
    source: constitution('10'),
  },
  {
    id: 'proc-f11',
    difficulte: 'facile',
    enonce: 'Combien de temps le Président a-t-il pour promulguer une loi après son adoption ?',
    propositions: ['15 jours', '48 heures', '1 mois'],
    reponseCorrecteIndex: 0,
    explication:
      "Le délai court à partir de la transmission au Gouvernement de la loi définitivement adoptée (article 10). Une saisine du Conseil constitutionnel le suspend (article 61).",
    source: constitution('10'),
  },
  {
    id: 'proc-f12',
    difficulte: 'facile',
    enonce: "Qui peut dissoudre l'Assemblée nationale ?",
    propositions: ['Le Président de la République', 'Le Premier ministre', 'Le Sénat'],
    reponseCorrecteIndex: 0,
    explication:
      "Un pouvoir propre du Président, exercé après consultation du Premier ministre et des présidents des deux assemblées. Les élections ont lieu 20 à 40 jours plus tard, et aucune nouvelle dissolution n'est possible dans l'année qui suit ces élections.",
    source: constitution('12'),
  },
  {
    id: 'proc-f13',
    difficulte: 'facile',
    enonce: 'Le Sénat peut-il être dissous ?',
    propositions: ['Non, jamais', 'Oui, par le Président', "Oui, par l'Assemblée nationale"],
    reponseCorrecteIndex: 0,
    explication:
      "Contrairement à l'Assemblée nationale, le Sénat ne peut pas être dissous. C'est cette permanence qui explique que son président assure l'intérim si le Président de la République démissionne, meurt ou est empêché.",
    source: {
      label: "Assemblée nationale, fiche « L'Assemblée nationale et le Sénat »",
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/assemblee-nationale-generalites/l-assemblee-nationale-et-le-senat-caracteres-generaux-du-parlement',
    },
  },
  {
    id: 'proc-f14',
    difficulte: 'facile',
    enonce: 'Combien de membres compte le Conseil constitutionnel ?',
    propositions: ['9', '5', '15'],
    reponseCorrecteIndex: 0,
    explication:
      "Nommés pour un mandat de 9 ans non renouvelable, avec un renouvellement par tiers tous les 3 ans. Les anciens Présidents de la République en sont membres de droit à vie.",
    source: constitution('56'),
  },
  {
    id: 'proc-f15',
    difficulte: 'facile',
    enonce: 'Quel est le rôle principal du Conseil constitutionnel ?',
    propositions: ['Vérifier que les lois respectent la Constitution', "Voter le budget de l'État", 'Nommer les ministres'],
    reponseCorrecteIndex: 0,
    explication:
      "Lorsqu'il est saisi avant la promulgation, il vérifie la conformité des lois à la Constitution ; ce contrôle est obligatoire pour les lois organiques. Une disposition déclarée contraire ne peut être ni promulguée ni appliquée (article 62).",
    source: constitution('61'),
  },
  {
    id: 'proc-f16',
    difficulte: 'facile',
    enonce: 'Où est publiée une loi une fois promulguée ?',
    propositions: ['Au Journal officiel', "Sur le site de l'Assemblée nationale", 'Dans un décret'],
    reponseCorrecteIndex: 0,
    explication:
      "Une loi entre en vigueur à la date qu'elle fixe ou, à défaut, le lendemain de sa publication au Journal officiel.",
    source: {
      label: 'Légifrance, Code civil, article 1er',
      href: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006419280',
    },
  },
  {
    id: 'proc-f17',
    difficulte: 'facile',
    enonce: 'Qui peut déposer un projet de loi ?',
    propositions: ['Le Gouvernement', 'Un citoyen, via une pétition', 'Un juge'],
    reponseCorrecteIndex: 0,
    explication:
      "Par opposition à une « proposition de loi », déposée par un parlementaire. Un projet de loi est délibéré en conseil des ministres après avis du Conseil d'État.",
    source: constitution('39'),
  },
  {
    id: 'proc-f18',
    difficulte: 'facile',
    enonce: "Combien d'étapes compte le parcours typique d'une loi, selon LoiClair ?",
    propositions: ['8', '5', '3'],
    reponseCorrecteIndex: 0,
    explication:
      "Dépôt, commission, séance publique, navette et CMP, vote final, contrôle constitutionnel, promulgation, puis décrets d'application.",
    source: { label: "LoiClair, « Le parcours d'une loi »", href: '/fr/processus-legislatif' },
  },
  {
    id: 'proc-f19',
    difficulte: 'facile',
    enonce: "Qui rédige les décrets d'application d'une loi ?",
    propositions: ['Le Gouvernement', 'Le Conseil constitutionnel', "Le président de l'Assemblée nationale"],
    reponseCorrecteIndex: 0,
    explication:
      "Le Premier ministre assure l'exécution des lois et exerce le pouvoir réglementaire. Sans ces décrets, les dispositions de la loi qui en ont besoin n'entrent pas en vigueur, même si le texte a été promulgué.",
    source: constitution('21'),
  },
  {
    id: 'proc-f20',
    difficulte: 'facile',
    enonce: 'Qui peut déposer une proposition de loi ?',
    propositions: ['Un député ou un sénateur', 'Le Gouvernement', 'Un citoyen, via une pétition'],
    reponseCorrecteIndex: 0,
    explication:
      "Contrairement au projet de loi, déposé par le Gouvernement, la proposition de loi émane d'un parlementaire. Certains textes restent réservés au Gouvernement, comme les lois de finances.",
    source: {
      label: "Assemblée nationale, fiche « L'initiative parlementaire »",
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/l-initiative-parlementaire',
    },
  },
  {
    id: 'proc-f21',
    difficulte: 'facile',
    enonce: 'Une résolution votée par le Parlement a-t-elle force de loi ?',
    propositions: [
      'Non, elle exprime une position sans valeur législative',
      'Oui, comme une loi ordinaire',
      'Seulement si elle est signée par le Président',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Par une résolution, une assemblée émet un avis sur une question déterminée. Elle ne peut pas contenir d'injonction à l'égard du Gouvernement (article 34-1 de la Constitution).",
    source: {
      label: "Assemblée nationale, fiche « Les résolutions de l'article 34-1 »",
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/evaluation-politiques-publiques-controle-gouvernement/les-resolutions-de-l-article-34-1-de-la-constitution',
    },
  },
  {
    id: 'proc-f22',
    difficulte: 'facile',
    enonce: 'Une pétition adressée au Parlement peut-elle devenir une loi directement ?',
    propositions: [
      'Non, elle peut être examinée en commission mais n\'a pas force de loi',
      'Oui, automatiquement si elle recueille assez de signatures',
      'Oui, si le Président la valide',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "À l'Assemblée, elle est renvoyée à une commission, qui peut la classer ou l'examiner. Signée par plus de 500 000 personnes dans au moins 30 départements ou collectivités d'outre-mer, elle peut aussi faire l'objet d'un débat en séance.",
    source: {
      label: "Assemblée nationale, « Parcours d'une pétition »",
      href: 'https://petitions.assemblee-nationale.fr/pages/parcours_petition',
    },
  },
  {
    id: 'proc-f23',
    difficulte: 'facile',
    enonce: 'Un décret doit-il être voté par le Parlement ?',
    propositions: ['Non, il ne passe pas par le Parlement', 'Oui, comme une loi ordinaire', 'Oui, mais seulement au Sénat'],
    reponseCorrecteIndex: 0,
    explication:
      "Contrairement à une loi, un décret est un texte réglementaire pris par le pouvoir exécutif seul (Président ou Premier ministre).",
    source: constitution('21'),
  },
  {
    id: 'proc-f24',
    difficulte: 'facile',
    enonce: "Qu'est-ce que produit une commission d'enquête à l'issue de ses travaux ?",
    propositions: ['Un rapport, mais pas une loi', 'Automatiquement une proposition de loi', "Un décret d'application"],
    reponseCorrecteIndex: 0,
    explication:
      "Elle peut obliger des personnes à venir témoigner sous serment et se faire communiquer des documents, mais sa mission prend fin par le dépôt de son rapport, au plus tard six mois après sa création.",
    source: {
      label: "Assemblée nationale, fiche « Les commissions d'enquête »",
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/evaluation-politiques-publiques-controle-gouvernement/les-commissions-d-enquete-et-les-missions-d-information-creees-par-la-conference-des-presidents',
    },
  },

  // ─── Moyen (22) ─────────────────────────────────────────────────────────
  {
    id: 'proc-m01',
    difficulte: 'moyen',
    enonce:
      "Selon l'Assemblée nationale, quelle part des lois adoptées sous la XVe législature (2017-2022), hors conventions internationales, venait de propositions de loi ?",
    propositions: ['Plus de 45 %', 'Moins de 10 %', 'Environ 20 %'],
    reponseCorrecteIndex: 0,
    explication:
      "Longtemps, environ 80 % des lois adoptées hors conventions venaient de projets du Gouvernement. Depuis la révision de 2008, qui partage l'ordre du jour entre le Gouvernement et les assemblées, la part des propositions de loi est passée de plus de 30 % sous la XIIIe législature à plus de 45 % sous la XVe.",
    source: {
      label: "Assemblée nationale, fiche « L'initiative parlementaire »",
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/l-initiative-parlementaire',
    },
  },
  {
    id: 'proc-m02',
    difficulte: 'moyen',
    enonce: "Qu'est-ce qu'une motion de censure ?",
    propositions: [
      "Une procédure par laquelle l'Assemblée peut renverser le Gouvernement",
      'Un texte qui annule une loi déjà promulguée',
      'Un recours déposé devant le Conseil constitutionnel',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Si elle est adoptée à la majorité des membres de l'Assemblée, le Premier ministre doit remettre au Président de la République la démission du Gouvernement (article 50).",
    source: constitution('49'),
  },
  {
    id: 'proc-m03',
    difficulte: 'moyen',
    enonce: "Combien de députés doivent signer pour qu'une motion de censure soit déposée ?",
    propositions: ['Au moins un dixième des députés', 'La majorité absolue des députés', 'Un seul député suffit'],
    reponseCorrecteIndex: 0,
    explication:
      "Soit au moins 58 signatures sur 577 députés. Pour être adoptée, la motion doit ensuite réunir la majorité des membres de l'Assemblée. Hors motions répondant à un 49.3, un député ne peut en signer plus de trois par session ordinaire.",
    source: constitution('49'),
  },
  {
    id: 'proc-m04',
    difficulte: 'moyen',
    enonce: "Que permet l'article 49.3 de la Constitution ?",
    propositions: ['Faire adopter un texte sans vote, sauf motion de censure', 'Dissoudre le Sénat', 'Convoquer un référendum'],
    reponseCorrecteIndex: 0,
    explication:
      "Le Premier ministre engage la responsabilité du Gouvernement sur un texte : celui-ci est considéré comme adopté, sauf si une motion de censure, déposée dans les 24 heures, est votée. La procédure vaut pour les budgets de l'État et de la Sécurité sociale, et pour un seul autre texte par session.",
    source: constitution('49'),
  },
  {
    id: 'proc-m05',
    difficulte: 'moyen',
    enonce: "En cas de désaccord persistant entre l'Assemblée nationale et le Sénat, qui a le dernier mot dans la majorité des cas ?",
    propositions: ["L'Assemblée nationale", 'Le Sénat', 'Le Conseil constitutionnel'],
    reponseCorrecteIndex: 0,
    explication:
      "Si la commission mixte paritaire échoue, le Gouvernement peut, après une nouvelle lecture dans chaque chambre, demander à l'Assemblée de statuer définitivement.",
    source: constitution('45'),
  },
  {
    id: 'proc-m06',
    difficulte: 'moyen',
    enonce: "Sur quels textes le Sénat dispose-t-il d'un pouvoir égal à l'Assemblée, sans dernier mot possible pour cette dernière ?",
    propositions: [
      'Les lois constitutionnelles et les lois organiques relatives au Sénat',
      "Le budget annuel de l'État",
      'Les résolutions européennes',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Sur ces textes précis, l'accord des deux chambres est requis : l'Assemblée ne peut pas passer outre un désaccord du Sénat, contrairement à la procédure législative ordinaire.",
    source: {
      label: "Assemblée nationale, fiche « L'Assemblée nationale et le Sénat »",
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/assemblee-nationale-generalites/l-assemblee-nationale-et-le-senat-caracteres-generaux-du-parlement',
    },
  },
  {
    id: 'proc-m07',
    difficulte: 'moyen',
    enonce: 'Combien de membres compte une commission mixte paritaire (CMP) ?',
    propositions: ['7 députés et 7 sénateurs', '10 députés et 10 sénateurs', '5 députés et 5 sénateurs'],
    reponseCorrecteIndex: 0,
    explication:
      "Ces 14 parlementaires cherchent un texte de compromis entre les deux chambres ; s'ils y parviennent, le Gouvernement peut soumettre ce texte commun à l'approbation de l'Assemblée et du Sénat.",
    source: {
      label: 'Sénat, « La commission mixte paritaire »',
      href: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/la-commission-mixte-paritaire.html',
    },
  },
  {
    id: 'proc-m08',
    difficulte: 'moyen',
    enonce: 'À quoi sert l\'étape « Navette & CMP » dans le parcours d\'une loi ?',
    propositions: ["Harmoniser le texte entre l'Assemblée et le Sénat", 'Faire signer le Président', 'Informer les citoyens du contenu du texte'],
    reponseCorrecteIndex: 0,
    explication:
      "Le texte fait des allers-retours entre l'Assemblée et le Sénat jusqu'à ce qu'un accord soit trouvé sur une version identique, ou via le compromis d'une commission mixte paritaire.",
    source: {
      label: 'Assemblée nationale, fiche « La procédure législative »',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/la-procedure-legislative',
    },
  },
  {
    id: 'proc-m09',
    difficulte: 'moyen',
    enonce: "Qu'est-ce qu'un amendement ?",
    propositions: [
      'Une modification proposée sur un texte en cours de discussion',
      "Le vote final sur l'ensemble d'un texte",
      "Le résumé officiel d'une loi",
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Il peut être déposé par un parlementaire ou par le Gouvernement, et modifie tout ou partie d'un article. Un texte peut recevoir des centaines d'amendements avant son vote final.",
    source: constitution('44'),
  },
  {
    id: 'proc-m10',
    difficulte: 'moyen',
    enonce: 'Entre un projet de loi et une proposition de loi, laquelle a statistiquement le plus de chances d\'aboutir à une loi ?',
    propositions: [
      'Le projet de loi (déposé par le Gouvernement)',
      'La proposition de loi (déposée par un parlementaire)',
      'Les deux ont exactement les mêmes chances',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Sous la XVe législature (2017-2022), 2 419 propositions de loi ont été déposées à l'Assemblée et 114 adoptées définitivement ; sur 320 projets de loi déposés ou transmis, 240 l'ont été.",
    source: {
      label: "Assemblée nationale, statistiques de la XVe législature",
      href: 'https://www2.assemblee-nationale.fr/15/statistiques-de-l-activite-parlementaire-sous-la-xve-legislature',
    },
  },
  {
    id: 'proc-m11',
    difficulte: 'moyen',
    enonce: "Qui peut saisir le Conseil constitutionnel avant la promulgation d'une loi ?",
    propositions: [
      'Le Président, le Premier ministre, les présidents des deux assemblées, ou 60 députés ou 60 sénateurs',
      "N'importe quel citoyen",
      'Uniquement le Premier ministre',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Ce contrôle, dit « a priori », intervient avant la promulgation, à la demande de l'une de ces autorités. Il complète le contrôle a posteriori (la QPC), applicable depuis 2010.",
    source: constitution('61'),
  },
  {
    id: 'proc-m12',
    difficulte: 'moyen',
    enonce: 'Qu\'est-ce que la question prioritaire de constitutionnalité (QPC) ?',
    propositions: [
      'Un recours a posteriori, ouvert à tout justiciable depuis 2010',
      'Un vote préalable réservé aux députés',
      'Une procédure réservée au Président de la République',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Créée par la révision constitutionnelle de 2008 et applicable depuis le 1er mars 2010, elle permet à une partie à un procès de soutenir qu'une loi en vigueur porte atteinte aux droits et libertés que la Constitution garantit.",
    source: {
      label: 'Assemblée nationale, fiche « Le contrôle de constitutionnalité des lois »',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/le-controle-de-constitutionnalite-des-lois',
    },
  },
  {
    id: 'proc-m13',
    difficulte: 'moyen',
    enonce:
      "Pour le redécoupage des circonscriptions législatives engagé en 2009, un député a été attribué par tranche de combien d'habitants ?",
    propositions: ['125 000', '500 000', '25 000'],
    reponseCorrecteIndex: 0,
    explication:
      "C'est la « méthode de la tranche » : un diviseur de 125 000 habitants, et un siège pour chaque fraction de ce diviseur. Le découpage précédent remontait à 1986.",
    source: {
      label: "Assemblée nationale, fiche « L'élection des députés »",
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/deputes-groupes-parlementaires/l-election-des-deputes',
    },
  },
  {
    id: 'proc-m14',
    difficulte: 'moyen',
    enonce: 'Environ combien de grands électeurs composent le collège qui élit les sénateurs ?',
    propositions: ['Environ 162 000', 'Environ 10 000', 'Environ 1 million'],
    reponseCorrecteIndex: 0,
    explication:
      "Les délégués des conseils municipaux en représentent 95 %, ce qui donne un poids important aux communes dans l'élection des sénateurs.",
    source: {
      label: "Sénat, « Mode d'élection des sénateurs »",
      href: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/mode-delection-des-senateurs.html',
    },
  },
  {
    id: 'proc-m15',
    difficulte: 'moyen',
    enonce: 'Comment le Sénat est-il renouvelé ?',
    propositions: ['Par moitié, tous les 3 ans', 'En totalité, tous les 6 ans', 'Par tiers, tous les 2 ans'],
    reponseCorrecteIndex: 0,
    explication:
      "Ce renouvellement partiel, en vigueur depuis 2011, fait que le Sénat, contrairement à l'Assemblée, n'est jamais intégralement renouvelé d'un coup.",
    source: {
      label: "Sénat, « Mode d'élection des sénateurs »",
      href: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/mode-delection-des-senateurs.html',
    },
  },
  {
    id: 'proc-m16',
    difficulte: 'moyen',
    enonce: "En combien de temps de nouvelles élections doivent-elles avoir lieu après une dissolution de l'Assemblée nationale ?",
    propositions: ['Entre 20 et 40 jours', "Dans l'année qui suit", 'Aucun délai n\'est fixé'],
    reponseCorrecteIndex: 0,
    explication:
      "La Constitution fixe ce délai : vingt jours au moins et quarante jours au plus après la dissolution. La nouvelle Assemblée se réunit de plein droit le deuxième jeudi qui suit son élection.",
    source: constitution('12'),
  },
  {
    id: 'proc-m17',
    difficulte: 'moyen',
    enonce: "Que se passe-t-il si les décrets d'application d'une loi ne sont jamais publiés ?",
    propositions: [
      'Les dispositions qui en dépendent ne peuvent pas s\'appliquer',
      "La loi s'applique quand même intégralement",
      "Le Conseil constitutionnel l'annule automatiquement",
    ],
    reponseCorrecteIndex: 0,
    explication:
      "L'entrée en vigueur des dispositions qui nécessitent des mesures d'application est reportée à celle de ces mesures. À l'Assemblée, un rapport sur l'application de la loi est présenté à la commission compétente six mois après son entrée en vigueur.",
    source: {
      label: 'Légifrance, Code civil, article 1er',
      href: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006419280',
    },
  },
  {
    id: 'proc-m18',
    difficulte: 'moyen',
    enonce: 'Quelle est la différence principale entre le PLF et le PLFSS ?',
    propositions: [
      "Le PLF budgète l'État, le PLFSS budgète la Sécurité sociale",
      "Le PLF concerne le Sénat, le PLFSS l'Assemblée",
      'Il n\'y a aucune différence, ce sont deux noms pour le même texte',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Le PLF (projet de loi de finances) fixe chaque année les ressources et les charges de l'État ; le PLFSS fixe les objectifs de dépenses de la Sécurité sociale, branche par branche, dont l'objectif national de dépenses d'assurance maladie (ONDAM). Les deux sont déposés à l'Assemblée au plus tard le premier mardi d'octobre.",
    source: {
      label: 'Assemblée nationale, fiche « L\'examen des projets de loi de financement de la sécurité sociale »',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/l-examen-parlementaire-des-projets-de-loi-de-financement-de-la-securite-sociale',
    },
  },
  {
    id: 'proc-m19',
    difficulte: 'moyen',
    enonce: "Qu'est-ce qui différencie une mission d'information d'une commission d'enquête ?",
    propositions: [
      "Elle n'a pas, en principe, de pouvoir coercitif, contrairement à la commission d'enquête",
      'Elle ne peut être créée que par le Sénat',
      'Elle aboutit toujours à une loi',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Une mission d'information procède à des auditions, mais ne peut pas obliger une personne à venir témoigner sous serment. L'Assemblée peut toutefois lui conférer les pouvoirs d'une commission d'enquête pour six mois, comme en 2020 pour la mission sur l'épidémie de Covid-19.",
    source: {
      label: "Assemblée nationale, fiche « Les commissions d'enquête »",
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/evaluation-politiques-publiques-controle-gouvernement/les-commissions-d-enquete-et-les-missions-d-information-creees-par-la-conference-des-presidents',
    },
  },
  {
    id: 'proc-m20',
    difficulte: 'moyen',
    enonce: "Qu'est-ce qu'une commission d'enquête peut faire, que ne peut pas faire une mission d'information ?",
    propositions: ['Obliger des témoins à venir déposer sous serment', 'Voter une loi directement', 'Dissoudre le Gouvernement'],
    reponseCorrecteIndex: 0,
    explication:
      "Les personnes convoquées sont tenues de venir, sous peine de sanctions pénales, et les rapporteurs peuvent se faire communiquer tout document de service, sauf ceux couverts par certains secrets (défense nationale, affaires étrangères, sécurité de l'État).",
    source: {
      label: "Assemblée nationale, fiche « Les commissions d'enquête »",
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/evaluation-politiques-publiques-controle-gouvernement/les-commissions-d-enquete-et-les-missions-d-information-creees-par-la-conference-des-presidents',
    },
  },
  {
    id: 'proc-m21',
    difficulte: 'moyen',
    enonce: 'À quoi sert un projet de loi de finances rectificative (PLFR) ?',
    propositions: [
      "Modifier le budget de l'État en cours d'année",
      "Voter le budget de l'année suivante",
      'Réviser la Constitution',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Couramment appelée « collectif budgétaire », la loi de finances rectificative modifie en cours d'exercice la loi de finances de l'année, par exemple pour tenir compte de recettes différentes des prévisions. Trois ont été adoptées entre mars et juillet 2020, face à la crise du Covid-19.",
    source: {
      label: 'Assemblée nationale, fiche « L\'examen parlementaire des lois de finances »',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/l-examen-parlementaire-des-lois-de-finances',
    },
  },
  {
    id: 'proc-m22',
    difficulte: 'moyen',
    enonce: "Qu'est-ce qu'un décret, d'un point de vue juridique ?",
    propositions: [
      'Un texte réglementaire pris par le Président ou le Premier ministre, par exemple pour préciser l\'application d\'une loi',
      'Un texte voté par les deux chambres du Parlement',
      "Un avis consultatif du Conseil d'État",
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Il ne doit pas être confondu avec la loi : le décret est pris par le pouvoir exécutif, sans vote du Parlement. Le Premier ministre exerce le pouvoir réglementaire, sous réserve des décrets signés par le Président (article 13).",
    source: constitution('21'),
  },

  // ─── Difficile (14) ─────────────────────────────────────────────────────
  {
    id: 'proc-d01',
    difficulte: 'difficile',
    enonce:
      "Faute d'accord entre l'Assemblée nationale et le Sénat sur une loi organique, quelle majorité faut-il à l'Assemblée pour l'adopter en dernière lecture ?",
    propositions: [
      'La majorité absolue de ses membres, soit 289 députés',
      'La majorité simple des votants',
      'Les deux tiers de ses membres',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Cette majorité renforcée ne s'impose qu'à l'Assemblée, en dernière lecture : pendant la navette, chaque chambre vote dans les conditions habituelles. Les lois organiques relatives au Sénat doivent, elles, être votées dans les mêmes termes par les deux chambres, et toute loi organique passe devant le Conseil constitutionnel avant sa promulgation.",
    source: constitution('46'),
  },
  {
    id: 'proc-d02',
    difficulte: 'difficile',
    enonce:
      "En procédure accélérée, combien de jours au minimum doivent séparer le dépôt d'un texte de loi organique de son examen en séance par la première assemblée saisie ?",
    propositions: ['15 jours', '48 heures', '2 mois'],
    reponseCorrecteIndex: 0,
    explication:
      "Hors procédure accélérée, le délai est de six semaines après le dépôt, comme pour une loi ordinaire (article 42). La procédure accélérée supprime ce délai pour les lois ordinaires, mais un minimum de quinze jours subsiste pour les lois organiques.",
    source: constitution('46'),
  },
  {
    id: 'proc-d03',
    difficulte: 'difficile',
    enonce: 'Comment une révision constitutionnelle est-elle définitivement adoptée, après un vote identique de l\'Assemblée et du Sénat ?',
    propositions: [
      'Par le Congrès à la majorité des 3/5, ou par référendum',
      'Par un simple décret présidentiel',
      'Par le seul vote de l\'Assemblée nationale',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "En principe, la révision doit être approuvée par référendum. Pour un projet de révision, venu de l'exécutif, le Président peut l'éviter en réunissant le Parlement en Congrès à Versailles, où le texte doit obtenir les trois cinquièmes des suffrages exprimés. Une seule révision a été adoptée par référendum selon cette procédure (article 89), en 2000 ; celle de 1962, sur l'élection du Président au suffrage universel direct, est passée par l'article 11.",
    source: {
      label: 'Assemblée nationale, fiche « La révision de la Constitution »',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/la-revision-de-la-constitution',
    },
  },
  {
    id: 'proc-d04',
    difficulte: 'difficile',
    enonce: "Qu'est-ce qu'une ordonnance (article 38 de la Constitution) ?",
    propositions: [
      "Une mesure prise par le Gouvernement dans un domaine relevant de la loi, avec l'autorisation du Parlement, à ratifier ensuite",
      'Un décret pris sans aucun contrôle du Parlement',
      'Un texte voté uniquement par le Sénat',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Prise en conseil des ministres après avis du Conseil d'État, l'ordonnance entre en vigueur dès sa publication, mais devient caduque si le projet de loi de ratification n'est pas déposé à temps. Elle ne peut être ratifiée que de manière expresse. Exemple : la réforme du Code du travail en 2017.",
    source: constitution('38'),
  },
  {
    id: 'proc-d05',
    difficulte: 'difficile',
    enonce: 'Quelle est la différence entre une « lecture définitive » et une « nouvelle lecture » ?',
    propositions: [
      "La lecture définitive est le dernier vote de l'Assemblée après l'échec de la CMP (le Sénat ne peut plus s'y opposer) ; la nouvelle lecture est une reprise d'examen après cet échec, avant ce vote final",
      'Ce sont deux noms différents pour la même étape',
      'La nouvelle lecture a toujours lieu avant la première lecture',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "La nouvelle lecture intervient juste après l'échec de la commission mixte paritaire, dans chaque chambre ; si le désaccord persiste, le Gouvernement peut alors demander à l'Assemblée de statuer définitivement.",
    source: {
      label: 'Assemblée nationale, fiche « La procédure législative »',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/la-procedure-legislative',
    },
  },
  {
    id: 'proc-d06',
    difficulte: 'difficile',
    enonce: "Qu'est-ce que la « procédure accélérée » ?",
    propositions: [
      'Une procédure qui permet de réunir une commission mixte paritaire après une seule lecture par chambre',
      'Un vote sans débat en commission',
      'Une procédure réservée aux lois de finances',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Engagée par le Gouvernement, sauf opposition conjointe des Conférences des présidents des deux assemblées, elle permet de réunir une commission mixte paritaire après une seule lecture par chambre au lieu de deux. Elle supprime aussi le délai de six semaines avant l'examen en séance, ramené à quinze jours pour les lois organiques.",
    source: constitution('45'),
  },
  {
    id: 'proc-d07',
    difficulte: 'difficile',
    enonce: 'Comment sont désignés les 9 membres du Conseil constitutionnel ?',
    propositions: [
      "3 par le Président de la République, 3 par le président de l'Assemblée nationale, 3 par le président du Sénat",
      'Élus au suffrage universel direct',
      'Nommés uniquement par le Premier ministre',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Ces nominations sont soumises à l'avis des commissions compétentes du Parlement. Le Conseil se renouvelle par tiers tous les 3 ans.",
    source: constitution('56'),
  },
  {
    id: 'proc-d08',
    difficulte: 'difficile',
    enonce: 'Qui, en plus des 9 membres nommés, siège de droit et à vie au Conseil constitutionnel ?',
    propositions: ['Les anciens Présidents de la République', 'Les anciens Premiers ministres', 'Les présidents des groupes politiques'],
    reponseCorrecteIndex: 0,
    explication:
      "Cette règle figure à l'article 56 de la Constitution, à côté des neuf membres nommés pour un mandat de neuf ans non renouvelable.",
    source: constitution('56'),
  },
  {
    id: 'proc-d09',
    difficulte: 'difficile',
    enonce: "Qu'est-ce qu'une loi organique ?",
    propositions: [
      'Un texte qui précise les modalités d\'application de la Constitution, soumis à une procédure renforcée',
      "Un texte qui ne concerne que le budget de l'État",
      'Un simple décret d\'application',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Les lois organiques précisent l'organisation et le fonctionnement des pouvoirs publics, dans les seuls domaines que la Constitution énumère. Elles suivent une procédure d'adoption particulière et passent obligatoirement devant le Conseil constitutionnel avant leur promulgation.",
    source: {
      label: 'Assemblée nationale, fiche « La loi, expression de la compétence législative du Parlement »',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/la-loi-expression-de-la-competence-legislative-du-parlement',
    },
  },
  {
    id: 'proc-d10',
    difficulte: 'difficile',
    enonce: "Qu'est-ce que l'étude d'impact accompagnant un projet de loi ?",
    propositions: [
      'Un document obligatoire qui évalue notamment les conséquences économiques, sociales et environnementales du texte',
      "Un sondage d'opinion publique sur le texte",
      "Un résumé rédigé par l'opposition",
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Imposée par la loi organique du 15 avril 2009, elle accompagne le projet dès sa transmission au Conseil d'État. Certains textes en sont dispensés, comme les projets de révision constitutionnelle ou de loi de finances.",
    source: {
      label: "Assemblée nationale, fiche « L'initiative gouvernementale »",
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/l-initiative-gouvernementale',
    },
  },
  {
    id: 'proc-d11',
    difficulte: 'difficile',
    enonce: "L'avis du Conseil d'État sur un projet de loi est-il obligatoire ?",
    propositions: ['Oui, avant son dépôt au Parlement', 'Non, il est facultatif', "Il n'existe que pour les propositions de loi"],
    reponseCorrecteIndex: 0,
    explication:
      "Cet avis, consultatif mais dont la demande est obligatoire pour tout projet de loi, porte sur la qualité juridique du texte — il ne lie toutefois pas le Gouvernement, qui reste libre de ne pas le suivre.",
    source: {
      label: "Assemblée nationale, fiche « L'initiative gouvernementale »",
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/l-initiative-gouvernementale',
    },
  },
  {
    id: 'proc-d12',
    difficulte: 'difficile',
    enonce: "Le Parlement peut-il modifier le texte d'un traité international qu'il est amené à ratifier ?",
    propositions: [
      "Non, il ne peut qu'autoriser ou refuser la ratification",
      'Oui, par amendements en séance',
      'Oui, mais seulement en commission',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "Le contenu du traité a déjà été négocié par l'exécutif avec les autres États ou organisations concernées : le Parlement ne peut qu'autoriser sa ratification par une loi, sans en modifier une seule clause.",
    source: {
      label: 'Assemblée nationale, fiche « La ratification des traités »',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/questions-europeennes-internationales/la-ratification-des-traites',
    },
  },
  {
    id: 'proc-d13',
    difficulte: 'difficile',
    enonce:
      'Qui peut destituer le Président de la République pour un manquement à ses devoirs manifestement incompatible avec l\'exercice de son mandat ?',
    propositions: [
      'Le Parlement constitué en Haute Cour',
      'Le Conseil constitutionnel',
      "Le Conseil d'État",
    ],
    reponseCorrecteIndex: 0,
    explication:
      "La destitution est votée à la majorité des deux tiers des membres de la Haute Cour. Ce n'est pas une procédure pénale : pendant son mandat, le Président ne peut pas être poursuivi devant une juridiction française, et les poursuites peuvent reprendre un mois après la fin de ses fonctions (article 67).",
    source: constitution('68'),
  },
  {
    id: 'proc-d14',
    difficulte: 'difficile',
    enonce: "Si le Gouvernement engage sa responsabilité sur un texte (article 49) et qu'aucune motion de censure n'est votée, que devient le texte ?",
    propositions: [
      'Il est considéré comme adopté, sans vote',
      "Il doit quand même être voté par l'Assemblée",
      'Il est automatiquement rejeté',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "C'est le mécanisme même de l'article 49.3 : l'absence de motion de censure votée dans les délais vaut adoption du texte.",
    source: constitution('49'),
  },
]

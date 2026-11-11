// Version anglaise du pool du quiz « Processus législatif », jumelle de
// `quiz-processus-pool.ts`.
//
// Les `id` sont les mêmes des deux côtés, et c'est ce qui fait tenir le reste :
// l'empreinte du pool, le tirage d'une partie et le détail des réponses
// enregistré ne manipulent que des `id` et des indices. Une question ajoutée
// d'un seul côté casserait donc la relecture d'un résultat après un changement
// de langue — les deux fichiers évoluent ensemble.
//
// Même convention d'auteur que le fichier français : la 1ʳᵉ proposition est
// toujours la bonne (`reponseCorrecteIndex: 0`), l'ordre étant mélangé à chaque
// partie par `drawQuizProcessusRound`.
//
// Les institutions portent le nom anglais qu'elles ont dans `en.json` et dans
// les titres traduits (National Assembly, Constitutional Council, Official
// Journal), et chaque concept la traduction unique de D-311 (MP, Speaker,
// no-confidence motion, private member's bill…). Les sigles budgétaires (PLF,
// PLFSS, PLFR) restent tels quels : ce sont eux que le lecteur retrouvera sur le
// reste du site.
//
// Les `source.href` sont ceux du fichier français, question par question : les
// pages institutionnelles n'existent qu'en français, d'où la mention « in
// French » dans chaque libellé. Seule exception, proc-f18, qui pointe une page
// de LoiClair dans la langue du lecteur.

import { constitutionHref, type QuizProcessusQuestion, type QuizProcessusSource } from '@/lib/quiz-processus-pool'

function constitution(article: string): QuizProcessusSource {
  return { label: `Constitution, article ${article} (in French)`, href: constitutionHref(article) }
}

export const QUIZ_PROCESSUS_POOL_EN: QuizProcessusQuestion[] = [
  // ─── Easy (24) ──────────────────────────────────────────────────────────
  {
    id: 'proc-f01',
    difficulte: 'facile',
    enonce: 'What is the lower house of the French Parliament called?',
    propositions: ['The National Assembly', 'The Senate', "The Council of State"],
    reponseCorrecteIndex: 0,
    explication:
      'The National Assembly has 577 members, elected by direct universal suffrage. When a disagreement with the Senate persists, the Government can give it the final say, except on constitutional laws and organic laws concerning the Senate.',
    source: {
      label: 'National Assembly fact sheet, “The National Assembly and the Senate” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/assemblee-nationale-generalites/l-assemblee-nationale-et-le-senat-caracteres-generaux-du-parlement',
    },
  },
  {
    id: 'proc-f02',
    difficulte: 'facile',
    enonce: 'How many members sit in the National Assembly?',
    propositions: ['577', '348', '925'],
    reponseCorrecteIndex: 0,
    explication:
      'The Constitution forbids having more (article 24). Although elected in a constituency, each member represents the whole Nation.',
    source: {
      label: 'National Assembly fact sheet, “The election of MPs” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/deputes-groupes-parlementaires/l-election-des-deputes',
    },
  },
  {
    id: 'proc-f03',
    difficulte: 'facile',
    enonce: 'How many senators sit in the Senate?',
    propositions: ['348', '577', '200'],
    reponseCorrecteIndex: 0,
    explication:
      'The Senate represents the territorial authorities of the Republic (municipalities, departments, regions) and has 348 members.',
    source: {
      label: 'Senate, “How senators are elected” (in French)',
      href: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/mode-delection-des-senateurs.html',
    },
  },
  {
    id: 'proc-f04',
    difficulte: 'facile',
    enonce: 'How long is an MP elected for?',
    propositions: ['5 years', '6 years', '7 years'],
    reponseCorrecteIndex: 0,
    explication:
      'The term is 5 years, but the President of the Republic can dissolve the Assembly before it ends, which triggers fresh elections.',
    source: {
      label: 'National Assembly fact sheet, “The election of MPs” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/deputes-groupes-parlementaires/l-election-des-deputes',
    },
  },
  {
    id: 'proc-f05',
    difficulte: 'facile',
    enonce: 'How long is a senator elected for?',
    propositions: ['6 years', '5 years', '9 years'],
    reponseCorrecteIndex: 0,
    explication:
      'Since 2011, half the Senate has been renewed every 3 years, so it is never replaced all at once.',
    source: {
      label: 'Senate, “How senators are elected” (in French)',
      href: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/mode-delection-des-senateurs.html',
    },
  },
  {
    id: 'proc-f06',
    difficulte: 'facile',
    enonce: 'How is the President of the Republic elected?',
    propositions: ['By direct universal suffrage', 'By indirect universal suffrage', 'Appointed by Parliament'],
    reponseCorrecteIndex: 0,
    explication:
      'The President is elected for five years by an absolute majority of votes cast, over two rounds if needed (articles 6 and 7). No one may serve more than two consecutive terms.',
    source: constitution('6'),
  },
  {
    id: 'proc-f07',
    difficulte: 'facile',
    enonce: 'How are senators elected?',
    propositions: [
      'By indirect universal suffrage, through grand électeurs',
      'By direct universal suffrage',
      'Appointed by the President of the Republic',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'The electoral college has roughly 162,000 grand électeurs: MPs, senators, regional and departmental councillors, and above all delegates of municipal councils, who make up 95% of it.',
    source: {
      label: 'Senate, “How senators are elected” (in French)',
      href: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/mode-delection-des-senateurs.html',
    },
  },
  {
    id: 'proc-f08',
    difficulte: 'facile',
    enonce: 'Who leads the Government?',
    propositions: ['The Prime Minister', 'The Speaker of the National Assembly', 'The President of the Constitutional Council'],
    reponseCorrecteIndex: 0,
    explication:
      'Appointed by the President of the Republic, the Prime Minister directs the action of the Government (article 21). It is the Government that determines and conducts the policy of the Nation (article 20).',
    source: constitution('21'),
  },
  {
    id: 'proc-f09',
    difficulte: 'facile',
    enonce: 'Who appoints the Prime Minister?',
    propositions: ['The President of the Republic', 'The National Assembly', 'The Constitutional Council'],
    reponseCorrecteIndex: 0,
    explication:
      'The other members of the Government are then appointed by the President on the Prime Minister\'s proposal. The Government remains answerable to the Assembly, which can bring it down.',
    source: constitution('8'),
  },
  {
    id: 'proc-f10',
    difficulte: 'facile',
    enonce: 'Who signs into law the bills passed by Parliament?',
    propositions: ['The President of the Republic', 'The Prime Minister', 'The Constitutional Council'],
    reponseCorrecteIndex: 0,
    explication:
      'They have 15 days to sign a bill into law; before that, they may ask Parliament to reconsider it, or refer it to the Constitutional Council.',
    source: constitution('10'),
  },
  {
    id: 'proc-f11',
    difficulte: 'facile',
    enonce: 'How long does the President have to sign a bill into law once it has passed?',
    propositions: ['15 days', '48 hours', '1 month'],
    reponseCorrecteIndex: 0,
    explication:
      'The deadline runs from the moment the finally adopted law is sent to the Government (article 10). A referral to the Constitutional Council suspends it (article 61).',
    source: constitution('10'),
  },
  {
    id: 'proc-f12',
    difficulte: 'facile',
    enonce: 'Who can dissolve the National Assembly?',
    propositions: ['The President of the Republic', 'The Prime Minister', 'The Senate'],
    reponseCorrecteIndex: 0,
    explication:
      'A power the President holds alone, used after consulting the Prime Minister, the Speaker of the National Assembly and the President of the Senate. Elections follow within 20 to 40 days, and no new dissolution is allowed in the year after those elections.',
    source: constitution('12'),
  },
  {
    id: 'proc-f13',
    difficulte: 'facile',
    enonce: 'Can the Senate be dissolved?',
    propositions: ['No, never', 'Yes, by the President', 'Yes, by the National Assembly'],
    reponseCorrecteIndex: 0,
    explication:
      'Unlike the National Assembly, the Senate cannot be dissolved. That permanence is why its President stands in if the President of the Republic resigns, dies or is incapacitated.',
    source: {
      label: 'National Assembly fact sheet, “The National Assembly and the Senate” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/assemblee-nationale-generalites/l-assemblee-nationale-et-le-senat-caracteres-generaux-du-parlement',
    },
  },
  {
    id: 'proc-f14',
    difficulte: 'facile',
    enonce: 'How many members does the Constitutional Council have?',
    propositions: ['9', '5', '15'],
    reponseCorrecteIndex: 0,
    explication:
      'Appointed for a single non-renewable 9-year term, with a third renewed every 3 years. Former Presidents of the Republic are members ex officio for life.',
    source: constitution('56'),
  },
  {
    id: 'proc-f15',
    difficulte: 'facile',
    enonce: 'What is the main role of the Constitutional Council?',
    propositions: ['Checking that laws comply with the Constitution', 'Voting the State budget', 'Appointing ministers'],
    reponseCorrecteIndex: 0,
    explication:
      'When a law is referred to it before being signed, it checks that the law complies with the Constitution; this review is mandatory for organic laws. A provision found unconstitutional can be neither signed into law nor applied (article 62).',
    source: constitution('61'),
  },
  {
    id: 'proc-f16',
    difficulte: 'facile',
    enonce: 'Where is a law published once signed?',
    propositions: ['In the Official Journal', 'On the National Assembly website', 'In a decree'],
    reponseCorrecteIndex: 0,
    explication:
      'A law takes effect on the date it sets or, failing that, the day after its publication in the Official Journal.',
    source: {
      label: 'Légifrance, Civil Code, article 1 (in French)',
      href: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006419280',
    },
  },
  {
    id: 'proc-f17',
    difficulte: 'facile',
    enonce: 'Who can table a government bill (projet de loi)?',
    propositions: ['The Government', 'A citizen, through a petition', 'A judge'],
    reponseCorrecteIndex: 0,
    explication:
      'As opposed to a "proposition de loi", tabled by a member of Parliament. A government bill is discussed in the Council of Ministers after the Council of State has given its opinion.',
    source: constitution('39'),
  },
  {
    id: 'proc-f18',
    difficulte: 'facile',
    enonce: 'How many stages does a bill typically go through, as LoiClair presents it?',
    propositions: ['8', '5', '3'],
    reponseCorrecteIndex: 0,
    explication:
      'Tabling, committee, floor debate, shuttle and joint committee, final vote, constitutional review, signature, then implementing decrees.',
    source: { label: 'LoiClair, “The path of a law”', href: '/en/processus-legislatif' },
  },
  {
    id: 'proc-f19',
    difficulte: 'facile',
    enonce: 'Who writes the implementing decrees of a law?',
    propositions: ['The Government', 'The Constitutional Council', 'The Speaker of the National Assembly'],
    reponseCorrecteIndex: 0,
    explication:
      'The Prime Minister ensures that laws are carried out and holds regulatory power. Without those decrees, the parts of a law that need them do not take effect, even once it has been signed.',
    source: constitution('21'),
  },
  {
    id: 'proc-f20',
    difficulte: 'facile',
    enonce: "Who can table a private member's bill (proposition de loi)?",
    propositions: ['An MP or a senator', 'The Government', 'A citizen, through a petition'],
    reponseCorrecteIndex: 0,
    explication:
      "Unlike a government bill, tabled by the Government, a private member's bill comes from a member of Parliament. Some texts remain reserved to the Government, such as budget bills.",
    source: {
      label: 'National Assembly fact sheet, “Parliamentary initiative” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/l-initiative-parlementaire',
    },
  },
  {
    id: 'proc-f21',
    difficulte: 'facile',
    enonce: 'Does a resolution passed by Parliament have the force of law?',
    propositions: [
      'No, it states a position with no legislative force',
      'Yes, like an ordinary law',
      'Only if the President signs it',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'Through a resolution, a chamber gives its opinion on a given question. It cannot contain instructions to the Government (article 34-1 of the Constitution).',
    source: {
      label: 'National Assembly fact sheet, “Resolutions under article 34-1” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/evaluation-politiques-publiques-controle-gouvernement/les-resolutions-de-l-article-34-1-de-la-constitution',
    },
  },
  {
    id: 'proc-f22',
    difficulte: 'facile',
    enonce: 'Can a petition to Parliament become law directly?',
    propositions: [
      'No, it can be examined in committee but has no force of law',
      'Yes, automatically once it gathers enough signatures',
      'Yes, if the President approves it',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'At the Assembly, it is sent to a committee, which can either shelve it or examine it. Once signed by more than 500,000 people in at least 30 departments or overseas territories, it can also be debated on the floor.',
    source: {
      label: 'National Assembly, “The path of a petition” (in French)',
      href: 'https://petitions.assemblee-nationale.fr/pages/parcours_petition',
    },
  },
  {
    id: 'proc-f23',
    difficulte: 'facile',
    enonce: 'Does a decree have to be voted by Parliament?',
    propositions: ['No, it never goes through Parliament', 'Yes, like an ordinary law', 'Yes, but only in the Senate'],
    reponseCorrecteIndex: 0,
    explication:
      'Unlike a law, a decree is a regulatory text issued by the executive alone (the President or the Prime Minister).',
    source: constitution('21'),
  },
  {
    id: 'proc-f24',
    difficulte: 'facile',
    enonce: 'What does a committee of inquiry produce at the end of its work?',
    propositions: ['A report, but not a law', 'Automatically a bill', 'An implementing decree'],
    reponseCorrecteIndex: 0,
    explication:
      'It can compel people to testify under oath and obtain documents, but its work ends when it tables its report, at most six months after it was set up.',
    source: {
      label: 'National Assembly fact sheet, “Committees of inquiry” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/evaluation-politiques-publiques-controle-gouvernement/les-commissions-d-enquete-et-les-missions-d-information-creees-par-la-conference-des-presidents',
    },
  },

  // ─── Medium (22) ────────────────────────────────────────────────────────
  {
    id: 'proc-m01',
    difficulte: 'moyen',
    enonce:
      "According to the National Assembly, what share of the laws adopted during the 15th legislature (2017-2022), excluding international agreements, came from private members' bills?",
    propositions: ['More than 45%', 'Less than 10%', 'Around 20%'],
    reponseCorrecteIndex: 0,
    explication:
      "For a long time, about 80% of laws adopted, excluding agreements, came from government bills. Since the 2008 revision shared the agenda between the Government and the chambers, the share of private members' bills has risen from over 30% in the 13th legislature to over 45% in the 15th.",
    source: {
      label: 'National Assembly fact sheet, “Parliamentary initiative” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/l-initiative-parlementaire',
    },
  },
  {
    id: 'proc-m02',
    difficulte: 'moyen',
    enonce: 'What is a no-confidence motion?',
    propositions: [
      'A procedure through which the Assembly can bring down the Government',
      'A text that repeals a law already in force',
      'An appeal lodged with the Constitutional Council',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'If a majority of all members of the Assembly votes for it, the Prime Minister must hand the Government\'s resignation to the President of the Republic (article 50).',
    source: constitution('49'),
  },
  {
    id: 'proc-m03',
    difficulte: 'moyen',
    enonce: 'How many members must sign for a no-confidence motion to be tabled?',
    propositions: ['At least a tenth of the members', 'An absolute majority of the members', 'A single member is enough'],
    reponseCorrecteIndex: 0,
    explication:
      'That is at least 58 signatures out of 577. To pass, the motion then needs a majority of all members of the Assembly. Apart from motions answering a 49.3, an MP may not sign more than three per ordinary session.',
    source: constitution('49'),
  },
  {
    id: 'proc-m04',
    difficulte: 'moyen',
    enonce: 'What does article 49.3 of the Constitution allow?',
    propositions: ['Passing a text without a vote, unless a no-confidence motion succeeds', 'Dissolving the Senate', 'Calling a referendum'],
    reponseCorrecteIndex: 0,
    explication:
      'The Prime Minister stakes the Government on a text: it counts as passed unless a no-confidence motion, tabled within 24 hours, is carried. The procedure applies to the State and social security budgets, and to one other text per session.',
    source: constitution('49'),
  },
  {
    id: 'proc-m05',
    difficulte: 'moyen',
    enonce: 'When the National Assembly and the Senate keep disagreeing, who has the final say in most cases?',
    propositions: ['The National Assembly', 'The Senate', 'The Constitutional Council'],
    reponseCorrecteIndex: 0,
    explication:
      'If the joint committee fails, the Government can, after a new reading in each chamber, ask the Assembly to rule definitively.',
    source: constitution('45'),
  },
  {
    id: 'proc-m06',
    difficulte: 'moyen',
    enonce: 'On which texts does the Senate hold power equal to the Assembly, with no final say possible for the latter?',
    propositions: [
      'Constitutional laws and organic laws concerning the Senate',
      'The annual State budget',
      'European resolutions',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'On those texts both chambers must agree: the Assembly cannot override the Senate, unlike in the ordinary legislative procedure.',
    source: {
      label: 'National Assembly fact sheet, “The National Assembly and the Senate” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/assemblee-nationale-generalites/l-assemblee-nationale-et-le-senat-caracteres-generaux-du-parlement',
    },
  },
  {
    id: 'proc-m07',
    difficulte: 'moyen',
    enonce: 'How many members sit on a joint committee (Commission Mixte Paritaire, CMP)?',
    propositions: ['7 MPs and 7 senators', '10 MPs and 10 senators', '5 MPs and 5 senators'],
    reponseCorrecteIndex: 0,
    explication:
      'Those 14 parliamentarians look for a compromise text between the two chambers; if they find one, the Government can submit it to the Assembly and the Senate for approval.',
    source: {
      label: 'Senate, “The joint committee” (in French)',
      href: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/la-commission-mixte-paritaire.html',
    },
  },
  {
    id: 'proc-m08',
    difficulte: 'moyen',
    enonce: 'What is the "shuttle and joint committee" stage for?',
    propositions: ['Reconciling the text between the Assembly and the Senate', 'Getting the President to sign', 'Informing citizens about the text'],
    reponseCorrecteIndex: 0,
    explication:
      'The text moves back and forth between the Assembly and the Senate until they agree on an identical version, or until a joint committee finds a compromise.',
    source: {
      label: 'National Assembly fact sheet, “The legislative procedure” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/la-procedure-legislative',
    },
  },
  {
    id: 'proc-m09',
    difficulte: 'moyen',
    enonce: 'What is an amendment?',
    propositions: [
      'A change proposed to a text under discussion',
      'The final vote on a text as a whole',
      'The official summary of a law',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'It can be tabled by a parliamentarian or by the Government, and changes all or part of an article. A text can attract hundreds of amendments before its final vote.',
    source: constitution('44'),
  },
  {
    id: 'proc-m10',
    difficulte: 'moyen',
    enonce: 'Between a government bill and a private member\'s bill, which is statistically more likely to become law?',
    propositions: [
      'The government bill (projet de loi)',
      "The private member's bill (proposition de loi)",
      'Both have exactly the same odds',
    ],
    reponseCorrecteIndex: 0,
    explication:
      "During the 15th legislature (2017-2022), 2,419 private members' bills were tabled at the Assembly and 114 finally adopted; of 320 government bills tabled or transmitted, 240 were.",
    source: {
      label: 'National Assembly, statistics for the 15th legislature (in French)',
      href: 'https://www2.assemblee-nationale.fr/15/statistiques-de-l-activite-parlementaire-sous-la-xve-legislature',
    },
  },
  {
    id: 'proc-m11',
    difficulte: 'moyen',
    enonce: 'Who can refer a bill to the Constitutional Council before it is signed into law?',
    propositions: [
      'The President, the Prime Minister, the Speaker of the National Assembly, the President of the Senate, or 60 MPs or 60 senators',
      'Any citizen',
      'The Prime Minister only',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'This "a priori" review happens before signature, at the request of one of those authorities. It sits alongside the after-the-fact review (the QPC), available since 2010.',
    source: constitution('61'),
  },
  {
    id: 'proc-m12',
    difficulte: 'moyen',
    enonce: 'What is a priority preliminary ruling on constitutionality (QPC)?',
    propositions: [
      'An after-the-fact challenge, open to any litigant since 2010',
      'A preliminary vote reserved for MPs',
      'A procedure reserved for the President of the Republic',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'Created by the 2008 constitutional revision and available since 1 March 2010, it lets a party to a court case argue that a law in force infringes the rights and freedoms guaranteed by the Constitution.',
    source: {
      label: 'National Assembly fact sheet, “Constitutional review of laws” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/le-controle-de-constitutionnalite-des-lois',
    },
  },
  {
    id: 'proc-m13',
    difficulte: 'moyen',
    enonce:
      'In the redrawing of legislative constituencies launched in 2009, one seat was allotted for every block of how many inhabitants?',
    propositions: ['125,000', '500,000', '25,000'],
    reponseCorrecteIndex: 0,
    explication:
      'This is the "block method": a divisor of 125,000 inhabitants, and one seat for each fraction of that divisor. The previous map dated back to 1986.',
    source: {
      label: 'National Assembly fact sheet, “The election of MPs” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/deputes-groupes-parlementaires/l-election-des-deputes',
    },
  },
  {
    id: 'proc-m14',
    difficulte: 'moyen',
    enonce: 'Roughly how many grand électeurs make up the college that elects senators?',
    propositions: ['About 162,000', 'About 10,000', 'About 1 million'],
    reponseCorrecteIndex: 0,
    explication:
      'Delegates from municipal councils make up 95% of it, which gives municipalities considerable weight in Senate elections.',
    source: {
      label: 'Senate, “How senators are elected” (in French)',
      href: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/mode-delection-des-senateurs.html',
    },
  },
  {
    id: 'proc-m15',
    difficulte: 'moyen',
    enonce: 'How is the Senate renewed?',
    propositions: ['Half of it, every 3 years', 'All of it, every 6 years', 'A third of it, every 2 years'],
    reponseCorrecteIndex: 0,
    explication:
      'Because of this partial renewal, in place since 2011, the Senate, unlike the Assembly, is never replaced in one go.',
    source: {
      label: 'Senate, “How senators are elected” (in French)',
      href: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/mode-delection-des-senateurs.html',
    },
  },
  {
    id: 'proc-m16',
    difficulte: 'moyen',
    enonce: 'How soon must fresh elections be held after the National Assembly is dissolved?',
    propositions: ['Between 20 and 40 days', 'Within the following year', 'No deadline is set'],
    reponseCorrecteIndex: 0,
    explication:
      'The Constitution sets the window: no less than twenty and no more than forty days after the dissolution. The new Assembly meets as of right on the second Thursday after its election.',
    source: constitution('12'),
  },
  {
    id: 'proc-m17',
    difficulte: 'moyen',
    enonce: 'What happens if the implementing decrees of a law are never published?',
    propositions: [
      'The provisions that depend on them cannot apply',
      'The law applies in full anyway',
      'The Constitutional Council strikes it down automatically',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'Provisions that need implementing measures only take effect once those measures do. At the Assembly, a report on how the law is applied is presented to the relevant committee six months after it takes effect.',
    source: {
      label: 'Légifrance, Civil Code, article 1 (in French)',
      href: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006419280',
    },
  },
  {
    id: 'proc-m18',
    difficulte: 'moyen',
    enonce: 'What is the main difference between the PLF and the PLFSS?',
    propositions: [
      'The PLF budgets the State, the PLFSS budgets social security',
      'The PLF concerns the Senate, the PLFSS the Assembly',
      'There is no difference, they are two names for the same text',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'The PLF (annual budget bill) sets the State\'s revenue and spending each year; the PLFSS sets social security spending targets branch by branch, including the national health insurance spending target (ONDAM). Both are tabled at the Assembly by the first Tuesday of October.',
    source: {
      label: 'National Assembly fact sheet, “Examination of social security financing bills” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/l-examen-parlementaire-des-projets-de-loi-de-financement-de-la-securite-sociale',
    },
  },
  {
    id: 'proc-m19',
    difficulte: 'moyen',
    enonce: 'What sets a fact-finding mission apart from a committee of inquiry?',
    propositions: [
      'As a rule, it has no coercive power, unlike a committee of inquiry',
      'It can only be set up by the Senate',
      'It always ends in a law',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'A fact-finding mission holds hearings, but cannot compel anyone to testify under oath. The Assembly can, however, grant it the powers of a committee of inquiry for six months, as it did in 2020 for the mission on the Covid-19 epidemic.',
    source: {
      label: 'National Assembly fact sheet, “Committees of inquiry” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/evaluation-politiques-publiques-controle-gouvernement/les-commissions-d-enquete-et-les-missions-d-information-creees-par-la-conference-des-presidents',
    },
  },
  {
    id: 'proc-m20',
    difficulte: 'moyen',
    enonce: 'What can a committee of inquiry do that a fact-finding mission cannot?',
    propositions: ['Compel witnesses to testify under oath', 'Pass a law directly', 'Bring down the Government'],
    reponseCorrecteIndex: 0,
    explication:
      'People summoned must appear, on pain of criminal penalties, and the rapporteurs can obtain any official document, except those covered by certain secrets (national defence, foreign affairs, State security).',
    source: {
      label: 'National Assembly fact sheet, “Committees of inquiry” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/evaluation-politiques-publiques-controle-gouvernement/les-commissions-d-enquete-et-les-missions-d-information-creees-par-la-conference-des-presidents',
    },
  },
  {
    id: 'proc-m21',
    difficulte: 'moyen',
    enonce: 'What is a supplementary budget bill (PLFR) for?',
    propositions: [
      'Adjusting the State budget during the year',
      "Voting the following year's budget",
      'Amending the Constitution',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'Often called a "collectif budgétaire", a supplementary budget law amends the year\'s budget law during the year, for instance to reflect revenue that differs from forecasts. Three were adopted between March and July 2020, in response to the Covid-19 crisis.',
    source: {
      label: 'National Assembly fact sheet, “Parliamentary examination of budget bills” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/l-examen-parlementaire-des-lois-de-finances',
    },
  },
  {
    id: 'proc-m22',
    difficulte: 'moyen',
    enonce: 'In legal terms, what is a decree?',
    propositions: [
      'A regulatory text issued by the President or the Prime Minister, for instance to spell out how a law applies',
      'A text voted by both chambers of Parliament',
      "An advisory opinion of the Council of State",
    ],
    reponseCorrecteIndex: 0,
    explication:
      'It should not be confused with a law: a decree comes from the executive, with no vote in Parliament. The Prime Minister holds regulatory power, subject to the decrees signed by the President (article 13).',
    source: constitution('21'),
  },

  // ─── Hard (14) ──────────────────────────────────────────────────────────
  {
    id: 'proc-d01',
    difficulte: 'difficile',
    enonce:
      'When the National Assembly and the Senate cannot agree on an organic law, what majority does the Assembly need to adopt it at the last reading?',
    propositions: [
      'An absolute majority of its members, that is 289',
      'A simple majority of those voting',
      'Two thirds of its members',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'This stricter majority only applies to the Assembly, at the last reading: during the shuttle, each chamber votes under the usual rules. Organic laws concerning the Senate, however, must be passed in identical terms by both chambers, and every organic law goes before the Constitutional Council before it is signed.',
    source: constitution('46'),
  },
  {
    id: 'proc-d02',
    difficulte: 'difficile',
    enonce:
      'Under the fast-track procedure, how many days at minimum must pass between tabling an organic bill and its floor debate in the first chamber?',
    propositions: ['15 days', '48 hours', '2 months'],
    reponseCorrecteIndex: 0,
    explication:
      'Without the fast-track procedure, the delay is six weeks after tabling, as for an ordinary law (article 42). Fast-tracking removes that delay for ordinary laws, but a minimum of fifteen days remains for organic laws.',
    source: constitution('46'),
  },
  {
    id: 'proc-d03',
    difficulte: 'difficile',
    enonce: 'Once the Assembly and the Senate have voted an identical text, how is a constitutional amendment finally adopted?',
    propositions: [
      'By the Congress at a three-fifths majority, or by referendum',
      'By a simple presidential decree',
      'By a vote of the National Assembly alone',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'As a rule, the revision must be approved by referendum. For a revision initiated by the executive, the President can avoid this by convening Parliament in Congress at Versailles, where the text needs three fifths of the votes cast. Only one revision has been adopted by referendum under this procedure (article 89), in 2000; the 1962 one, on electing the President by direct universal suffrage, went through article 11.',
    source: {
      label: 'National Assembly fact sheet, “Revising the Constitution” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/la-revision-de-la-constitution',
    },
  },
  {
    id: 'proc-d04',
    difficulte: 'difficile',
    enonce: 'What is an ordonnance (article 38 of the Constitution)?',
    propositions: [
      'A measure taken by the Government in an area normally reserved to law, with the authorisation of Parliament, to be ratified afterwards',
      'A decree issued with no oversight from Parliament at all',
      'A text voted by the Senate alone',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'Adopted in the Council of Ministers after the Council of State has given its opinion, an ordonnance takes effect on publication, but lapses if the ratification bill is not tabled in time. It can only be ratified expressly. Example: the 2017 labour law reform.',
    source: constitution('38'),
  },
  {
    id: 'proc-d05',
    difficulte: 'difficile',
    enonce: 'What is the difference between a "final reading" and a "new reading"?',
    propositions: [
      'The final reading is the last vote of the Assembly after the joint committee fails (the Senate can no longer object); the new reading is the fresh examination that follows that failure, before that final vote',
      'They are two names for the same stage',
      'A new reading always comes before the first reading',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'A new reading happens in each chamber right after the joint committee fails; if the disagreement persists, the Government can then ask the Assembly to rule definitively.',
    source: {
      label: 'National Assembly fact sheet, “The legislative procedure” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/la-procedure-legislative',
    },
  },
  {
    id: 'proc-d06',
    difficulte: 'difficile',
    enonce: 'What is the "fast-track procedure"?',
    propositions: [
      'A procedure that allows a joint committee to be convened after a single reading per chamber',
      'A vote with no committee debate',
      'A procedure reserved for budget bills',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'Triggered by the Government, unless the Conferences of Presidents of both chambers jointly object, it allows a joint committee to be convened after one reading per chamber instead of two. It also removes the six-week delay before the floor debate, cut to fifteen days for organic laws.',
    source: constitution('45'),
  },
  {
    id: 'proc-d07',
    difficulte: 'difficile',
    enonce: 'How are the 9 members of the Constitutional Council appointed?',
    propositions: [
      '3 by the President of the Republic, 3 by the Speaker of the National Assembly, 3 by the President of the Senate',
      'Elected by direct universal suffrage',
      'Appointed by the Prime Minister alone',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'These appointments are subject to the opinion of the relevant parliamentary committees. A third of the Council is renewed every 3 years.',
    source: constitution('56'),
  },
  {
    id: 'proc-d08',
    difficulte: 'difficile',
    enonce: 'Besides the 9 appointed members, who sits on the Constitutional Council ex officio and for life?',
    propositions: ['Former Presidents of the Republic', 'Former Prime Ministers', 'The leaders of the political groups'],
    reponseCorrecteIndex: 0,
    explication:
      'The rule is set out in article 56 of the Constitution, alongside the nine members appointed for a single nine-year term.',
    source: constitution('56'),
  },
  {
    id: 'proc-d09',
    difficulte: 'difficile',
    enonce: 'What is an organic law?',
    propositions: [
      'A text that spells out how the Constitution applies, subject to a reinforced procedure',
      'A text that only concerns the State budget',
      'A plain implementing decree',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'Organic laws spell out how public authorities are organised and run, only in the areas the Constitution lists. They follow a specific adoption procedure and must go before the Constitutional Council before they are signed.',
    source: {
      label: 'National Assembly fact sheet, “Law, the expression of Parliament\'s legislative power” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/la-loi-expression-de-la-competence-legislative-du-parlement',
    },
  },
  {
    id: 'proc-d10',
    difficulte: 'difficile',
    enonce: 'What is the impact assessment attached to a government bill?',
    propositions: [
      'A mandatory document assessing, among other things, the economic, social and environmental consequences of the text',
      'An opinion poll on the text',
      'A summary written by the opposition',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'Required by the organic law of 15 April 2009, it accompanies the bill as soon as it is sent to the Council of State. Some texts are exempt, such as constitutional revision bills and budget bills.',
    source: {
      label: 'National Assembly fact sheet, “Government initiative” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/l-initiative-gouvernementale',
    },
  },
  {
    id: 'proc-d11',
    difficulte: 'difficile',
    enonce: "Is the opinion of the Council of State on a government bill mandatory?",
    propositions: ['Yes, before it is tabled in Parliament', 'No, it is optional', "It only exists for private members' bills"],
    reponseCorrecteIndex: 0,
    explication:
      'The opinion is advisory, but requesting it is mandatory for every government bill. It covers the legal quality of the text, and does not bind the Government, which remains free to disregard it.',
    source: {
      label: 'National Assembly fact sheet, “Government initiative” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/l-initiative-gouvernementale',
    },
  },
  {
    id: 'proc-d12',
    difficulte: 'difficile',
    enonce: 'Can Parliament change the text of an international treaty it is asked to ratify?',
    propositions: [
      'No, it can only authorise or refuse ratification',
      'Yes, through amendments on the floor',
      'Yes, but only in committee',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'The content of the treaty has already been negotiated by the executive with the other states or bodies involved: Parliament can only authorise its ratification through a law, without changing a single clause.',
    source: {
      label: 'National Assembly fact sheet, “Ratification of treaties” (in French)',
      href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/questions-europeennes-internationales/la-ratification-des-traites',
    },
  },
  {
    id: 'proc-d13',
    difficulte: 'difficile',
    enonce:
      'Who can remove the President of the Republic from office for a breach of duty manifestly incompatible with the exercise of the mandate?',
    propositions: [
      'Parliament, sitting as the High Court',
      'The Constitutional Council',
      "The Council of State",
    ],
    reponseCorrecteIndex: 0,
    explication:
      'Removal requires a two-thirds majority of the members of the High Court. It is not a criminal procedure: during the term, the President cannot be prosecuted before any French court, and proceedings can resume one month after the term ends (article 67).',
    source: constitution('68'),
  },
  {
    id: 'proc-d14',
    difficulte: 'difficile',
    enonce: 'If the Government stakes itself on a text (article 49) and the Assembly does not pass a no-confidence motion, what becomes of the text?',
    propositions: [
      'It counts as passed, with no vote',
      'It still has to be voted by the Assembly',
      'It is automatically rejected',
    ],
    reponseCorrecteIndex: 0,
    explication:
      'That is the very mechanism of article 49.3: if the Assembly does not pass a no-confidence motion in time, the text is adopted.',
    source: constitution('49'),
  },
]

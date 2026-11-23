// Les codes d'actes (`actes_legislatifs.code_acte`) qui comptent comme une étape franchie
// par un texte : dépôts, décisions des chambres, décision du Conseil constitutionnel,
// promulgation, premier décret d'application. Liste unique, lue par l'outil
// `actualite_parlementaire` du serveur MCP (`lib/mcp/chiffres.ts`) et par « Les lois dans
// l'actualité » de l'accueil (`lib/landing-queries.ts`), pour qu'un texte « actif » y ait
// le même sens.

/**
 * Les actes qui méritent d'être rapportés comme une étape franchie.
 *
 * Les dépôts et les décisions reprennent les familles que `/Facts/delais` suit
 * déjà sur cette table, lectures uniques et navettes comprises : la liste tenue
 * à la main ratait la lecture unique, qui pèse 112 actes sur 2026, davantage que
 * les dépôts du Sénat sur la même période.
 *
 * `PROM-PUB` et non `PROM` : les 148 lignes `PROM` n'ont aucune date, quand son
 * jumeau les porte toutes. Comme les bornes filtrent sur `date_acte`, aucune
 * promulgation ne pouvait sortir d'un outil qui les annonce. `Month/monthQueries.ts`
 * et `api/newsletter/_context.ts` utilisent déjà la forme datée.
 *
 * `DECAPP-PUB` complète la fin du parcours, 114 actes sur 2026 : la promulgation
 * n'est pas le dernier mot d'une loi qui attend ses décrets.
 */
export const ACTES_MARQUANTS = [
  'AN1-DEPOT', 'AN2-DEPOT', 'ANLDEF-DEPOT', 'ANLUNI-DEPOT', 'ANNLEC-DEPOT',
  'AN1-DEBATS-DEC', 'AN2-DEBATS-DEC', 'ANLDEF-DEBATS-DEC', 'ANLUNI-DEBATS-DEC', 'ANNLEC-DEBATS-DEC',
  'CMP-DEBATS-AN-DEC',
  'SN1-DEPOT', 'SN2-DEPOT', 'SNNLEC-DEPOT',
  'SN1-DEBATS-DEC', 'SN2-DEBATS-DEC', 'SNNLEC-DEBATS-DEC',
  'CMP-DEBATS-SN-DEC',
  'CC-CONCLUSION',
  'PROM-PUB',
  'DECAPP-PUB',
];

// src/lib/db.ts
// Client Postgres unique du site (postgres.js), côté serveur seulement : pages,
// routes d'API, bibliothèques de `src/lib`. Aucun composant navigateur ne doit
// l'importer, il porte le mot de passe de la base.
//
// La base est un Postgres nu (D-325). Règle du projet : chaque requête rend des
// dates en texte et des nombres en `number`, ce qu'attendent les appelants, d'où le
// réglage des types ci-dessous. Les lignes sont typées à la main dans tout le code, donc ni
// `typecheck` ni `lint` ne verraient une date devenue objet `Date` : un
// `.slice(0, 10)` casserait sans erreur, à l'exécution.

import postgres, { type PostgresType } from 'postgres';

/**
 * Lit une variable de connexion, sans le `\n` qu'un copier-coller depuis un
 * terminal laisse parfois en fin de valeur (voir la règle des en-têtes HTTP
 * du CLAUDE.md : le même parasite y a fait tomber toutes les routes POST).
 */
function variable(nom: string): string | undefined {
  const v = process.env[nom]?.trim();
  return v ? v : undefined;
}

/**
 * `PGSSLMODE` au sens de libpq, traduit pour postgres.js. Absent : `require`, comme
 * les scripts Python. Les workflows passent `disable`, le tunnel SSH chiffrant déjà.
 */
function modeSsl(mode: string | undefined): false | 'require' | 'prefer' | 'verify-full' {
  switch (mode ?? 'require') {
    case 'disable': return false;
    case 'allow':
    case 'prefer': return 'prefer';
    case 'verify-ca':
    case 'verify-full': return 'verify-full';
    default: return 'require';
  }
}

/**
 * Horodatage avec fuseau au format qu'attendent les appelants : `T` entre la date
 * et l'heure, décalage en `+00:00`, ramené à UTC.
 *
 * Postgres l'écrit en texte au fuseau de la session (`2026-11-05 08:18:27.66+00`).
 * Le ramener ici à UTC rend la même chaîne quel que soit le réglage du serveur.
 * Les fractions de seconde sont gardées telles quelles.
 * `infinity` et les dates avant J.-C. passent inchangées.
 */
function horodatageUtc(x: string): string {
  const m = /^(\d{4,}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?([+-]\d{2})(?::(\d{2}))?(?::(\d{2}))?$/.exec(x);
  if (!m) return x;
  const [, jour, heure, fraction = '', hh, mm = '00', ss = '00'] = m;
  if (hh === '+00' && mm === '00' && ss === '00') return `${jour}T${heure}${fraction}+00:00`;
  const decalage = (hh[0] === '-' ? -1 : 1) * (Math.abs(Number(hh)) * 3600 + Number(mm) * 60 + Number(ss));
  const utc = new Date(Date.parse(`${jour}T${heure}Z`) - decalage * 1000).toISOString().slice(0, 19);
  return `${utc}${fraction}+00:00`;
}

/**
 * Types réglés pour rendre ce qu'attendent les appelants :
 * - `date` (1082) en texte `2026-11-05` ; `timestamp` (1114) en texte avec `T` ;
 *   `timestamptz` (1184) par `horodatageUtc`. postgres.js rend sinon des `Date`.
 * - `int8` (20) et `numeric` (1700) en nombres. postgres.js les rend sinon en
 *   texte : un `count(*)` vaudrait `'12'`, et
 *   `'12' + 1` donne `'121'`.
 * Les tableaux de ces types (`date[]`, `int8[]`…) suivent seuls : postgres.js
 * analyse chaque élément avec le parseur de son type.
 *
 * `serialize` ne change rien à l'écriture : postgres.js exige le champ, et il
 * reproduit ce que le pilote fait déjà pour ces types (une `Date` en ISO, le
 * reste en texte).
 */
const ecrireDate = (x: unknown) => (x instanceof Date ? x.toISOString() : String(x));
const typesLus: Record<string, PostgresType> = {
  date: { to: 1082, from: [1082], serialize: ecrireDate, parse: (x: string) => x },
  horodatage: { to: 1114, from: [1114], serialize: ecrireDate, parse: (x: string) => x.replace(' ', 'T') },
  horodatageFuseau: { to: 1184, from: [1184], serialize: ecrireDate, parse: horodatageUtc },
  nombres: {
    to: 20,
    from: [20, 1700],
    serialize: (x: unknown) => String(x),
    parse: (x: string) => Number(x),
  },
};

function creerClient() {
  const host = variable('PGHOST');
  const password = variable('PGPASSWORD');
  // Sans hôte, postgres.js se rabat sur localhost : mieux vaut échouer tout de suite.
  if (!host || !password) throw new Error('Variables de connexion Postgres manquantes (PGHOST, PGPASSWORD)');

  return postgres({
    host,
    port: Number(variable('PGPORT') ?? 5432),
    database: variable('PGDATABASE') ?? 'postgres',
    username: variable('PGUSER') ?? 'postgres',
    password,
    ssl: modeSsl(variable('PGSSLMODE')),
    // Une requête à la fois par connexion. postgres.js en enchaîne sinon jusqu'à
    // 100 sans attendre les réponses (pipelining), et Postgres les traite dans
    // l'ordre : une requête lente ferait attendre celles qui la suivent sur sa
    // connexion, alors qu'une autre connexion du pool est peut-être libre.
    max_pipeline: 1,
    // Six connexions pour tout le site : en production, un seul processus Node
    // porte toutes les requêtes, sur un serveur de 2 cœurs dont Postgres accepte 100
    // clients. Chaque processus de `next build` ouvre aussi son propre pool. Choisi
    // sans mesure sous charge : la répétition de la bascule a tenu avec 3.
    max: 6,
    idle_timeout: 20,
    connect_timeout: 10,
    types: typesLus,
    onnotice: false,
  });
}

// Un seul client par processus. En développement, le rechargement à chaud
// réévalue ce module : sans le ranger sur `globalThis`, chaque sauvegarde
// ouvrirait un nouveau pool sans fermer l'ancien.
const globalPourDb = globalThis as unknown as { __loiclairSql?: ReturnType<typeof creerClient> };
export const sql = globalPourDb.__loiclairSql ?? creerClient();
if (process.env.NODE_ENV !== 'production') globalPourDb.__loiclairSql = sql;

/**
 * Rend la seule ligne d'une requête, ou `null` si elle n'en rend aucune.
 * Lève si elle en rend plusieurs. Une absence (`null`, donc un `notFound()` en
 * aval) reste distincte d'une panne, qui lève avant d'arriver ici (D-136).
 *
 * @param quoi table ou lecture concernée, pour que le message dise laquelle.
 */
export async function auPlusUneLigne<T>(requete: PromiseLike<readonly T[]>, quoi: string): Promise<T | null> {
  const lignes = await requete;
  if (lignes.length > 1) throw new Error(`Lecture ${quoi} : ${lignes.length} lignes, une au plus attendue`);
  return lignes[0] ?? null;
}

/**
 * Rend la seule ligne d'une requête, et lève si elle en rend zéro ou plusieurs.
 * Pour une lecture dont l'absence est un cas normal, utiliser `auPlusUneLigne`.
 */
export async function uneLigne<T>(requete: PromiseLike<readonly T[]>, quoi: string): Promise<T> {
  const lignes = await requete;
  if (lignes.length !== 1) throw new Error(`Lecture ${quoi} : ${lignes.length} lignes, une seule attendue`);
  return lignes[0];
}

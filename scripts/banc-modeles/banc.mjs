// Banc d'essai, étape 1 sur 3 : générer les résumés de loi à comparer.
//
// Chaque candidat résume chaque texte avec EXACTEMENT le prompt, le schéma et les
// paramètres de la prod (lus dans src/lib/prompts.ts et src/lib/ai-schemas.ts),
// via Mammouth. Seuls le modèle et, s'il est précisé, le niveau de raisonnement
// changent. Le coût de chaque appel est lu dans la facture renvoyée par Mammouth
// (en-tête x-litellm-response-cost), pas estimé.
//
// Écrit resultats/resumes.json au fil de l'eau et reprend là où il s'est arrêté :
// un résumé déjà produit n'est jamais regénéré. Les plus chers passent en
// dernier, et le script s'arrête avant de dépasser le plafond de dépense.
// Le fichier porte l'empreinte des consignes qui l'ont produit : si le prompt,
// le schéma ou les réglages ont changé depuis, le script refuse de le compléter,
// car il mettrait côte à côte des résumés écrits sous deux consignes différentes.
//
// Lancer depuis la racine du dépôt :   node scripts/banc-modeles/banc.mjs <plafond en $>
// Prérequis : MAMMOUTH_API_KEY et les variables PG* de connexion dans .env.local.
// `jiti` (qui lit le TypeScript de prompts.ts) vient avec Tailwind et ESLint.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

// ── Configuration ────────────────────────────────────────────────────────────
// [uid du texte dans la table `textes`, langue du résumé]
const TEXTES = [
  ['DECRET_JORFTEXT000053743425', 'fr'], ['LOI20251251-VC', 'fr'], ['LOI2025793', 'fr'], ['LOI20251129-VC', 'fr'], ['LOI2026201', 'fr'],
  ['LOI2026247', 'fr'], ['LOI2025989', 'fr'],
  ['DECRET_JORFTEXT000053422608', 'en'], ['DECRET_JORFTEXT000053958631', 'en'], ['LOI2026796-VC', 'en'],
];
// « modele@effort » force un niveau de raisonnement autre que celui de la prod ;
// « modele@thinking » impose un budget de réflexion (Claude) : sur un résumé de
// loi, Opus et Sonnet décident sinon de ne pas réfléchir du tout, même en
// « medium » (0 jeton de raisonnement mesuré), alors que les GPT réfléchissent.
// « modele#2 » est un second tirage du même réglage, pour mesurer la stabilité.
// Rangés du moins cher au plus cher : si le plafond coupe, ce sont les derniers qui manquent.
const CANDIDATS = [
  'gpt-6-luna', 'gpt-6-luna@medium', 'gpt-6-luna#2', 'gpt-6-luna@medium#2', 'grok-4.3', 'grok-4.3#2',
  'gpt-6-sol', 'gpt-6-sol#2', 'grok-4.7', 'gemini-3.1-pro-preview', 'claude-sonnet-5@medium', 'claude-opus-5-5', 'gpt-6-astra',
  'claude-sonnet-5@thinking', 'claude-opus-5-5@thinking',
];
// ─────────────────────────────────────────────────────────────────────────────

const REPO = new URL('../../', import.meta.url).pathname;
const SORTIE = new URL('resultats/resumes.json', import.meta.url).pathname;
const require = createRequire(REPO + 'package.json');
const { createJiti } = require('jiti');
const env = Object.fromEntries(
  readFileSync(REPO + '.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
    .map(([, k, v]) => [k, v.trim().replace(/^"|"$/g, '')]),
);
// `src/lib/db.ts` lit sa connexion dans process.env : on lui passe les PG*.
for (const [k, v] of Object.entries(env)) if (k.startsWith('PG')) process.env[k] ??= v;
const KEY = env.MAMMOUTH_API_KEY;
const PLAFOND = Number(process.argv[2]);
if (!(PLAFOND > 0)) throw new Error('Plafond de dépense obligatoire, en dollars : node scripts/banc-modeles/banc.mjs 3');

const jiti = createJiti(import.meta.url);
const P = await jiti.import(REPO + 'src/lib/prompts.ts');
const { SCHEMA_RESUME_LOI } = await jiti.import(REPO + 'src/lib/ai-schemas.ts');

// Tout ce que le banc envoie à un candidat, hors texte source et modèle. Pas
// PROMPT_VERSION_RESUME_LOI : elle contient aussi le modèle de prod, et un
// changement de modèle refuserait à tort des résultats encore valables.
// classement.py publie le raisonnement comme réglage de la mesure ; la température
// n'est plus publiée, elle ne sert qu'à l'empreinte et à la trace dans resumes.json.
const reglages = {
  temperature: P.PARAMS_RESUME_LOI.temperature,
  raisonnement: P.PARAMS_RESUME_LOI.reasoningEffort,
  empreinte: createHash('md5').update(JSON.stringify([
    P.getSystemPrompt('fr'), P.getSystemPrompt('en'), P.getUserPromptTemplate('fr'), P.getUserPromptTemplate('en'),
    P.ETAPE_RESUME_LOI, SCHEMA_RESUME_LOI, P.PARAMS_RESUME_LOI.temperature, P.PARAMS_RESUME_LOI.reasoningEffort,
  ])).digest('hex').slice(0, 8),
};
// Vérifié avant le premier appel, payant ou non.
const precedent = existsSync(SORTIE) ? JSON.parse(readFileSync(SORTIE, 'utf8')) : null;
if (precedent && precedent.reglages?.empreinte !== reglages.empreinte) {
  throw new Error(`resultats/resumes.json a été produit avec d'autres consignes (empreinte ${precedent.reglages?.empreinte ?? 'absente'}, `
    + `actuelle ${reglages.empreinte}) : l'archiver dans un sous-dossier de resultats/ ou le supprimer, avec notes.json, avant de relancer.`);
}

const depenseCle = async () => (await (await fetch('https://api.mammouth.ai/key/info', { headers: { Authorization: `Bearer ${KEY}` } })).json()).info.spend;
const depart = await depenseCle();

// Textes et étape de procédure, préparés comme le fait api/resume-loi/route.ts.
// Les textes choisis tiennent tous en un seul appel (pas de découpage en morceaux).
// Même client et mêmes requêtes que la route, pour que l'étape décrite soit la même.
const { sql } = await jiti.import(REPO + 'src/lib/db.ts');
const rows = await sql`
  select uid, dossier_ref, chambre, type_libelle, statut_adoption, contenu_legifrance, titre_principal_court, denomination
  from textes where uid = any(${TEXTES.map(([u]) => u)})`;
const textes = [];
for (const [uid, locale] of TEXTES) {
  const row = rows.find((r) => r.uid === uid);
  let codes = [];
  if (row.dossier_ref) {
    const actes = await sql`
      select code_acte from actes_legislatifs
      where dossier_uid = ${row.dossier_ref}
        and (textes_associes @> ${[row.uid]}::text[] or texte_adopte = ${row.uid})
      order by date_acte, uid`;
    codes = actes.map((a) => a.code_acte);
  }
  const titre = row.titre_principal_court || row.denomination || 'Titre inconnu';
  const etape = P.decrireEtapeResumeLoi(locale, { codesActes: codes, chambre: row.chambre, type: row.type_libelle, statutAdoption: row.statut_adoption });
  textes.push({
    uid, locale, titre, n: row.contenu_legifrance.length,
    system: P.getSystemPrompt(locale),
    user: P.remplirGabarit(P.getUserPromptTemplate(locale), { etape_texte: etape, titre_texte: titre, texteComplet: row.contenu_legifrance }),
  });
}
// La base ne sert plus : sans cette fermeture, le pool garderait le processus ouvert.
await sql.end();

async function resumer(candidat, t) {
  const [modele, effort] = candidat.split('#')[0].split('@');
  const t0 = Date.now();
  const res = await fetch('https://api.mammouth.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modele,
      messages: [{ role: 'system', content: t.system }, { role: 'user', content: t.user }],
      temperature: P.PARAMS_RESUME_LOI.temperature,
      // Au-dessus des 2 200 de la prod : un modèle qui raisonne longtemps ne doit
      // pas être coupé avant d'avoir répondu. Aucun n'a dépassé 4 000 au banc.
      max_tokens: 8000,
      ...(effort === 'thinking'
        ? { thinking: { type: 'enabled', budget_tokens: 2000 } }
        : { reasoning_effort: effort || P.PARAMS_RESUME_LOI.reasoningEffort }),
      response_format: { type: 'json_schema', json_schema: { name: 'resume_loi', strict: true, schema: SCHEMA_RESUME_LOI } },
    }),
    signal: AbortSignal.timeout(280_000),
  });
  const ms = Date.now() - t0;
  const brut = await res.text();
  const cout = Number(res.headers.get('x-litellm-response-cost') ?? NaN);
  if (!res.ok) return { ok: false, statut: res.status, erreur: brut.slice(0, 600), ms, cout };
  const j = JSON.parse(brut);
  const contenu = j.choices?.[0]?.message?.content ?? '';
  let objet = null;
  try { objet = JSON.parse(contenu.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* reste null : compté comme échec */ }
  return { ok: true, ms, cout, objet, brut: objet ? undefined : contenu.slice(0, 1500), fin: j.choices?.[0]?.finish_reason, usage: j.usage };
}

const resultats = {};
for (const c of CANDIDATS) {
  resultats[c] = textes.map((t) => {
    const i = precedent?.textes.findIndex((x) => x.uid === t.uid && x.locale === t.locale) ?? -1;
    return i >= 0 ? precedent.resultats[c]?.[i] ?? null : null;
  });
}
const sauver = () => writeFileSync(SORTIE, JSON.stringify({
  reglages, modeles: CANDIDATS, textes: textes.map(({ uid, locale, titre, n }) => ({ uid, locale, titre, n })), resultats,
}, null, 1));

for (const c of CANDIDATS) {
  const manquants = textes.map((t, i) => i).filter((i) => !resultats[c][i]?.objet);
  if (!manquants.length) continue;
  if ((await depenseCle()) - depart >= PLAFOND) { console.log(`Plafond atteint : ${c} et les suivants ne sont pas lancés.`); break; }
  const rs = await Promise.all(manquants.map((i) => resumer(c, textes[i]).catch((e) => ({ ok: false, erreur: String(e) }))));
  manquants.forEach((i, k) => { resultats[c][i] = rs[k]; });
  sauver();
  console.log(c, rs.map((r) => (r.objet ? 'ok' : `KO ${r.statut ?? ''}`)).join(' '), `${rs.reduce((s, r) => s + (r.cout || 0), 0).toFixed(3)} $`);
}
sauver();
console.log(`Dépense de ce lancement : ${((await depenseCle()) - depart).toFixed(3)} $ (la facture de la clé se met à jour en différé).`);

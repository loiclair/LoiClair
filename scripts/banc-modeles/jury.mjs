// Banc d'essai, étape 2 sur 3 : faire noter les résumés par un jury d'IA.
//
// Chaque correcteur reçoit, texte par texte, le texte source officiel et les
// résumés qu'il doit noter, sous des lettres tirées au hasard : il ne sait pas
// quel modèle a écrit quoi. Il note selon grille.md (5 critères de 1 à 10,
// erreurs factuelles relevées avec leur gravité).
//
// Un correcteur ne note jamais un modèle de sa propre famille. Les résumés que
// deux correcteurs notent en commun servent à les recaler sur la même échelle
// (voir classement.py), d'où le rôle de gpt-6-sol et de grok-4.7 : ils ne
// comptent que pour les Claude, mais notent aussi des modèles déjà notés par
// Opus, pour se caler sur son échelle.
//
// Écrit resultats/notes.json au fil de l'eau ; une note déjà acquise n'est
// jamais redemandée. S'arrête avant de dépasser le plafond de dépense.
// Chaque note porte l'empreinte de la grille qui l'a produite : si grille.md a
// changé depuis, le script refuse de compléter notes.json, et classement.py
// refuse de publier une grille autre que celle du jury.
//
// Lancer depuis la racine du dépôt :   node scripts/banc-modeles/jury.mjs <plafond en $>
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

// ── Configuration ────────────────────────────────────────────────────────────
const famille = (m) => (m.startsWith('claude') ? 'anthropic' : m.startsWith('gemini') ? 'google' : m.startsWith('gpt') ? 'openai' : m.startsWith('grok') ? 'xai' : m);
// Qui note quoi. `marge` : coût maximal d'un lot de 5 textes, pour ne pas lancer
// un lot qui ferait dépasser le plafond.
const JURY = [
  { juge: 'gemini-3.1-pro-preview', note: (m) => !['google', 'anthropic'].includes(famille(m)), marge: 0.3 },
  { juge: 'claude-opus-5-5', note: (m) => famille(m) !== 'anthropic', marge: 0.6 },
  { juge: 'gpt-6-sol', note: (m) => ['anthropic', 'xai', 'google'].includes(famille(m)), marge: 0.3 },
  // Second correcteur des Claude. Gemini Pro et GPT-6 Sol, déjà notés par Opus,
  // ne servent qu'à le recaler sur l'échelle d'Opus.
  // `parAppel` : au-delà de 4 résumés par appel, grok-4.7 dépasse les 100 s après
  // lesquelles Mammouth coupe la requête (HTTP 524). Le reste passe au lancement suivant.
  { juge: 'grok-4.7', note: (m) => famille(m) === 'anthropic' || ['gemini-3.1-pro-preview', 'gpt-6-sol'].includes(m), marge: 0.4, parAppel: 4 },
];
// ─────────────────────────────────────────────────────────────────────────────

const ICI = new URL('.', import.meta.url).pathname;
const REPO = new URL('../../', import.meta.url).pathname;
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
if (!(PLAFOND > 0)) throw new Error('Plafond de dépense obligatoire, en dollars : node scripts/banc-modeles/jury.mjs 2');

const GRILLE = readFileSync(ICI + 'grille.md', 'utf8');
const d = JSON.parse(readFileSync(ICI + 'resultats/resumes.json', 'utf8'));
const NOTES = ICI + 'resultats/notes.json';
const notes = existsSync(NOTES) ? JSON.parse(readFileSync(NOTES, 'utf8')) : [];
// Même calcul que classement.py (md5 des octets UTF-8, 8 caractères).
const EMPREINTE_GRILLE = createHash('md5').update(GRILLE).digest('hex').slice(0, 8);
const autresGrilles = [...new Set(notes.map((j) => j.grille ?? 'absente'))].filter((g) => g !== EMPREINTE_GRILLE);
if (autresGrilles.length) {
  throw new Error(`resultats/notes.json contient des notes données avec une autre grille (${autresGrilles.join(', ')}, actuelle ${EMPREINTE_GRILLE}) : `
    + `l'archiver dans un sous-dossier de resultats/ ou le supprimer avant de relancer.`);
}
const acquis = new Set(notes.flatMap((j) => (j.notes || []).map((n) => `${j.juge}|${j.uid}|${j.lettres[n.lettre]}`)));

const { sql } = await createJiti(import.meta.url).import(REPO + 'src/lib/db.ts');
const sources = await sql`select uid, contenu_legifrance from textes where uid = any(${d.textes.map((t) => t.uid)})`;
// La base ne sert plus : sans cette fermeture, le pool garderait le processus ouvert.
await sql.end();

const note = { type: 'integer' };
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['notes'],
  properties: { notes: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['lettre', 'exactitude', 'completude', 'neutralite', 'clarte', 'exemples', 'erreurs', 'commentaire'],
    properties: {
      lettre: { type: 'string' }, exactitude: note, completude: note, neutralite: note, clarte: note, exemples: note,
      erreurs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['citation', 'correction', 'gravite'],
        properties: { citation: { type: 'string' }, correction: { type: 'string' }, gravite: { type: 'string', enum: ['grave', 'mineure'] } } } },
      commentaire: { type: 'string' },
    } } } },
};

const LETTRES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
async function juger({ juge, note: doitNoter, parAppel }, i) {
  const t = d.textes[i];
  const candidats = d.modeles
    .filter((m) => d.resultats[m][i]?.objet && doitNoter(m.split(/[@#]/)[0]) && !acquis.has(`${juge}|${t.uid}|${m}`))
    .sort(() => Math.random() - 0.5)
    .slice(0, parAppel ?? Infinity);
  if (!candidats.length) return null;
  const lettres = Object.fromEntries(candidats.map((m, j) => [LETTRES[j], m]));
  const resumes = candidats.map((m, j) => `## Résumé ${LETTRES[j]}\n\n${JSON.stringify(d.resultats[m][i].objet, null, 1)}`).join('\n\n');
  const user = `# Texte source : ${t.titre}\n\n${sources.find((s) => s.uid === t.uid).contenu_legifrance}\n\n` +
    `# Résumés à noter (${candidats.length}, en ${t.locale === 'en' ? 'anglais' : 'français'})\n\n${resumes}\n\n` +
    `Rends une entrée par résumé, lettres ${Object.keys(lettres).join(', ')}. Commentaire en français, une phrase de 25 mots au plus.`;
  const res = await fetch('https://api.mammouth.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: juge, messages: [{ role: 'system', content: GRILLE }, { role: 'user', content: user }],
      max_tokens: 24000, reasoning_effort: 'low',
      response_format: { type: 'json_schema', json_schema: { name: 'notes', strict: true, schema: SCHEMA } },
    }),
    signal: AbortSignal.timeout(600_000),
  });
  const brut = await res.text();
  const cout = Number(res.headers.get('x-litellm-response-cost') ?? NaN);
  if (!res.ok) throw new Error(`${juge} ${t.uid} HTTP ${res.status} ${brut.startsWith('<') ? '(page HTML)' : brut.slice(0, 300)}`);
  const rendu = JSON.parse(JSON.parse(brut).choices[0].message.content.replace(/^```(?:json)?\s*|\s*```$/g, '')).notes;
  const manque = Object.keys(lettres).filter((l) => !rendu.some((n) => n.lettre === l));
  console.log(juge, t.uid, `${cout.toFixed(3)} $`, `${candidats.length} résumés`, manque.length ? `MANQUE ${manque}` : '');
  return { juge, uid: t.uid, grille: EMPREINTE_GRILLE, cout, lettres, notes: rendu };
}

const depenseCle = async () => (await (await fetch('https://api.mammouth.ai/key/info', { headers: { Authorization: `Bearer ${KEY}` } })).json()).info.spend;
const depart = await depenseCle();
const lots = [];
for (let i = 0; i < d.textes.length; i += 5) lots.push(d.textes.slice(i, i + 5).map((_, k) => i + k));
for (const correcteur of JURY) {
  for (const lot of lots) {
    const depense = (await depenseCle()) - depart;
    if (depense + correcteur.marge > PLAFOND) { console.log(`Plafond : ${correcteur.juge}, textes ${lot[0]}+ non lancés.`); continue; }
    const rs = await Promise.all(lot.map((i) => juger(correcteur, i).catch((e) => ({ erreur: String(e) }))));
    for (const r of rs.filter(Boolean)) {
      if (r.erreur) console.log('ÉCHEC', r.erreur);
      else notes.push(r);
    }
    writeFileSync(NOTES, JSON.stringify(notes, null, 1));
  }
}
console.log(`Dépense de ce lancement : ${((await depenseCle()) - depart).toFixed(3)} $`);

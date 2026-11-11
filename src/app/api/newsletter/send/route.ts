// Envoi hebdomadaire de la newsletter : contexte de la semaine, texte IA, gabarit
// HTML (`buildEmailHtml`) et broadcast Resend. Appelée par le workflow
// `newsletter.yml` ; un corps `{ test_email }` n'envoie qu'à cette adresse.
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { generateObject, jsonSchema } from 'ai'
import { sql } from '@/lib/db'
import { modeleIA, optionsIA } from '@/lib/ai-provider'
import { PROMPT_RESUME_SEMAINE, NEWSLETTER_MODEL_PARAMS, MODEL_NEWSLETTER } from '@/lib/prompts'
import { SCHEMA_NEWSLETTER, type ParagrapheNewsletter, type ResumeSemaineIa } from '@/lib/ai-schemas'
import { avecReprises, DELAIS_REPRISE_CRON, REPRISES_SDK_DESACTIVEES } from '@/lib/ai-retry'
import { cleResend, clientResend, donneesOuLeve, envoyerAlerteBestEffort, EXPEDITEUR_NEWSLETTER, TIMEOUT_RESEND_MS } from '@/lib/emails'
import { buildWeekContext, premierDuMois, type VoteHebdo, type DossierLumiere, type WeekContext } from '../_context'
import { affichageScrutin, type PositionScrutin } from '@/lib/scrutin-affichage'
import type { TopActiviteElu } from '@/lib/activite-queries'
import { ASSOCIATION } from '@/lib/association'
import { echapperHtml } from '@/lib/echapper-html'
// La lettre n'existe qu'en français : les libellés des profils se lisent dans le
// catalogue de traduction plutôt que par `getTranslations`, sans locale à résoudre.
import messagesFr from '@/messages/fr.json'

// Calcule lundi–dimanche de la semaine précédente
function getPreviousWeek(): { weekStart: Date; weekEnd: Date } {
  const now = new Date()
  const dayOfWeek = now.getUTCDay()
  const daysToLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const lastMonday = new Date(now)
  lastMonday.setUTCDate(now.getUTCDate() - daysToLastMonday - 7)
  lastMonday.setUTCHours(0, 0, 0, 0)
  const lastSunday = new Date(lastMonday)
  lastSunday.setUTCDate(lastMonday.getUTCDate() + 6)
  lastSunday.setUTCHours(23, 59, 59, 999)
  return { weekStart: lastMonday, weekEnd: lastSunday }
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

const SCHEMA = jsonSchema<ResumeSemaineIa>(SCHEMA_NEWSLETTER)

/**
 * « code message » d'une erreur de base, pour les alertes et le journal. `sql`
 * lève une `PostgresError` dont `.code` porte le SQLSTATE (ou un code du pilote,
 * `CONNECT_TIMEOUT` par exemple, pour une panne de connexion).
 */
function decrireErreur(err: unknown): string {
  const e = err as { code?: string; message?: string }
  return `${e?.code} ${e?.message ?? String(err)}`
}

// Strip défensif : le prompt interdit les comptages de mots, mais c'est le seul
// des quatre pipelines dont l'échec est irrattrapable : l'e-mail part à tous les
// abonnés et ne se rattrape pas.
const sansComptage = (s: string) => s.replace(/\*?\(\d+\s*mots\)\*?/gi, '').trim()

async function genererResumeSemaine(prompt: string): Promise<ResumeSemaineIa> {
  const { object } = await avecReprises(() => generateObject({
    model: modeleIA(MODEL_NEWSLETTER),
    schema: SCHEMA,
    prompt,
    ...NEWSLETTER_MODEL_PARAMS,
    ...REPRISES_SDK_DESACTIVEES,
    providerOptions: optionsIA(NEWSLETTER_MODEL_PARAMS.reasoningEffort),
  }), DELAIS_REPRISE_CRON)
  const paragraphes = (items: ParagrapheNewsletter[]) =>
    items.map(p => ({ titre: sansComptage(p.titre), corps: sansComptage(p.corps) }))
  return {
    resume: sansComptage(object.resume),
    application: paragraphes(object.application),
    decisions: paragraphes(object.decisions),
    depots: paragraphes(object.depots),
    publications: paragraphes(object.publications),
  }
}

/**
 * Ajoute à l'audience les abonnés confirmés qui n'y sont pas, et rejoue les
 * désabonnements que Resend avait refusés.
 *
 * Les deux réparations vivent au même endroit parce qu'elles ont la même fenêtre
 * utile : juste avant le broadcast, seul instant où appartenir ou non à l'audience
 * a une conséquence. Délai de réparation maximal, sept jours, pendant lesquels un
 * abonné ne rate rien puisque la lettre est hebdomadaire.
 *
 * Ne bloque jamais l'envoi : les échecs sont agrégés dans UNE alerte. Une adresse
 * qui ne passe pas ne doit pas priver les autres de leur lettre.
 *
 * `POST /audiences/{id}/contacts` est idempotent, vérifié le 2026-09-09 sur un
 * contact déjà présent : il rend 201 et l'identifiant existant, pas un doublon.
 * Pas besoin d'un `GET` de repli.
 */
async function rattraperAudience(audienceId: string, weekLabel: string): Promise<void> {
  const echecs: string[] = []

  // Une lecture en échec rejoint les échecs et la boucle part à vide : le rattrapage
  // ne bloque jamais l'envoi.
  let absents: { id: string; email: string }[] = []
  try {
    absents = await sql<{ id: string; email: string }[]>`
      select id, email
      from newsletter_subscribers
      where confirmed = true
        and resend_contact_id is null
        and desabonnement_demande_le is null`
  } catch (err) {
    echecs.push(`lecture des absents : ${decrireErreur(err)}`)
  }

  for (const abonne of absents) {
    try {
      const reponse = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cleResend()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: abonne.email, unsubscribed: false }),
        signal: AbortSignal.timeout(TIMEOUT_RESEND_MS),
      })
      if (!reponse.ok) throw new Error(`${reponse.status} ${(await reponse.text()).slice(0, 200)}`)
      const { id } = await reponse.json()
      if (id) {
        // L'échec d'écriture doit finir dans l'alerte, préfixé pour le distinguer
        // d'un refus Resend. Sans ça, le contact serait créé chez Resend et la base
        // l'ignorerait, donc on reposterait chaque lundi sans jamais converger.
        try {
          await sql`update newsletter_subscribers set resend_contact_id = ${id} where id = ${abonne.id}`
        } catch (err) {
          throw new Error(`id non écrit : ${decrireErreur(err)}`)
        }
      }
    } catch (err) {
      echecs.push(`ajout de ${abonne.email} : ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  let aDesabonner: { id: string; email: string; resend_contact_id: string | null }[] = []
  try {
    aDesabonner = await sql<{ id: string; email: string; resend_contact_id: string | null }[]>`
      select id, email, resend_contact_id
      from newsletter_subscribers
      where desabonnement_demande_le is not null`
  } catch (err) {
    echecs.push(`lecture des désabonnements : ${decrireErreur(err)}`)
  }

  for (const abonne of aDesabonner) {
    const identifiant = abonne.resend_contact_id || encodeURIComponent(abonne.email)
    try {
      const reponse = await fetch(`https://api.resend.com/contacts/${identifiant}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${cleResend()}` },
        signal: AbortSignal.timeout(TIMEOUT_RESEND_MS),
      })
      // 404 vaut succès : le contact n'existe plus, l'objectif est atteint. Sans
      // ça, on marquerait des lignes que rien ne pourrait plus jamais nettoyer.
      if (!reponse.ok && reponse.status !== 404) throw new Error(`${reponse.status}`)
      // Même précaution : un `delete` qui échoue laisserait la ligne marquée, donc
      // une suppression retentée chaque semaine sur un contact déjà supprimé.
      try {
        await sql`delete from newsletter_subscribers where id = ${abonne.id}`
      } catch (err) {
        throw new Error(`ligne non supprimée : ${decrireErreur(err)}`)
      }
    } catch (err) {
      echecs.push(`désabonnement de ${abonne.email} : ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (echecs.length > 0) {
    await envoyerAlerteBestEffort(
      '[ALERTE] Rattrapage audience newsletter incomplet',
      `<p>Avant l'envoi de la lettre du ${weekLabel}, ces réparations ont échoué :</p><ul>`
      + echecs.map(e => `<li>${echapperHtml(e)}</li>`).join('')
      + `</ul><p>La lettre est partie quand même aux abonnés déjà présents dans l'audience.</p>`,
    )
  }
}

/**
 * Un bloc de texte, sauts de ligne compris.
 *
 * Le `<br>` par ligne n'est pas décoratif : HTML replie tout espace blanc, donc
 * un `\n` du modèle disparaîtrait purement et simplement et deux paragraphes
 * partiraient collés dans l'e-mail. Le prompt demande un paragraphe par entrée
 * mais n'interdit que le markdown, pas les retours à la ligne.
 */
function texteEnHtml(text: string): string {
  if (!text) return ''
  return text
    .split('\n')
    .map(ligne => (ligne.trim() === '' ? '' : `<span style="line-height:1.5;color:#44403c;font-size:15px;">${echapperHtml(ligne)}</span>`))
    .join('<br>') + '<br>'
}

/** Le résumé d'ouverture : un bloc libre, sans titre. */
function formatTexteHtml(text: string): string {
  return texteEnHtml(text)
}

/** Une section thématique : un titre carré coloré, puis son paragraphe. */
function formatSectionHtml(items: ParagrapheNewsletter[], accentColor: string): string {
  return items
    .map(({ titre, corps }) => {
      const avecPoint = /[.!?…]$/.test(titre) ? titre : `${titre}.`
      return `<h3 style="font-size:20px;font-weight:800;color:#1c1917;line-height:1.4;letter-spacing:-0.015em;margin:24px 0 10px;"><span style="color:${accentColor};margin-right:8px;">&#9632;</span>${echapperHtml(avecPoint)}</h3>`
        + texteEnHtml(corps)
    })
    .join('')
}

// Or de la rubrique « Qui est concerné. » : l'Or Doux de `BRAND_ID.md` (#D4A54A),
// foncé pour le texte du bouton sur fond blanc. Contraste de 3,2 pour 1 au lieu de
// 2,3 : mieux que les boutons cyan et ambre de la lettre, mais sous les 4,5 que le
// WCAG demande pour un texte de 14 px.
const OR_CONCERNE = '#b8862f'
const LIBELLES_PROFILS: Record<string, string> = messagesFr.ceQuiMeConcerne.profils

/**
 * Rubrique « Qui est concerné. » : les profils les plus touchés par les textes de la
 * semaine, sans lien ni titre de texte, puis un bouton vers « Ce qui me concerne ».
 * Une ligne dit combien d'autres profils sont touchés, sans quoi le lecteur ne sait
 * pas si la liste est complète. La lettre part identique à tous (Broadcast) et le
 * serveur ne connaît pas les profils du lecteur (D-243) : c'est le site qui filtre
 * ensuite pour lui. Toujours rendue, y compris sans profil touché, avec sa phrase de
 * cas vide.
 */
function renderProfilsSemaine(profils: string[], nbTouches: number, siteUrl: string): string {
  const vide = profils.length === 0
  const nbAutres = nbTouches - profils.length
  const autres = nbAutres > 1 ? `Et ${nbAutres} autres situations touchées cette semaine.`
    : nbAutres === 1 ? 'Et une autre situation touchée cette semaine.' : ''
  const intro = vide
    ? `<strong style="color:#292524;">Aucun texte de cette semaine ne touche directement une situation de citoyen.</strong> Décrivez la vôtre sur le site : chaque fiche vous dira ce qui change pour vous.`
    : `<strong style="color:#292524;">Les situations les plus touchées par les textes de la semaine,</strong> classées par nombre de textes. Décrivez la vôtre sur le site : chaque fiche vous dira ce qui change pour vous.`
  // Même puce carrée et même titre que les paragraphes des autres rubriques
  // (`formatSectionHtml`).
  const liste = profils
    .map(id => `<h3 style="font-size:20px;font-weight:800;color:#1c1917;line-height:1.4;letter-spacing:-0.015em;margin:24px 0 6px;"><span style="color:${OR_CONCERNE};margin-right:8px;">&#9632;</span>${echapperHtml(LIBELLES_PROFILS[id] ?? id)}.</h3>`)
    .join('')
  return `
    <!-- Qui est concerné -->
    <div style="padding:44px 32px;">
      <h2 style="font-size:30px;font-weight:800;color:#1c1917;line-height:1.1;letter-spacing:-0.02em;margin:0 0 16px;">Qui est concerné.</h2>
      <p style="font-size:15px;color:#44403c;margin:0 0 24px;line-height:1.5;">${intro}</p>
      ${vide ? '' : `<div style="margin:0 0 16px;">${liste}${autres ? `<p style="font-size:15px;color:#78716c;margin:24px 0 0;line-height:1.5;">${autres}</p>` : ''}</div>`}
      <p style="font-size:11px;color:#a8a29e;margin:0;">&#10022; Classé par IA · <a href="${siteUrl}/documentation/prompts-ia#concerne" style="color:#a8a29e;text-decoration:underline;">Notre méthode</a></p>
      <div style="margin-top:20px;">
        <a href="${siteUrl}/ce-qui-me-concerne" style="display:inline-block;padding:8px 18px;background:transparent;color:${OR_CONCERNE};border:2px solid ${OR_CONCERNE};border-radius:9999px;text-decoration:none;font-weight:600;font-size:14px;">Voir ce qui me concerne &#8594;</a>
      </div>
    </div>`
}

// Couleur de chaque segment de la barre. Quels segments sont dessinés, et dans quel
// ordre, c'est `affichageScrutin` qui le décide : sur une motion de censure, seulement
// « pour » et « non recensés ».
const COULEUR_SEGMENT: Record<PositionScrutin, string> = {
  pour: '#16a34a',
  contre: '#dc2626',
  abstentions: '#a8a29e',
  nonVotants: '#d6d3d1',
  absents: '#ede9e4',
  nonRecenses: '#ede9e4',
}

/**
 * Bloc « Vote en lumière » de l'email : titre, barre, chiffres, participation.
 *
 * Passe par `affichageScrutin()`, comme les barres du site : c'est ce qui garantit
 * qu'une motion de censure ne se lise pas ici comme un vote ordinaire aux 0 contre et
 * 0 abstentions, alors que la Constitution n'y fait recenser que les voix favorables.
 */
function renderVoteBlock(v: VoteHebdo, voteLink: string): string {
  const a = affichageScrutin(v.chiffres)

  const arrondis = a.segments
    .map(s => ({ w: Math.round(s.valeur / a.total * 100), bg: COULEUR_SEGMENT[s.cle] }))
    .filter(s => s.w > 0)

  // Rattrapage d'arrondi pour que la barre fasse 100 %. Il peut ramener le dernier
  // segment à zéro : on refiltre, sinon le coin arrondi de droite atterrit sur une
  // cellule invisible.
  const sum = arrondis.reduce((acc, s) => acc + s.w, 0)
  if (arrondis.length > 0 && sum !== 100) arrondis[arrondis.length - 1].w += 100 - sum
  const barSegments = arrondis.filter(s => s.w > 0)

  // Les chiffres affichés sortent des mêmes segments que la barre : recalculer
  // « absents » ou « non recensés » ici rouvrirait la règle que porte affichageScrutin.
  const valeurSegment = (cle: PositionScrutin) => a.segments.find(s => s.cle === cle)?.valeur ?? 0

  const barCells = barSegments
    .map((s, i) => {
      const radius = [
        i === 0 ? '4px' : '0',
        i === barSegments.length - 1 ? '4px' : '0',
        i === barSegments.length - 1 ? '4px' : '0',
        i === 0 ? '4px' : '0',
      ].join(' ')
      return `<td width="${s.w}%" style="padding:0;"><div style="background:${s.bg};height:10px;border-radius:${radius};"></div></td>`
    })
    .join('')

  const chiffresCells = a.estMotionCensure
    ? `
    <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;table-layout:fixed;margin-bottom:10px;">
      <tr>
        <td width="50%" style="text-align:center;border-right:1px solid #ede9e4;padding:0 6px 10px 0;">
          <div style="font-size:20px;font-weight:700;color:#16a34a;line-height:1.1;">${v.chiffres.pour}</div>
          <div style="font-size:10px;color:#16a34a;text-transform:uppercase;letter-spacing:0.05em;margin-top:3px;">Pour</div>
        </td>
        <td width="50%" style="text-align:center;padding:0 0 10px 6px;">
          <div style="font-size:20px;font-weight:700;color:#a8a29e;line-height:1.1;">${valeurSegment('nonRecenses')}</div>
          <div style="font-size:10px;color:#a8a29e;text-transform:uppercase;letter-spacing:0.04em;margin-top:3px;">Non recensés</div>
        </td>
      </tr>
    </table>
    <p style="font-size:12px;color:#78716c;margin:0 0 30px;text-align:center;">Seuls les votes favorables à une motion de censure sont recensés : les autres positions ne sont pas enregistrées.</p>`
    : `
    <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;table-layout:fixed;">
      <tr>
        <td width="33%" style="text-align:center;border-right:1px solid #ede9e4;border-bottom:1px solid #ede9e4;padding:0 6px 10px 0;">
          <div style="font-size:20px;font-weight:700;color:#16a34a;line-height:1.1;">${v.chiffres.pour}</div>
          <div style="font-size:10px;color:#16a34a;text-transform:uppercase;letter-spacing:0.05em;margin-top:3px;">Pour</div>
        </td>
        <td width="33%" style="text-align:center;border-right:1px solid #ede9e4;border-bottom:1px solid #ede9e4;padding:0 6px 10px;">
          <div style="font-size:20px;font-weight:700;color:#dc2626;line-height:1.1;">${v.chiffres.contre}</div>
          <div style="font-size:10px;color:#dc2626;text-transform:uppercase;letter-spacing:0.05em;margin-top:3px;">Contre</div>
        </td>
        <td width="34%" style="text-align:center;border-bottom:1px solid #ede9e4;padding:0 0 10px 6px;">
          <div style="font-size:20px;font-weight:700;color:#57534e;line-height:1.1;">${v.chiffres.abstentions}</div>
          <div style="font-size:10px;color:#78716c;text-transform:uppercase;letter-spacing:0.05em;margin-top:3px;">Abstentions</div>
        </td>
      </tr>
    </table>
    <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;table-layout:fixed;margin-bottom:10px;">
      <tr>
        <td width="50%" style="text-align:center;border-right:1px solid #ede9e4;padding:10px 6px 0 0;">
          <div style="font-size:16px;font-weight:600;color:#a8a29e;line-height:1.1;">${v.chiffres.nonVotants}</div>
          <div style="font-size:10px;color:#a8a29e;text-transform:uppercase;letter-spacing:0.04em;margin-top:3px;">Non-votants</div>
        </td>
        <td width="50%" style="text-align:center;padding:10px 0 0 6px;">
          <div style="font-size:16px;font-weight:600;color:#a8a29e;line-height:1.1;">${valeurSegment('absents')}</div>
          <div style="font-size:10px;color:#a8a29e;text-transform:uppercase;letter-spacing:0.04em;margin-top:3px;">Aucun vote</div>
        </td>
      </tr>
    </table>
    <p style="font-size:12px;color:#78716c;margin:0 0 30px;text-align:center;">Participation : <strong style="color:#292524;">${a.participationPct} %</strong> — ${v.chiffres.votants} élus sur ${a.total} ont pris part au vote</p>`

  return `
    <p style="font-weight:600;color:#292524;margin:0 0 3px;font-size:15px;line-height:1.4;">${echapperHtml(v.titre)}</p>
    <p style="font-size:13px;color:#78716c;margin:0 0 4px;">${echapperHtml(v.chiffres.chambre ?? '')}${v.type_vote_libelle ? ` · ${echapperHtml(v.type_vote_libelle)}` : ''} · ${echapperHtml(v.type_majorite_label)}</p>
    <p style="font-size:13px;color:#44403c;margin:0 0 14px;">Résultat : <strong style="color:#292524;">${echapperHtml(v.sort)}</strong></p>
    <div style="height:14px;"></div>
    <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-bottom:0;line-height:0;font-size:0;">
      <tr>${barCells}</tr>
    </table>
    <div style="height:14px;"></div>
    ${chiffresCells}
    <a href="${voteLink}" style="display:inline-block;padding:8px 18px;background:transparent;color:#8b5cf6;border:2px solid #8b5cf6;border-radius:9999px;text-decoration:none;font-weight:600;font-size:14px;">Je consulte le vote &#8594;</a>
  `
}

// Le HTML complet de la lettre, en styles en ligne et sans police web : en-tête,
// rubriques présentes seulement, « Aller plus loin », pied. Appelée par POST, pour
// l'envoi réel comme pour un email de test.
function buildEmailHtml(params: {
  sections: ResumeSemaineIa
  weekLabel: string
  monthKey: string
  stats: WeekContext['stats']
  votesHebdo: VoteHebdo[]
  dossierLumiere: DossierLumiere | null
  topDossiers: { uid: string; titre: string }[]
  topActeurs: { uid: string; prenom: string; nom: string; qualite: string | null }[]
  topActifsAN: TopActiviteElu[]
  topActifsSN: TopActiviteElu[]
  profilsSemaine: string[]
  nbProfilsTouches: number
  siteUrl: string
}): string {
  const { sections, weekLabel, monthKey, stats, votesHebdo, dossierLumiere, topDossiers, topActeurs, topActifsAN, topActifsSN, profilsSemaine, nbProfilsTouches, siteUrl } = params

  // Images servies par loiclair.fr, que la politique de confidentialité déclare,
  // et non par un tiers : chaque ouverture de la lettre transmet l'adresse IP du
  // lecteur à l'hébergeur des images. L'apex en dur et non `siteUrl`, qui peut
  // valoir `www` : `www` redirige, et un client mail ne suit pas toujours une
  // redirection. Contrepartie : une image nouvelle ou changée n'est en ligne
  // qu'après /release, et un email de test envoyé avant la montre cassée.
  const imagesUrl = 'https://loiclair.fr'
  // X à l'encre sombre : le pied de page est blanc. Les trois autres icônes ont leur couleur de marque.
  const svgX = `<img src="${imagesUrl}/icons/social/x-sombre.png" alt="X" width="20" height="20" style="display:block;width:20px;height:20px;" />`
  const svgLi = `<img src="${imagesUrl}/icons/social/linkedin.png" alt="LinkedIn" width="20" height="20" style="display:block;width:20px;height:20px;" />`
  const svgWa = `<img src="${imagesUrl}/icons/social/whatsapp.png" alt="WhatsApp" width="20" height="20" style="display:block;width:20px;height:20px;" />`
  const svgFb = `<img src="${imagesUrl}/icons/social/facebook.png" alt="Facebook" width="20" height="20" style="display:block;width:20px;height:20px;" />`

  // Un vote solennel et une motion de censure ne sont pas la même chose : le premier
  // tranche le sort d'un texte, la seconde vise le Gouvernement. La légende les nommait
  // tous deux « votes solennels ».
  const nbSolennels = votesHebdo.filter(v => v.chiffres.typeVoteCode === 'SPS').length
  const nbCensures = votesHebdo.filter(v => v.chiffres.typeVoteCode === 'MOC').length
  const libellesVotes: string[] = []
  if (nbSolennels > 0) libellesVotes.push(nbSolennels > 1 ? `${nbSolennels} <strong style="color:#292524;">votes solennels</strong>` : `un <strong style="color:#292524;">vote solennel</strong>`)
  if (nbCensures > 0) libellesVotes.push(nbCensures > 1 ? `${nbCensures} <strong style="color:#292524;">motions de censure</strong>` : `une <strong style="color:#292524;">motion de censure</strong>`)
  const introVotes = libellesVotes.length > 0
    ? [
        `La semaine passée : ${libellesVotes.join(' et ')}.`,
        nbSolennels > 0 ? 'Les élus se déplacent expressément pour un scrutin solennel, annoncé à l\'avance.' : '',
        nbCensures > 0 ? 'Sur une motion de censure, seuls les votes favorables sont recensés.' : '',
      ].filter(Boolean).join(' ')
    : `Aucun vote solennel la semaine passée — voici le vote le plus <strong style="color:#292524;">divisé</strong>, pour mettre en lumière les décisions les plus politiquement contestées.`

  // « Voté » ne s'affiche que si la semaine compte une décision : sinon, un
  // paragraphe IA égaré y contredirait la case « 0 décision » des chiffres clés.
  const voteAffiche = sections.decisions.length > 0 && stats.decisions > 0

  // La carte suit « Voté » sans marge, comme sa suite. Seule, elle ouvre sa rubrique
  // et prend la marge haute des autres, sinon elle touche le filet du dessus.
  const votesSection = votesHebdo.length > 0 ? `
    <div style="padding:${voteAffiche ? '0' : '44px'} 32px 40px;">
      <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:20px;padding:32px;">
        <h3 style="font-size:22px;font-weight:800;color:#1c1917;line-height:1.4;letter-spacing:-0.01em;margin:0 0 12px;">Vote en lumière.</h3>
        <p style="font-size:13px;color:#78716c;margin:0 0 24px;line-height:1.5;">
          ${introVotes}
        </p>
        ${votesHebdo.map((v, i) => {
          // La page du vote, que chaque vote retenu a (scrutin cité par un acte, donc à
          // liste nominative). La newsletter est en français : l'adresse aussi.
          const voteLink = `${siteUrl}/fr/Scrutins/${v.scrutinUid}`
          return (i > 0 ? '<div style="height:1px;background:#ddd6fe;margin:20px 0 24px;"></div>' : '') + renderVoteBlock(v, voteLink)
        }).join('')}
      </div>
    </div>` : ''

  // Même garde pour « Publié » : sans loi ni décret paru, son intro n'aurait rien à compter.
  const publieAffiche = sections.publications.length > 0 && stats.promulgationsEnAttente + stats.decrets > 0
  const introPublie = [
    stats.promulgationsEnAttente > 1 ? `${stats.promulgationsEnAttente} lois promulguées` : stats.promulgationsEnAttente === 1 ? 'une loi promulguée' : '',
    stats.decrets > 1 ? `${stats.decrets} décrets publiés` : stats.decrets === 1 ? 'un décret publié' : '',
  ].filter(Boolean).join(' et ')

  // Un filet entre deux rubriques présentes, plutôt qu'une photo de bandeau : les
  // clients mail bloquent les images par défaut chez une partie des lecteurs. Les
  // rubriques se joignent par lui, donc jamais deux filets d'affilée quand une
  // rubrique manque. « Aller plus loin » et le bouton final ferment la lettre sans
  // filet.
  const filet = '<div style="height:1px;background:#e7e5e4;line-height:0;font-size:0;margin:0 32px;">&nbsp;</div>'

  // Polices système seulement : IBM Plex Sans se chargeait chez Google Fonts à
  // l'ouverture de la lettre, dans les clients mail qui suivent un `<link>`, et
  // transmettait ainsi à Google l'adresse IP du lecteur, ce que la politique de
  // confidentialité ne disait pas. Le nom de l'en-tête, seul texte en Plex, est
  // donc une image (`nom.png`).
  const fontFamily = "-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif"

  // `color-scheme: light only` dans le <head> : la lettre est dessinée sur blanc.
  // Apple Mail respecte la balise ; l'app Gmail et Outlook.com l'ignorent, et
  // assombrissent le fond sans toucher aux images. `nom.png` et `x-sombre.png`
  // ont donc un fond blanc opaque : transparents, leur encre sombre y disparaîtrait.

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>LoiClair — Semaine du ${weekLabel}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${fontFamily};color:#1c1917;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Le Parlement en 5 min — semaine du ${weekLabel}</div>
<div style="max-width:600px;margin:0 auto;background:#ffffff;">

  <!-- En-tête : le nom, la phrase, puis l'aquarelle, empilés sur du blanc. Le ciel
       de l'aquarelle est blanc, donc l'empilement se lit comme un nom posé dans le
       ciel, sans texte par-dessus une image de fond (qui demanderait du VML pour
       Outlook sous Windows et une media query pour le téléphone). Images bloquées :
       « LoiClair » en texte de remplacement, et la phrase reste du texte. -->
  <div style="background:#ffffff;text-align:center;">
    <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 auto;">
      <tr>
        <td style="padding:40px 0 0;"><img src="${imagesUrl}/images/newsletter/nom.png" width="170" height="32" alt="LoiClair" style="display:block;border:0;width:170px;height:32px;font-size:26px;font-weight:600;color:#1c1917;"></td>
      </tr>
    </table>
    <div style="color:#78716c;font-size:15px;line-height:1.4;font-style:italic;padding:12px 24px 0;">Le Parlement en 5 minutes.</div>
    <img src="${imagesUrl}/images/newsletter/entete.jpg" width="600" height="352" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;margin-top:8px;">
  </div>

  <div style="background:#ffffff;overflow:hidden;margin-bottom:0;">

    ${[`
    <!-- Résumé de la semaine. La date en surtitre : l'en-tête n'en porte plus. -->
    <div style="padding:44px 32px 36px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#57534e;margin:0 0 10px;">${weekLabel}</div>
      <h2 style="font-size:30px;font-weight:800;color:#1c1917;line-height:1.1;letter-spacing:-0.02em;margin:0 0 24px;">Résumé de la semaine.</h2>
      <div style="line-height:1.5;color:#44403c;margin:0 0 12px;font-size:15px;">${formatTexteHtml(sections.resume)}</div>
      <p style="font-size:11px;color:#a8a29e;margin:0;">&#10022; Généré par IA · <a href="${siteUrl}/documentation/prompts-ia#nl" style="color:#a8a29e;text-decoration:underline;">Notre méthode</a></p>
    </div>`,

    `
    <!-- Chiffres clés -->
    <div style="padding:44px 32px 36px;">
      <h2 style="font-size:30px;font-weight:800;color:#1c1917;line-height:1.1;letter-spacing:-0.02em;margin:0 0 28px;">Chiffres clés.</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          ${[
            [stats.applications, 'application' + (stats.applications > 1 ? 's' : ''), '#16a34a'],
            [stats.decisions, 'décision' + (stats.decisions > 1 ? 's' : ''), '#8b5cf6'],
            [stats.depots, 'dépôt' + (stats.depots > 1 ? 's' : ''), '#f59e0b'],
          ].map(([n, label, color]) => `
          <td width="33%" style="text-align:center;padding:4px 0;">
            <div style="font-size:52px;font-weight:800;color:${color};line-height:1;letter-spacing:-0.03em;">${n}</div>
            <div style="font-size:14px;color:#78716c;margin-top:10px;">${label}</div>
          </td>`).join('')}
        </tr>
      </table>
      <div style="text-align:left;margin-top:32px;">
        <a href="${siteUrl}/Month" style="display:inline-block;padding:8px 18px;background:transparent;color:#06b6d4;border:2px solid #06b6d4;border-radius:9999px;text-decoration:none;font-weight:600;font-size:14px;">Voir toute l'activité parlementaire &#8594;</a>
      </div>
    </div>`,

    renderProfilsSemaine(profilsSemaine, nbProfilsTouches, siteUrl),

    sections.application.length > 0 ? `
    <!-- Entre en application -->
    <div style="padding:44px 32px;">
      <h2 style="font-size:30px;font-weight:800;color:#1c1917;line-height:1.1;letter-spacing:-0.02em;margin:0 0 16px;">Entre en application.</h2>
      <p style="font-size:13px;color:#78716c;margin:0 0 24px;line-height:1.5;">Ces textes sont <strong style="color:#292524;">en vigueur</strong> — ils s'appliquent aux citoyens dès maintenant.</p>
      <div style="line-height:1.5;color:#44403c;margin:0 0 16px;font-size:15px;">${formatSectionHtml(sections.application, '#16a34a')}</div>
      <p style="font-size:11px;color:#a8a29e;margin:0;">&#10022; Généré par IA · <a href="${siteUrl}/documentation/prompts-ia#nl" style="color:#a8a29e;text-decoration:underline;">Notre méthode</a></p>
      <div style="margin-top:20px;">
        <a href="${siteUrl}/Month?mois=${monthKey}&type=LOI_APPLIQUEE" style="display:inline-block;padding:8px 18px;background:transparent;color:#16a34a;border:2px solid #16a34a;border-radius:9999px;text-decoration:none;font-weight:600;font-size:14px;">Voir toutes les lois appliquées &#8594;</a>
      </div>
    </div>` : '',

    // « Voté » et sa carte de votes forment une seule rubrique : pas de filet entre eux.
    `${voteAffiche ? `
    <!-- Décisions de la semaine -->
    <div style="padding:44px 32px;">
      <h2 style="font-size:30px;font-weight:800;color:#1c1917;line-height:1.1;letter-spacing:-0.02em;margin:0 0 16px;">Voté cette semaine.</h2>
      <p style="font-size:13px;color:#78716c;margin:0 0 24px;line-height:1.5;">${stats.decisions > 1 ? `Parmi les ${stats.decisions} décisions de la semaine, voici les plus marquantes.` : 'Voici la décision de la semaine.'} Les textes adoptés <strong style="color:#292524;">ne sont pas encore en vigueur</strong> : ils attendent leur promulgation ou leurs décrets.</p>
      <div style="line-height:1.5;color:#44403c;margin:0 0 16px;font-size:15px;">${formatSectionHtml(sections.decisions, '#8b5cf6')}</div>
      <p style="font-size:11px;color:#a8a29e;margin:0;">&#10022; Généré par IA · <a href="${siteUrl}/documentation/prompts-ia#nl" style="color:#a8a29e;text-decoration:underline;">Notre méthode</a></p>
      <div style="margin-top:20px;">
        <a href="${siteUrl}/Month?mois=${monthKey}&type=DECISION" style="display:inline-block;padding:8px 18px;background:transparent;color:#8b5cf6;border:2px solid #8b5cf6;border-radius:9999px;text-decoration:none;font-weight:600;font-size:14px;">Voir toutes les décisions &#8594;</a>
      </div>
    </div>` : ''}${votesSection}`,

    publieAffiche ? `
    <!-- Lois promulguées en attente de décrets et décrets publiés : rubrique à part,
         aucun des deux n'étant un vote. Couleur du fil « décrets » de /Month. -->
    <div style="padding:44px 32px;">
      <h2 style="font-size:30px;font-weight:800;color:#1c1917;line-height:1.1;letter-spacing:-0.02em;margin:0 0 16px;">Publié cette semaine.</h2>
      <p style="font-size:13px;color:#78716c;margin:0 0 24px;line-height:1.5;">${introPublie.charAt(0).toUpperCase() + introPublie.slice(1)} au Journal officiel. Une loi <strong style="color:#292524;">ne s'applique pleinement</strong> qu'une fois tous ses décrets parus.</p>
      <div style="line-height:1.5;color:#44403c;margin:0 0 16px;font-size:15px;">${formatSectionHtml(sections.publications, '#B45309')}</div>
      <p style="font-size:11px;color:#a8a29e;margin:0;">&#10022; Généré par IA · <a href="${siteUrl}/documentation/prompts-ia#nl" style="color:#a8a29e;text-decoration:underline;">Notre méthode</a></p>
      <div style="margin-top:20px;">
        <a href="${siteUrl}/Month?mois=${monthKey}&type=${stats.decrets > 0 ? 'DECRET' : 'PROMULGATION'}" style="display:inline-block;padding:8px 18px;background:transparent;color:#B45309;border:2px solid #B45309;border-radius:9999px;text-decoration:none;font-weight:600;font-size:14px;">${stats.decrets > 0 ? 'Voir tous les décrets' : 'Voir toutes les promulgations'} &#8594;</a>
      </div>
    </div>` : '',

    sections.depots.length > 0 || dossierLumiere ? `
    <!-- Déposés cette semaine -->
    <div style="padding:44px 32px;">
      <h2 style="font-size:30px;font-weight:800;color:#1c1917;line-height:1.1;letter-spacing:-0.02em;margin:0 0 16px;">Déposé cette semaine.</h2>
      <p style="font-size:13px;color:#78716c;margin:0 0 24px;line-height:1.5;">Nouveaux textes entrés dans le circuit législatif — ils n'ont <strong style="color:#292524;">pas encore été votés</strong>.</p>
      ${sections.depots.length > 0 ? `<div style="line-height:1.5;color:#44403c;margin:0 0 24px;font-size:15px;">${formatSectionHtml(sections.depots, '#f59e0b')}</div>` : ''}
      ${dossierLumiere ? `
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:20px;padding:32px;margin:32px 0 8px;">
        <h3 style="font-size:22px;font-weight:800;color:#1c1917;line-height:1.4;letter-spacing:-0.01em;margin:0 0 16px;">Dossier en lumière.</h3>
        <p style="font-weight:600;color:#292524;margin:0 0 4px;font-size:16px;line-height:1.4;">${echapperHtml(dossierLumiere.titre)}</p>
        ${dossierLumiere.date_depot ? `<p style="font-size:14px;color:#78716c;margin:0 0 14px;">Déposé le ${premierDuMois(new Date(dossierLumiere.date_depot).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>` : '<div style="height:14px;"></div>'}
        ${/* Le résumé court est rédigé une fois, d'après le texte de dépôt en priorité
             (generate_search_summaries.py), jamais d'après une version modifiée ensuite :
             la mention le dit au lecteur avant qu'il ne le lise. */ ''}
        ${dossierLumiere.search_summary ? `<p style="font-size:12px;color:#78716c;margin:0 0 4px;">Résumé du texte tel que déposé par ses auteurs</p><p style="font-size:15px;color:#44403c;line-height:1.5;margin:0 0 6px;">${echapperHtml(dossierLumiere.search_summary)}</p>` : ''}
        <div style="margin-top:20px;">
          <a href="${siteUrl}/dossiers-legislatifs/${dossierLumiere.uid}/resume-ia" style="display:inline-block;padding:8px 18px;background:transparent;color:#f59e0b;border:2px solid #f59e0b;border-radius:9999px;text-decoration:none;font-weight:600;font-size:14px;">Je consulte le dossier &#8594;</a>
        </div>
      </div>` : ''}
      ${/* Sans dépôt de la semaine, le seul texte IA de la section est le résumé court
           du dossier en lumière, écrit par l'usage « search », pas par la newsletter. */ ''}
      <p style="font-size:11px;color:#a8a29e;margin:20px 0 0;">&#10022; Généré par IA · <a href="${siteUrl}/documentation/prompts-ia#${sections.depots.length > 0 ? 'nl' : 'search'}" style="color:#a8a29e;text-decoration:underline;">Notre méthode</a></p>
      <div style="margin-top:20px;">
        <a href="${siteUrl}/Month?mois=${monthKey}&type=DEPOT_TEXTE" style="display:inline-block;padding:8px 18px;background:transparent;color:#f59e0b;border:2px solid #f59e0b;border-radius:9999px;text-decoration:none;font-weight:600;font-size:14px;">Voir tous les dépôts &#8594;</a>
      </div>
    </div>` : '',

    topDossiers.length > 0 || topActeurs.length > 0 || topActifsAN.length > 0 || topActifsSN.length > 0 ? `
    <!-- Tendances -->
    <div style="padding:44px 32px;">
      <h2 style="font-size:30px;font-weight:800;color:#1c1917;line-height:1.1;letter-spacing:-0.02em;margin:0 0 28px;">Tendance.</h2>

      ${topDossiers.length > 0 ? `
      <h3 style="font-size:20px;font-weight:800;color:#1c1917;line-height:1.4;letter-spacing:-0.015em;margin:0 0 4px;"><span style="color:#a8a29e;margin-right:8px;">&#9632;</span>Dossiers.</h3>
      <p style="font-size:11px;color:#a8a29e;margin:0 0 14px;">Ce mois-ci</p>
      ${topDossiers.map((d, i) => `
      <div style="margin-bottom:${i < topDossiers.length - 1 ? '10px' : '0'};font-size:14px;line-height:1.5;"><span style="color:#57534e;font-weight:700;">${i + 1}. </span><a href="${siteUrl}/dossiers-legislatifs/${d.uid}/resume-ia" style="color:#292524;text-decoration:none;">${echapperHtml(d.titre)}</a></div>`).join('')}` : ''}

      ${topActeurs.length > 0 ? `
      <h3 style="font-size:20px;font-weight:800;color:#1c1917;line-height:1.4;letter-spacing:-0.015em;margin:28px 0 4px;"><span style="color:#a8a29e;margin-right:8px;">&#9632;</span>Élus.</h3>
      <p style="font-size:11px;color:#a8a29e;margin:0 0 14px;">Ce mois-ci</p>
      ${topActeurs.map((a, i) => `
      <div style="margin-bottom:${i < topActeurs.length - 1 ? '10px' : '0'};font-size:14px;"><span style="color:#57534e;font-weight:700;">${i + 1}. </span><a href="${siteUrl}/les-elus/${a.uid}" style="color:#292524;text-decoration:none;">${echapperHtml(a.prenom)} ${echapperHtml(a.nom)}</a>${a.qualite ? `<span style="color:#78716c;"> · ${echapperHtml(a.qualite)}</span>` : ''}</div>`).join('')}` : ''}

      ${topActifsAN.length > 0 ? `
      <h3 style="font-size:20px;font-weight:800;color:#1c1917;line-height:1.4;letter-spacing:-0.015em;margin:28px 0 4px;"><span style="color:#a8a29e;margin-right:8px;">&#9632;</span>Députés les plus actifs.</h3>
      <p style="font-size:11px;color:#a8a29e;margin:0 0 14px;">Depuis le début de la législature</p>
      ${topActifsAN.map((a, i) => `
      <div style="margin-bottom:${i < topActifsAN.length - 1 ? '10px' : '0'};font-size:14px;"><span style="color:#57534e;font-weight:700;">${i + 1}. </span><a href="${siteUrl}/les-elus/${a.uid}" style="color:#292524;text-decoration:none;">${echapperHtml(a.prenom)} ${echapperHtml(a.nom)}</a>${a.groupeLabel ? `<span style="color:#78716c;"> · ${echapperHtml(a.groupeLabel)}</span>` : ''}</div>`).join('')}` : ''}

      ${topActifsSN.length > 0 ? `
      <h3 style="font-size:20px;font-weight:800;color:#1c1917;line-height:1.4;letter-spacing:-0.015em;margin:28px 0 4px;"><span style="color:#a8a29e;margin-right:8px;">&#9632;</span>Sénateurs les plus actifs.</h3>
      <p style="font-size:11px;color:#a8a29e;margin:0 0 14px;">Depuis le début de la législature</p>
      ${topActifsSN.map((a, i) => `
      <div style="margin-bottom:${i < topActifsSN.length - 1 ? '10px' : '0'};font-size:14px;"><span style="color:#57534e;font-weight:700;">${i + 1}. </span><a href="${siteUrl}/les-elus/${a.uid}" style="color:#292524;text-decoration:none;">${echapperHtml(a.prenom)} ${echapperHtml(a.nom)}</a>${a.groupeLabel ? `<span style="color:#78716c;"> · ${echapperHtml(a.groupeLabel)}</span>` : ''}</div>`).join('')}` : ''}
    </div>` : '',
    ].filter(Boolean).join(filet)}

    <!-- Aller plus loin : le menu du haut du site (libellés nav.* lus dans fr.json,
         ordre de useNavCategories), sans « Comprendre ». Chaque lien est insécable, et chaque
         séparateur colle au lien qui le précède : sur téléphone, la ligne passe à
         deux rangs juste après un point, jamais au milieu d'un libellé ni devant un
         point orphelin. -->
    <div style="padding:48px 32px 32px;text-align:center;">
      <h2 style="font-size:28px;font-weight:800;color:#1c1917;line-height:1.1;letter-spacing:-0.02em;margin:0 0 24px;">Aller plus loin.</h2>
      <p style="margin:0;font-size:13px;line-height:2;">${[
        ['/Month', messagesFr.nav.newsFeedShort],
        ['/dossiers-legislatifs', messagesFr.nav.textes],
        ['/les-elus', messagesFr.nav.elus],
        ['/ce-qui-me-concerne', messagesFr.nav.pourMoi],
        ['/etat-des-lieux', messagesFr.nav.chiffres],
      ].map(([chemin, libelle]) => `<a href="${siteUrl}${chemin}" style="text-decoration:none;color:#292524;font-weight:600;white-space:nowrap;">${libelle}&nbsp;&#8599;</a>`)
        .join('&nbsp;<span style="color:#d6d3d1;margin:0 4px;">·</span> ')}</p>
    </div>

    <!-- CTA principal -->
    <div style="padding:0 32px 104px;text-align:center;">
      <a href="${siteUrl}" style="display:inline-block;padding:16px 48px;background:#06b6d4;color:#ffffff;border-radius:9999px;text-decoration:none;font-weight:700;font-size:17px;letter-spacing:-0.01em;">J'ouvre LoiClair &#8594;</a>
      <p style="color:#a8a29e;font-size:13px;margin:14px 0 0;">Gratuit · Indépendant · Données officielles</p>
    </div>

  </div>

  <!-- Pied de page, blanc comme le reste de la lettre : un pied sombre faisait
       paraître la colonne étroite. Un filet le sépare du bouton final. -->
  <div style="background:#ffffff;border-top:1px solid #e7e5e4;padding:48px 36px;">
    <span style="color:#1c1917;font-size:17px;font-weight:700;letter-spacing:-0.01em;">LoiClair.fr</span>
    <p style="color:#78716c;font-size:14px;margin:28px 0 32px;line-height:1.5;">Comprendre le Parlement en 5 minutes — gratuitement, sans jargon, sans parti pris. Vous connaissez quelqu'un qui devrait lire ça&#8239;?</p>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:32px;">
      <tr>
        <td style="vertical-align:middle;padding-right:16px;">
          <span style="color:#78716c;font-size:14px;font-weight:600;">Partager</span>
        </td>
        <td style="vertical-align:middle;padding-right:18px;">
          <a href="https://twitter.com/intent/tweet?text=Je%20suis%20LoiClair%2C%20le%20tableau%20de%20bord%20citoyen%20qui%20rend%20le%20Parlement%20accessible%20%F0%9F%87%AB%F0%9F%87%B7&url=${encodeURIComponent(siteUrl + '/newsletter')}" style="text-decoration:none;display:inline-block;">${svgX}</a>
        </td>
        <td style="vertical-align:middle;padding-right:18px;">
          <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(siteUrl + '/newsletter')}" style="text-decoration:none;display:inline-block;">${svgLi}</a>
        </td>
        <td style="vertical-align:middle;padding-right:18px;">
          <a href="https://wa.me/?text=Je%20suis%20LoiClair%2C%20le%20tableau%20de%20bord%20citoyen%20qui%20rend%20le%20Parlement%20accessible%20%E2%86%92%20${encodeURIComponent(siteUrl + '/newsletter')}" style="text-decoration:none;display:inline-block;">${svgWa}</a>
        </td>
        <td style="vertical-align:middle;">
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(siteUrl + '/newsletter')}" style="text-decoration:none;display:inline-block;">${svgFb}</a>
        </td>
      </tr>
    </table>
    <p style="color:#78716c;font-size:12px;margin:0 0 14px;line-height:1.5;">
      Un retour sur le contenu ou le format de cette newsletter&#8239;? <a href="mailto:contact@loiclair.fr" style="color:#78716c;text-decoration:underline;">Nous écrire</a>.
    </p>
    <p style="color:#78716c;font-size:12px;margin:0 0 28px;line-height:1.5;">
      Vous recevez cet e-mail à la suite de votre inscription sur loiclair.fr. Pour ne plus recevoir nos e-mails, <a href="${siteUrl}/newsletter/desabonner" style="color:#78716c;text-decoration:underline;">désabonnez-vous</a>.
    </p>
    <p style="color:#78716c;font-size:11px;margin:0;line-height:1.5;">
      LoiClair, association loi 1901, ${ASSOCIATION.siege.rue}, ${ASSOCIATION.siege.codePostal} ${ASSOCIATION.siege.ville} · Données publiques officielles<br>
      Résumé généré par IA — peut contenir des erreurs. <a href="${siteUrl}/dossiers-legislatifs" style="color:#78716c;text-decoration:underline;">Consulter les textes officiels</a>.
    </p>
  </div>

</div>
</body>
</html>`
}

export async function POST(request: NextRequest) {
  // Vérification du Bearer token
  const authHeader = request.headers.get('Authorization') || ''
  const secret = (process.env.NEWSLETTER_SEND_SECRET || '').trim()
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const secretBuf = Buffer.from(secret)
  const providedBuf = Buffer.from(provided)
  const valid = secretBuf.length > 0 &&
    secretBuf.length === providedBuf.length &&
    crypto.timingSafeEqual(secretBuf, providedBuf)
  if (!valid) {
    return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 })
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://loiclair.fr'

  let testEmail: string | undefined
  try {
    const body = await request.json()
    testEmail = body?.test_email?.trim() || undefined
  } catch {
    // body optionnel
  }

  const { weekStart, weekEnd } = getPreviousWeek()
  const weekStartStr = toDateStr(weekStart)
  const weekEndStr = toDateStr(weekEnd)

  // Une semaine déjà archivée comme envoyée ne repart pas : un re-run manuel du
  // workflow, ou un lancement de rattrapage, enverrait sinon une seconde lettre à
  // tous les abonnés. La lecture se fait avant la génération IA, qui coûte des
  // crédits. Le mode test reste libre : le banc d'essai rejoue une semaine passée.
  // Deux lancements simultanés passent encore tous les deux cette lecture : l'index
  // unique `newsletter_history_semaine_envoyee_unique` fait alors échouer
  // l'archivage du second, signalé par l'alerte « envoyée mais non archivée ».
  if (!testEmail) {
    let dejaEnvoyee: { week_start: string }[]
    try {
      dejaEnvoyee = await sql<{ week_start: string }[]>`
        select week_start
        from newsletter_history
        where week_start = ${weekStartStr}
          and skipped = false
        limit 1`
    } catch (err) {
      await envoyerAlerteBestEffort(
        '[ALERTE] Newsletter non envoyée : historique illisible',
        `<p>Impossible de vérifier si la lettre de la semaine du ${weekStartStr} est déjà partie, donc rien n'a été envoyé : ${decrireErreur(err)}</p>`,
      )
      return NextResponse.json({ error: 'Échec lecture historique.' }, { status: 500 })
    }
    if (dejaEnvoyee.length > 0) {
      return NextResponse.json({ skipped: true, reason: 'already_sent' })
    }
  }

  let ctx:Awaited<ReturnType<typeof buildWeekContext>>
  try {
    ctx = await buildWeekContext(weekStartStr, weekEndStr)
  } catch (err) {
    console.error('Erreur buildWeekContext:', err)
    await envoyerAlerteBestEffort(
      '[ALERTE] Échec contexte newsletter LoiClair',
      `<p>buildWeekContext a échoué : ${String(err)}</p>`,
    )
    return NextResponse.json({ error: 'Échec construction contexte.' }, { status: 500 })
  }

  const totalActes = ctx.stats.promulgations + ctx.stats.decrets + ctx.stats.applicationsCompletes + ctx.stats.decisions + ctx.stats.depots
  if (totalActes === 0) {
    return NextResponse.json({ skipped: true, reason: 'no_events' })
  }

  const promptFinal = PROMPT_RESUME_SEMAINE
    .replace('{eventsSummary}', ctx.eventsSummary)

  let sections: ResumeSemaineIa
  try {
    sections = await genererResumeSemaine(promptFinal)
  } catch (err) {
    console.error('Échec IA newsletter après 3 tentatives:', err)
    await envoyerAlerteBestEffort(
      '[ALERTE] Échec génération newsletter LoiClair',
      `<p>La génération IA de la newsletter du ${ctx.weekLabel} a échoué après 3 tentatives. Erreur : ${String(err)}</p>`,
    )
    return NextResponse.json({ error: 'Échec génération IA.' }, { status: 500 })
  }

  const monthKey = weekEndStr.slice(0, 7)

  const htmlContent = buildEmailHtml({
    sections,
    weekLabel: ctx.weekLabel,
    monthKey,
    stats: ctx.stats,
    votesHebdo: ctx.votesHebdo,
    dossierLumiere: ctx.dossierLumiere,
    topDossiers: ctx.topDossiers,
    topActeurs: ctx.topActeurs,
    topActifsAN: ctx.topActifsAN,
    topActifsSN: ctx.topActifsSN,
    profilsSemaine: ctx.profilsSemaine,
    nbProfilsTouches: ctx.nbProfilsTouches,
    siteUrl,
  })

  // Mode test : envoi unique sans log.
  // Pas d'alerte : ce chemin n'est atteint que par un humain qui lit sa réponse.
  // Le `try/catch` était mort avant `donneesOuLeve`, le SDK ne levant pas : un
  // destinataire invalide rendait 200 « sent » pendant que Resend refusait en 422.
  if (testEmail) {
    try {
      donneesOuLeve(
        await clientResend().emails.send({
          from: EXPEDITEUR_NEWSLETTER,
          to: testEmail,
          subject: `LoiClair — Semaine du ${ctx.weekLabel}`,
          html: htmlContent,
        }),
        'emails.send (test)',
      )
    } catch (err) {
      return NextResponse.json({ error: 'Échec envoi test.', detail: String(err) }, { status: 500 })
    }
    return NextResponse.json({ sent: 'test', to: testEmail })
  }

  // Sans audience, la lettre ne part à personne. La branche qui existait ici
  // archivait pourtant `skipped: false` et rendait `{ sent: true }` sans avoir
  // appelé le moindre envoi : une variable d'environnement absente produisait une
  // newsletter « envoyée » à personne, et un run vert. Un envoi ponctuel sans
  // audience reste possible par `test_email`, qui retourne bien avant ici.
  const audienceId = (process.env.RESEND_AUDIENCE_ID || '').trim()
  if (!audienceId) {
    await envoyerAlerteBestEffort(
      '[ALERTE] Newsletter non envoyée : RESEND_AUDIENCE_ID manquant',
      `<p>La newsletter du ${ctx.weekLabel} a été générée mais n'a pas pu partir : la variable RESEND_AUDIENCE_ID est absente.</p>`,
    )
    return NextResponse.json({ error: 'RESEND_AUDIENCE_ID manquant.' }, { status: 500 })
  }

  // Compter les abonnés confirmés. Bruyant : rien n'est encore parti, donc
  // l'échec est gratuit et le run rejouable. Continuer archiverait
  // `subscriber_count: 0` sur un envoi réussi, un faux dans la seule trace qui
  // existe ; et cette lecture partage le client qui vient de servir
  // `buildWeekContext`, donc son échec fait douter de toute la base.
  let subscriberCount: number
  try {
    subscriberCount = (await sql<{ n: number }[]>`
      select count(*) as n from newsletter_subscribers where confirmed = true`)[0].n
  } catch (err) {
    await envoyerAlerteBestEffort(
      '[ALERTE] Newsletter non envoyée : comptage des abonnés impossible',
      `<p>La newsletter du ${ctx.weekLabel} a été générée mais n'a pas pu partir : ${decrireErreur(err)}</p>`,
    )
    return NextResponse.json({ error: 'Échec comptage abonnés.' }, { status: 500 })
  }

  // Rattrapage : les abonnés confirmés absents de l'audience. `resend_contact_id`
  // à NULL est déjà le marqueur, personne ne le lisait. C'est ici, juste avant le
  // broadcast, que leur absence a une conséquence, et la route a déjà la clé,
  // l'audience et le chemin d'alerte : zéro cron, zéro secret, zéro colonne.
  await rattraperAudience(audienceId, ctx.weekLabel)

  // Broadcast. `donneesOuLeve` sur les deux appels : `create` rendait
  // `{ data: null, error }` sans lever, l'id était donc `undefined`, `send`
  // n'était jamais appelé, aucune alerte ne partait, et la route rendait 200 avec
  // une ligne d'historique affirmant que la lettre était partie.
  //
  // Aucune reprise ici, volontairement : un `send` qui a échoué côté réponse peut
  // avoir été accepté côté Resend, et le rejouer enverrait la lettre deux fois à
  // tout le monde. On alerte, et une main humaine tranche.
  let broadcastId: string
  try {
    const client = clientResend()
    broadcastId = donneesOuLeve(await client.broadcasts.create({
      audienceId,
      from: EXPEDITEUR_NEWSLETTER,
      subject: `LoiClair — Semaine du ${ctx.weekLabel}`,
      html: htmlContent,
      name: `Newsletter ${ctx.weekLabel}`,
    }), 'broadcasts.create').id
    donneesOuLeve(await client.broadcasts.send(broadcastId), 'broadcasts.send')
  } catch (err) {
    console.error('Erreur broadcast Resend:', err)
    await envoyerAlerteBestEffort(
      '[ALERTE] Échec broadcast newsletter LoiClair',
      `<p>Le broadcast de la newsletter du ${ctx.weekLabel} a échoué. Erreur : ${String(err)}</p>`,
    )
    return NextResponse.json({ error: 'Échec broadcast.' }, { status: 500 })
  }

  // À partir d'ici la lettre est partie : plus rien ne fait échouer la route.
  // Un 500 donnerait un run rouge, donc un re-run manuel, donc une seconde lettre
  // à tous les abonnés. L'archive manquante se répare à la main depuis l'alerte,
  // qui porte tout ce qu'il faut pour réécrire la ligne.
  try {
    await sql`insert into newsletter_history ${sql({
      week_start: weekStartStr,
      week_end: weekEndStr,
      resume_ia: JSON.stringify(sections),
      subscriber_count: subscriberCount,
      skipped: false,
    })}`
  } catch (erreurHistorique) {
    const { code, message } = erreurHistorique as { code?: string; message?: string }
    console.error('Historique newsletter non écrit :', code, message)
    await envoyerAlerteBestEffort(
      '[ALERTE] Newsletter envoyée mais non archivée',
      `<p>La newsletter du ${ctx.weekLabel} est bien partie (broadcast ${broadcastId}), mais sa ligne d'historique n'a pas pu être écrite : ${decrireErreur(erreurHistorique)}</p>`
      + `<p>À réécrire à la main : week_start ${weekStartStr}, week_end ${weekEndStr}, subscriber_count ${subscriberCount}.</p>`,
    )
    return NextResponse.json({ sent: 'broadcast', broadcastId, subscribers: subscriberCount, historique: 'echec' })
  }

  return NextResponse.json({ sent: 'broadcast', broadcastId, subscribers: subscriberCount })
}

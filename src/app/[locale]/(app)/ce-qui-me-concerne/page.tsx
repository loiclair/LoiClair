// « Ce qui me concerne » (entrée « Pour moi » du menu) : le lecteur coche les profils
// qui décrivent sa vie, et la page liste les articles et amendements qui pourraient le
// concerner, avec la raison. Le classement est fait à l'avance par une IA
// (`pipeline/classer_articles.py`, vue `impacts_courants`) ; la page ne fait que
// le lire et le filtrer.
//
// Server component figé, régénéré chaque nuit (`/api/revalidate`). Il n'embarque que
// l'index : pour chaque dossier classé, son statut, ses dates, son groupe, ses thèmes et
// tous ses profils, de quoi filtrer, compter et trier dans le navigateur. Le contenu se charge
// ensuite en blocs fixes, tous et les mêmes pour tout le monde
// (`/api/ce-qui-me-concerne/tout`) : aucune requête ne dit ce que le lecteur a coché
// ni ce qu'il cherche (D-243).

export const revalidate = 172800;
export const dynamic = 'force-static';

import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import { initiateurAffiche, type InitiateurSource } from '@/lib/origine-gouvernementale';
import { DOSSIERS_PAR_BLOC, etatDe, profilsParDossier } from '@/lib/ce-qui-me-concerne';
import { libelleTheme } from '@/lib/themes-dossiers';
import prompt from '@/lib/prompts/ce-qui-me-concerne.json';
import CeQuiMeConcerneClient, { type IndexConcerne } from './CeQuiMeConcerneClient';
import { buildAlternates } from '@/lib/og-metadata';

const ETATS_INDEX = { aVoter: 1, adopte: 2, promulgue: 3 } as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'ceQuiMeConcerne' });
  return {
    title: `${t('titre')} — LoiClair`,
    description: t('lede'),
    alternates: buildAlternates(locale, '/ce-qui-me-concerne'),
    // Marquage lisible par machine (art. 50 de l'AI Act, D-002), comme la fiche dossier.
    other: { 'ai-generated': 'true', 'ai-model': 'claude-haiku-5-5', 'ai-provider': 'Anthropic' },
  };
}

type DossierIndex = InitiateurSource & { uid: string; statut_final: string | null; date_depot: string | null; themes: string[] | null };

/** L'index de la page, en tableaux plutôt qu'en objets : il voyage dans le HTML de
 *  chaque visite, pour environ 2 000 dossiers. Construit par langue : les libellés des
 *  thèmes y sont déjà traduits, le namespace `themesDossiers` n'étant pas envoyé au
 *  navigateur (`i18n/messages-client.ts`). */
async function construireIndex(locale: string): Promise<IndexConcerne> {
  const tThemes = await getTranslations({ locale, namespace: 'themesDossiers' });
  const profils = await profilsParDossier();
  const rangProfil = new Map(prompt.profils.map((p, i) => [p.id, i]));
  // Tous les dossiers : la boucle plus bas écarte ceux qui ne sont pas classés.
  // `initiateur_acteur_ref` est un objet jsonb, la forme qu'attendent les appelants :
  // jsonb range ses clés par longueur de nom puis par ordre alphabétique
  // (`nom`, `groupe`, `prenom`), pas dans l'ordre du select.
  const [dossiers, metas] = await Promise.all([
    sql<DossierIndex[]>`
      select d.uid, d.statut_final, d.date_depot, d.themes, d.initiateur_groupe_libelle, d.textes_associes_refs,
        (select jsonb_build_object('prenom', a.prenom, 'nom', a.nom,
            'groupe', (select jsonb_build_object('libelle', o.libelle) from organes o where o.uid = a.groupe))
          from acteurs a where a.uid = d.initiateur_acteur_ref) as initiateur_acteur_ref
      from dossiers_legislatifs d
      order by d.uid`,
    sql<{ uid: string; derniere_activite: string | null }[]>`
      select uid, derniere_activite from dossiers_liste_meta order by uid`,
  ]);
  const activite = new Map(metas.map((m) => [m.uid, m.derniere_activite]));
  // Les thèmes des seuls dossiers classés, triés sur le libellé dans la langue (le
  // thème brut départage) : `FilterBar` garde l'ordre reçu.
  const themes = [...new Set(dossiers.filter((d) => profils.has(d.uid)).flatMap((d) => d.themes ?? []))]
    .map((theme) => ({ theme, libelle: libelleTheme(theme, tThemes) }))
    .sort((a, b) => a.libelle.localeCompare(b.libelle, locale) || a.theme.localeCompare(b.theme));
  const rangTheme = new Map(themes.map((t, i) => [t.theme, i]));
  const groupes: string[] = [];
  const rangGroupe = new Map<string, number>();
  const lignes: IndexConcerne['dossiers'] = [];
  for (const d of dossiers) {
    const ps = profils.get(d.uid);
    if (!ps) continue;
    const groupe = initiateurAffiche(d).groupe;
    if (groupe && !rangGroupe.has(groupe)) rangGroupe.set(groupe, groupes.push(groupe) - 1);
    const etat = etatDe(d.statut_final);
    lignes.push([
      d.uid,
      etat ? ETATS_INDEX[etat] : 0,
      d.date_depot?.slice(0, 10) ?? '',
      activite.get(d.uid)?.slice(0, 10) ?? '',
      groupe ? rangGroupe.get(groupe)! : -1,
      ps.map((p) => rangProfil.get(p)).filter((i): i is number => i !== undefined),
      (d.themes ?? []).map((t) => rangTheme.get(t)!),
    ]);
  }
  return { version: Date.now().toString(36), blocs: Math.ceil(profils.size / DOSSIERS_PAR_BLOC), groupes, themes, dossiers: lignes };
}

export default async function CeQuiMeConcernePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Le bandeau vient d'`AppShell` (`PAGES_ACCUEIL` de `lib/navigation.tsx`), comme
  // pour les autres entrées du menu sans page sœur.
  return <CeQuiMeConcerneClient index={await construireIndex(locale)} />;
}

// src/lib/search/site-pages.ts
// Les pages du site que la recherche globale (`RechercheGlobale`) propose à côté
// des textes et des élus : sous-pages du menu (Chiffres, Comprendre), articles
// des faits, pages IA et pages du projet du pied de page. Tout est construit dans
// le navigateur à partir des libellés déjà traduits, sans index à télécharger.

'use client';

import { useMemo } from 'react';
import MiniSearch from 'minisearch';
import { useLocale, useTranslations } from 'next-intl';
import { processTerm } from './normalize';
import { useNavCategories } from '@/lib/navigation';
import { FACTS_ARTICLES } from '@/lib/facts-registry';

export type SitePage = {
  href: string;
  titre: string;
  /** Famille affichée sous le titre (« Chiffres », « Les faits », « Comprendre »). */
  famille: string;
  /** Texte cherché en plus du titre, jamais affiché : description de la page. */
  texte: string;
  /** Photo de l'article (registre des faits), en vignette dans les résultats.
   *  Absente pour les pages du menu et du pied de page, sauf `/Activite`, qui
   *  est aussi au registre et en reprend la photo. */
  image?: string;
};

// Pages du pied de page qui n'ont pas d'entrée de menu. Les clés sont celles que
// `Footer.tsx` lit déjà ; `/newsletter` et `/about` en font partie parce qu'on
// les cherche par leur nom.
const PAGES_COMPRENDRE_PIED = [
  { href: '/documentation/choix-modele-ia', cle: 'choixModeleIA' },
  { href: '/documentation/prompts-ia', cle: 'promptsIA' },
  { href: '/documentation/conformite-ia', cle: 'aiCompliance' },
  { href: '/documentation/mcp', cle: 'mcp' },
] as const;

const PAGES_PROJET_PIED = [
  { href: '/about', cle: 'about' },
  { href: '/newsletter', cle: 'newsletter' },
  { href: '/documentation/corrections', cle: 'corrections' },
  { href: '/nous-aider', cle: 'helpUs' },
] as const;

export type SitePagesIndex = {
  /** Pages qui contiennent tous les mots de `query`, les mieux classées d'abord. */
  chercher: (query: string) => SitePage[];
};

/**
 * Liste traduite des pages et son petit moteur, reconstruits à chaque changement
 * de langue. Mêmes réglages que les index des textes et des élus (préfixe,
 * tolérance aux fautes, chaque mot resserre, `processTerm` commun) pour qu'une
 * requête se comporte pareil dans les trois groupes de résultats.
 */
export function useSitePages(): SitePagesIndex {
  const locale = useLocale();
  const t = useTranslations();
  const categories = useNavCategories();

  return useMemo(() => {
    const parHref = new Map<string, SitePage>();
    const ajouter = (p: SitePage) => {
      const deja = parHref.get(p.href);
      // `/Activite` est à la fois au menu et au registre des faits : on garde le
      // libellé du menu, et la question de l'article devient cherchable.
      // Sa photo d'article sert aussi de vignette à l'entrée du menu.
      if (deja) {
        deja.texte = `${deja.texte} ${p.titre} ${p.texte}`;
        deja.image ??= p.image;
      }
      else parHref.set(p.href, p);
    };

    for (const cat of categories) {
      for (const l of cat.subLinks ?? []) {
        ajouter({ href: l.href, titre: l.label, famille: cat.label, texte: l.description ?? '' });
      }
    }
    for (const a of FACTS_ARTICLES) {
      // Le thème (« Représentativité ») n'apparaît souvent ni dans la question
      // ni dans la description : sans lui, chercher le nom d'une série ne
      // trouverait aucun de ses chapitres.
      ajouter({
        href: a.href,
        titre: t(`kpisHub.${a.titleKey}`),
        famille: t('kpis.pageTitle'),
        texte: `${t(`kpisHub.${a.categoryKey}`)} ${t(`${a.description.namespace}.${a.description.key}`)}`,
        image: a.image,
      });
    }
    for (const p of PAGES_COMPRENDRE_PIED) {
      ajouter({ href: p.href, titre: t(`footer.${p.cle}`), famille: t('nav.comprendre'), texte: t('nav.transparenceIA') });
    }
    for (const p of PAGES_PROJET_PIED) {
      ajouter({ href: p.href, titre: t(`footer.${p.cle}`), famille: t('footer.project'), texte: '' });
    }

    const mini = new MiniSearch<SitePage>({
      idField: 'href',
      fields: ['titre', 'famille', 'texte'],
      processTerm: (term) => processTerm(term) ?? '',
      searchOptions: {
        fuzzy: 0.2,
        prefix: true,
        combineWith: 'AND',
        boost: { titre: 3 },
      },
    });
    mini.addAll([...parHref.values()]);

    const chercher = (query: string): SitePage[] => {
      const q = query.trim();
      if (!q) return [];
      return mini
        .search(q)
        .map((h) => parHref.get(h.id as string))
        .filter((p): p is SitePage => !!p);
    };
    return { chercher };
    // `locale` suffit à dire quand les libellés changent : `categories` est un
    // tableau neuf à chaque rendu (`useNavCategories`), et `t` ne change qu'avec
    // la langue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);
}

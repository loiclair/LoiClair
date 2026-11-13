<img src=".github/logo-loiclair.svg" alt="" height="104">

# LoiClair

**Le tableau de bord citoyen de l'activité législative française.**

LoiClair rend les lois, débats et votes du Parlement compréhensibles par tous, sans expertise juridique. Grâce à l'IA et aux données ouvertes officielles, chaque citoyen peut suivre ce que fait la République, simplement.

Le site est édité par l'association LoiClair, association loi 1901 sans but lucratif (RNA W751286466).

[Voir le site](https://loiclair.fr) · [Signaler un problème](https://github.com/loiclair/LoiClair/issues)

---

## Fonctionnalités

- **État des lieux** : le tableau de bord d'ouverture, l'essentiel de la législature en un écran
- **Fil d'actualité** — activité législative mensuelle en un coup d'oeil
- **Dossiers législatifs** — parcourir, filtrer et comprendre les textes de loi en cours, avec recherche par mots-clés, jusque dans ce que chaque article ou amendement adopté change concrètement
- **Résumés IA** — chaque loi expliquée en langage clair avec ses impacts concrets (GPT-6 Luna via Mammouth, choisi par un banc d'essai publié)
- **Débats** : le compte rendu des séances et une synthèse IA des débats, dossier par dossier
- **Votes** : une page par scrutin public à liste nominative, avec sa propre adresse à partager, un hémicycle où chaque élu est un point rangé avec son groupe, la position de chaque groupe, ceux qui ont voté contre leur groupe et le vote de chaque élu, les autres votes du même texte, et une image de partage propre au vote ; la fiche d'un texte, celle d'un élu, le fil d'actualité, la newsletter et le quiz d'affinité y mènent
- **Ce qui me concerne** : le lecteur coche ce qui décrit sa situation (locataire, retraité, chef de TPE…) et voit les articles et amendements qui pourraient le concerner, avec la raison et le passage cité ; classement fait chaque nuit par Claude Haiku 5.5 ; cases cochées, tri et recherche restent dans le navigateur, qui charge le même contenu pour tout le monde
- **Les élus** : la fiche de chaque parlementaire et membre du Gouvernement, avec le résultat de l'élection qui lui a donné son siège (législatives 2024, sénatoriales 2023 et 2026) et la part de ses votes finaux où il a voté comme chaque groupe de sa chambre, et la recherche de ses élus par code postal pour les contacter ; depuis la fiche d'un texte, écrire aussi à son auteur ou à ses rapporteurs, ou au Premier ministre par son formulaire pour un texte du Gouvernement ; sur cette même fiche, les élus les plus actifs sur le texte, chambre par chambre, classés par un score qui fond prises de parole en séance, amendements déposés et présences en commission à l'Assemblée, avec la méthode du score d'activité
- **Activité** : le classement de l'activité des parlementaires, avec une méthode publiée ; depuis l'annuaire des élus ou la fiche d'un élu, deux élus de la même chambre se comparent face à face, score, quatre fonctions et leurs mesures, jours de mandat, cohésion avec le groupe, taux d'adoption des amendements et sujets de prédilection
- **Faits** : des articles chiffrés sur la promulgation et l'application des lois, les délais, la représentativité, la loyauté aux groupes, le budget de l'Assemblée et du Sénat
- **Quiz** : un quiz d'affinité politique fondé sur de vrais scrutins, et un quiz sur le processus législatif
- **Processus législatif** — comprendre comment une loi est fabriquée, étape par étape
- **Newsletter** : le récapitulatif hebdomadaire de l'activité législative, par email
- **Recherche globale** : depuis le menu de chaque page (ou ⌘K), une seule recherche dans les textes, les élus et les pages du site, exécutée dans le navigateur sans que la requête parte au serveur
- **Signalement citoyen** — signaler une erreur ou un problème directement depuis chaque page
- **Bilingue FR/EN** — interface disponible en français et en anglais, avec toggle instantané ; sur la version anglaise, le titre de chaque dossier, des lois publiées et des scrutins affichés est traduit chaque nuit par Claude Haiku 5.5, avec la mention IA et le titre officiel français sur la fiche du dossier ; le résumé des décisions du Conseil constitutionnel est écrit dans les deux langues
- **Serveur MCP** : les données du site interrogeables depuis un assistant IA (Claude, ChatGPT…), en lecture seule et sans compte, avec dix outils et un lien LoiClair dans chaque réponse
- **Documentation** : glossaire, choix du modèle IA et son banc d'essai, prompts IA publiés, conformité IA, journal des corrections et branchement d'un assistant IA
- **Nous aider** : l'appel aux fondations et mécènes, et l'engagement de refuser tout financement politique

## Stack technique

| Couche | Technologies |
|---|---|
| Frontend | [Next.js](https://nextjs.org) 16, [React](https://react.dev) 19, [TypeScript](https://www.typescriptlang.org) 6 |
| UI | [Tailwind CSS](https://tailwindcss.com) v4, [shadcn/ui](https://ui.shadcn.com), [Framer Motion](https://www.framer.com/motion), [Recharts](https://recharts.org), [next-intl](https://next-intl.dev) |
| Base de données | [PostgreSQL](https://www.postgresql.org), interrogé en SQL direct ([postgres.js](https://github.com/porsager/postgres) côté site, psycopg côté imports) |
| IA | GPT-6 Luna via [Mammouth](https://mammouth.ai) (API compatible OpenAI) et [Vercel AI SDK](https://ai-sdk.dev) ; Claude Haiku 5.5 par l'[API Anthropic](https://docs.claude.com) pour la fiche courte des dossiers (résumé et thèmes), le classement de « Ce qui me concerne » (par lots) et la traduction anglaise des titres des dossiers, des lois et des scrutins |
| Services | [Upstash Redis](https://upstash.com) (limite de requêtes), [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) (anti-robot), [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) (mesure d'audience sans cookie), [Resend](https://resend.com) (emails) |
| Pipeline de données | Python + GitHub Actions (import quotidien depuis l'open data de l'Assemblée nationale, du Sénat et de Légifrance) |
| Hébergement | Un serveur privé virtuel (VPS) chez [OVHcloud](https://us.ovhcloud.com), aux États-Unis, piloté par [Coolify](https://coolify.io) : le site y tourne en image Docker, derrière [Cloudflare](https://www.cloudflare.com) |

## Architecture

```
src/
├── app/
│   └── [locale]/               # Toutes les routes sont préfixées fr/ ou en/
│       ├── (landing)/          # Page d'accueil publique
│       ├── (app)/              # Routes principales
│       │   ├── etat-des-lieux/ # Tableau de bord d'ouverture
│       │   ├── dossiers-legislatifs/
│       │   │   └── [uid]/
│       │   │       ├── resume-ia/  # Résumé IA du dossier
│       │   │       └── debats/     # Compte rendu et synthèse IA des débats
│       │   ├── Scrutins/[uid]/ # Page d'un vote : groupes et élus, à partager
│       │   ├── Amendements/[uid]/ # Page d'un amendement adopté : texte, auteur, vote, débats
│       │   ├── Facts/          # Articles de données chiffrées
│       │   ├── Month/          # Fil d'actualité
│       │   ├── ce-qui-me-concerne/ # Articles et amendements classés par situation de lecteur
│       │   ├── les-elus/       # Annuaire et fiches des parlementaires
│       │   ├── Activite/       # Classement d'activité parlementaire
│       │   ├── Quiz/           # Quiz affinité + processus législatif
│       │   ├── processus-legislatif/ # Page pédagogique (organes + parcours + types)
│       │   ├── newsletter/     # Inscription, confirmation, désabonnement
│       │   ├── about/
│       │   ├── nous-aider/     # Appel aux mécènes et engagement de neutralité
│       │   ├── documentation/  # Glossaire, choix du modèle IA, prompts IA, conformité IA, corrections, serveur MCP
│       │   └── mentions-legales/, confidentialite/
│       └── layout.tsx          # NextIntlClientProvider + thème
├── app/api/
│   ├── resume-loi/             # Résumé IA d'un dossier
│   ├── resume-debats/          # Synthèse IA des débats d'un dossier
│   ├── search-index/           # Index de recherche des acteurs, et des dossiers en trois morceaux : liste, résumés de recherche, ce que chaque texte change
│   ├── ce-qui-me-concerne/     # Contenu de « Ce qui me concerne » en blocs fixes, et détail d'un élément
│   ├── scrutin-votes/          # Détail nominatif d'un scrutin, pour le tiroir de la fiche d'un texte
│   ├── amendements/[uid]/      # Détail d'un amendement adopté, pour son tiroir sur la fiche d'un texte
│   ├── amendements/[uid]/autres/ # Tous les autres amendements adoptés sur son article, au clic sur « Voir les N autres »
│   ├── dossiers/[uid]/amendements/ # Tous les amendements adoptés d'un dossier, chargés à l'ouverture du panneau
│   ├── dossiers/[uid]/elus-actifs/ # Tous les élus les plus actifs d'un dossier, chargés à l'ouverture du panneau
│   ├── elus/[uid]/paroles/     # Texte des interventions d'un élu, chargé à l'ouverture du tiroir de sa fiche
│   ├── comparer-elus/          # Score d'activité de deux élus de la même chambre, pour la comparaison de l'annuaire et des fiches
│   ├── elus-contact/           # Députés et sénateurs en exercice, pour la recherche d'élus faite dans le navigateur
│   ├── newsletter/             # Inscription, confirmation, envoi, désabonnement
│   ├── og/                     # Images de partage : celle du site (une par langue), celles des résultats de quiz, celle de chaque vote et celle de chaque amendement adopté par scrutin public
│   ├── signaler/               # Signalements citoyens (issues GitHub)
│   ├── adhesion/               # Demandes d'adhésion à l'association, transmises par email au bureau
│   ├── feedback/, view-dossier/, view-elu/ # Avis des lecteurs et compteurs de vues
│   ├── mcp/                    # Serveur MCP : dix outils en lecture seule pour les assistants IA
│   ├── revalidate/             # Rafraîchissement des pages figées, appelé à la fin du run de nuit
│   └── health/                 # Sondes de disponibilité et de fraîcheur des données
├── components/
│   ├── ui/                     # shadcn/ui + graphiques du projet
│   └── ...                     # Composants métier (recherche, filtres, partage)
├── messages/                   # Catalogues de traduction fr.json / en.json
├── lib/
│   ├── db.ts                   # Client Postgres (postgres.js), types réglés pour les appelants
│   ├── debats-texte.ts         # Texte des débats, lu en base avec contrôle de version de la séance
│   ├── prompts.ts              # Prompts et config IA centralisés
│   ├── activite-weights.ts     # Poids et date de méthode du score d'activité
│   ├── facts-registry.ts       # Catalogue des articles Faits
│   ├── mcp/                    # Outils, enveloppe de réponse, cache et codes stables du serveur MCP
│   ├── search/                 # Recherche par mots-clés, exécutée dans le navigateur
│   └── utils.ts                # Utilitaires (cn, etc.)
pipeline/                       # Pipeline d'import des données
.github/workflows/              # GitHub Actions (17 workflows)
```

**Pattern Server/Client** — les pages sont des Server Components qui récupèrent les données (PostgreSQL), puis les passent en props à des Client Components (`"use client"`) pour l'interactivité (filtres, animations, graphiques).

## Pipeline de données

Les données sont importées automatiquement depuis l'[open data de l'Assemblée nationale](https://data.assemblee-nationale.fr) et celui du [Sénat](https://data.senat.fr), via des workflows GitHub Actions. Les principaux :

| Workflow | Fréquence | Description |
|---|---|---|
| `sync-data-nightly.yml` | Quotidien | Vingt-six étapes d'import, listées et lancées dans l'ordre par `pipeline/nightly.py` : acteurs et organes, articles Wikipédia, dossiers, textes, actes, scrutins, réunions de commission, Sénat, rattachement des parlementaires à leur élection, traduction anglaise des titres des dossiers, des lois et des scrutins (seuls les titres nouveaux ou modifiés), amendements, questions, débats, Légifrance, application des lois, découpage des textes en articles et leur classement par situation de lecteur (« Ce qui me concerne »), exposés des motifs des textes déposés, articles de presse, déclarations d'intérêts (HATVP), transparence de l'Assemblée et du Sénat, score d'activité, décisions du Conseil constitutionnel, fiches courtes des dossiers (résumé et thèmes). Le lundi, les liens morts et les lois consolidées sont en plus revérifiés. Une étape rend le verdict, alerte par email et inscrit la date de fraîcheur du site, puis la dernière rafraîchit les pages du site. Une étape tombée se relance seule : `gh workflow run sync-data-nightly.yml -f etapes=senat` (l'email d'échec donne la commande) |
| `sync-rne-weekly.yml` | Hebdomadaire | Import des mandats locaux des parlementaires (Répertoire national des élus). Le registre retardant de plusieurs mois, `pipeline/corrections_rne.json`, tenu à la main après chaque vérification au cas par cas, y ajoute ce qui a changé depuis (fonction ou siège quitté, erreur du registre) et les recours en cours contre une élection, chacun avec une source qui n'est jamais le site d'une assemblée ; relancer le workflow après l'avoir modifié |
| `select-quiz-scrutins-monthly.yml` | Mensuel | Rotation des scrutins du quiz d'affinité politique |
| `reset-popular-dossiers-monthly.yml` | Mensuel | Remise à zéro du compteur des dossiers les plus consultés |
| `newsletter.yml` | Hebdomadaire | Envoi de la newsletter |
| `notify-weekly-signalement-recap.yml` | Hebdomadaire | Récap par email des signalements de la semaine |
| `check-articles-presse-weekly.yml` | Hebdomadaire | Re-vérification des liens vers les articles de presse |
| `cleanup-newsletter-subscribers.yml` | Quotidien | Suppression des inscriptions à la newsletter jamais confirmées |
| `purge-cloudflare.yml` | Après l'import quotidien et chaque mise en ligne | Vide le cache Cloudflare de loiclair.fr |
| `alerte-echec.yml` | Quand un workflow surveillé échoue | Envoie un email d'alerte à l'équipe |

L'heure du cron nocturne se lit dans le workflow, pas ici : GitHub retarde les tâches planifiées d'environ quatre heures et demie, et l'heure a déjà dû être décalée pour éviter une fenêtre où le Sénat publie un dump vide. Le fichier explique le raisonnement.

S'y ajoutent les contrôles du code : `ci.yml` (lint, typecheck et build à chaque push sur `main`, en un seul job), `codeql.yml` et `security-audit.yml` (analyses de sécurité chaque lundi, et à la demande), `deps-weekly.yml` (mises à jour mineures des dépendances chaque lundi) et `lockfile-repair.yml` (régénère le lockfile sous Linux quand `package.json` change).

Les scripts Python d'import se trouvent dans le dossier `pipeline/`. Pour ne pas réécrire chaque nuit une ligne inchangée, la base compare chaque ligne reçue et n'écrit que celles qui changent (`upsert_si_change` de `pipeline/_sync_cache.py`).

L'import des amendements (`import_amendements.py`) tient, en plus des compteurs, la table `amendements` : un amendement adopté par ligne, à l'Assemblée et au Sénat, en séance ou en commission, avec son auteur et le lien vers sa page officielle. Il écrit aussi, sur chaque dossier, la répartition des amendements déposés et adoptés par groupe de l'auteur au jour du dépôt (`amendements_par_groupe`). La section « Modifications du texte » de chaque dossier lit les deux. Sur chaque élu, il range les amendements dont il est l'auteur selon leur sort (adopté, rejeté, tombé, non soutenu, retiré, irrecevable, en attente : `amendements_par_sort`) ; la section « Amendements » de la fiche élu lit ces comptes et la liste de ses adoptés. Il compte enfin les amendements déposés par chaque élu sur chaque dossier (`dossier_amendements_elus`), que lit la section « Les plus actifs dans ce dossier », avec les prises de parole en séance et les présences en commission de l'Assemblée, rattachées au texte par l'ordre du jour de chaque réunion (`commission_reunions_dossiers`, écrite par `import_reunions_an.py`).

Les résultats électoraux viennent des fichiers du ministère de l'Intérieur, par `import_elections.py` en deux passes. `--resultats`, lancé à la main une fois par élection, écrit `election_resultats` : une ligne par circonscription des législatives 2024 ou par département des sénatoriales 2023 et 2026, avec ses tours, ses candidats ou ses listes et leurs voix. Sans argument, l'étape de nuit `elections` recalcule `election_elus` à partir de la base seule : elle rattache chaque parlementaire à son élection par son nom et sa circonscription, et reconnaît les suppléants, les suivants de liste et les élus d'une partielle, qui n'ont qu'une phrase sur leur fiche. Les fautes du ministère dans un nom se corrigent dans `pipeline/corrections_elections.json`, une source par correction.

## Statut du code

Ce code est publié pour être lu et audité : chacun peut vérifier comment LoiClair importe les données officielles, calcule ses chiffres et demande ses résumés à l'IA. Il est fourni tel quel, sans aide à l'installation ni au déploiement. Le faire tourner suppose une base de données et des services qui ne sont pas fournis ici.

Les pull requests ne sont pas acceptées. Une erreur sur le site ou dans le code se signale depuis le lien « Signaler un problème » de chaque page, ou par une [issue](https://github.com/loiclair/LoiClair/issues).

Contact : [contact@loiclair.fr](mailto:contact@loiclair.fr)

## Sources de données

Les données législatives proviennent de sources officielles ouvertes, sans modification ni interprétation partisane :

- [Assemblée nationale — Open Data](https://data.assemblee-nationale.fr) (source primaire)
- [Assemblée nationale](https://www.assemblee-nationale.fr) — baromètre d'application des lois, registres de déontologie
- [Sénat, open data](https://data.senat.fr)
- [Sénat](https://www.senat.fr) : registres de déontologie
- [Conseil constitutionnel](https://www.conseil-constitutionnel.fr)
- [Légifrance](https://www.legifrance.gouv.fr)
- [Haute Autorité pour la transparence de la vie publique](https://www.hatvp.fr) — déclarations d'intérêts des parlementaires
- [Répertoire national des élus](https://www.data.gouv.fr/datasets/repertoire-national-des-elus-1) (ministère de l'Intérieur)
- [Résultats des élections](https://www.data.gouv.fr/pages/donnees-des-elections/) (ministère de l'Intérieur) : législatives 2024, sénatoriales 2023 et 2026
- [Insee](https://www.insee.fr) et [API Géo](https://geo.api.gouv.fr)

Trois sources non officielles complètent ces données :

- [Wikipédia](https://fr.wikipedia.org), sous licence CC BY-SA, pour le lien vers l'article de chaque élu
- [Wikidata](https://www.wikidata.org), pour relier chaque élu à son article Wikipédia
- [Google Actualités](https://news.google.com), pour les liens vers les articles de presse consacrés à un dossier

La liste affichée sur la page « À propos » et sur l'accueil vit dans `src/lib/sources.ts`.

## Licence

Copyright (C) 2026 Xelanidog. Ce projet est distribué sous licence [GNU AGPL v3](./LICENSE).

Cela signifie que vous êtes libre de l'utiliser, le modifier et le redistribuer, à condition de garder le code source ouvert sous la même licence. Si vous déployez une version modifiée comme service web, vous devez en publier le code source.

### Exception : médias appartenant à des tiers

L'AGPL v3 couvre le **code** de ce dépôt, et lui seul. Les fichiers ci-dessous appartiennent à leurs titulaires respectifs et ne sont pas concédés avec le code :

- `public/images/groupes/` : logos des groupes politiques de l'Assemblée nationale et du Sénat, nommés par uid du groupe ; la table `src/lib/logos-groupes.ts`, qui les liste, est générée depuis ce dossier par `scripts/generate-logos-groupes.mjs`
- `public/images/institutions/` : logos des institutions publiques
- `public/icons/social/` : logos des réseaux sociaux, marques déposées de leurs éditeurs

Ils sont reproduits ici pour identifier l'organisation concernée dans un contexte informatif. Toute réutilisation, y compris depuis un fork de ce dépôt, suppose l'accord de leur titulaire.

`public/departements.svg` et `public/hemicycle-an.svg` proviennent de [Regards Citoyens](https://github.com/regardscitoyens), sous AGPL v3 comme ce projet : respectivement `nosdeputes.fr/web/departements.svg`, dont la largeur et les couleurs ont été adaptées à notre charte, et `mapHemicycle/img/hemicycle-an.svg`, repris tel quel. `public/hemicycle-senat.svg` et `public/hemicycle-senat-bg.png` sont des productions propres à LoiClair.

Les photographies d'illustration de la page « À propos » ne sont pas dans ce dépôt : elles viennent d'[Unsplash](https://unsplash.com), comme celles de la page « Faits ». Le serveur d'images du site les télécharge et les sert depuis notre domaine : le navigateur du lecteur ne contacte jamais Unsplash.

Les portraits des parlementaires ne sont pas dans ce dépôt non plus : ils restent hébergés par l'Assemblée nationale et le Sénat, et le site s'y réfère par un lien.

### Exception : marque LoiClair

Le nom « LoiClair » est réservé. L'AGPL vous autorise à réutiliser le code, pas à publier un service sous cette identité.

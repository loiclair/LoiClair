// Configuration Next.js du site : en-têtes de sécurité (CSP, CORS des routes
// /api), redirections d'anciennes URL, et branchement de next-intl. Lue par
// `next dev` et `next build`, en local comme sur les runners GitHub.
import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Lancé par un agent IA, `next dev` insère sinon un bloc de consignes en
  // anglais dans `CLAUDE.md`, rédigé à la main et en français, et le remet à
  // chaque démarrage. Dans un worktree, où `CLAUDE.md` est absent (gitignoré),
  // il crée en plus un `AGENTS.md` non ignoré, qu'un commit peut emporter.
  agentRules: false,
  // Sortie autonome (un `server.js` et le strict nécessaire de `node_modules`)
  // pour l'image Docker que lance Coolify sur le VPS (D-325), demandée par le
  // seul workflow `image-site.yml`. Ailleurs (local, `ci.yml`, `deps-weekly.yml`),
  // la variable est absente : la clé vaut `undefined`, et la sortie reste normale.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
    ],
  },
  async headers() {
    const isDev = process.env.NODE_ENV === 'development'
    const csp = [
      "default-src 'self'",
      // static.cloudflareinsights.com sert le script de Cloudflare Web Analytics
      // (D-328), que Cloudflare injecte lui-même dans les pages au passage par son
      // proxy : il n'apparaît donc nulle part dans le code. Sans cette source, la
      // CSP le bloque en silence et la mesure d'audience reste vide.
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://challenges.cloudflare.com https://static.cloudflareinsights.com`,
      "style-src 'self' 'unsafe-inline'",
      // Les deux domaines parlementaires servent les portraits officiels des
      // élus, appelés directement par le navigateur (aucune copie chez nous,
      // voir src/lib/photo-elu.ts). Sans eux, la CSP bloque les vignettes en
      // silence : cadre vide et une erreur console que personne ne lit.
      // Unsplash n'y figure pas : ses photos passent toutes par `next/image`, donc
      // par `/_next/image` sur notre domaine (voir `images.remotePatterns`).
      "img-src 'self' data: blob: https://www.google.com https://*.gstatic.com https://challenges.cloudflare.com https://www.assemblee-nationale.fr https://www.senat.fr",
      "font-src 'self'",
      // Pas de source Cloudflare Web Analytics ici : sur un site qui passe par le
      // proxy Cloudflare, ses mesures partent vers /cdn-cgi/rum sur notre propre
      // domaine, que 'self' couvre déjà.
      "connect-src 'self' https://challenges.cloudflare.com",
      "frame-src https://challenges.cloudflare.com",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; ')

    const corsOrigin = (process.env.NEXT_PUBLIC_SITE_URL || 'https://loiclair.fr').trim()

    return [
      {
        source: '/api/(.*)',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: corsOrigin },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ]
  },
  async redirects() {
    return [
      // `www` vers l'apex, seule adresse canonique (`share-url.ts`, `sitemap.ts`).
      // Derrière Coolify, l'app sert les deux noms tels quels, alors que les boutons
      // de partage publient encore `www`.
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.loiclair.fr' }],
        destination: 'https://loiclair.fr/:path*',
        permanent: true,
      },
      {
        source: '/Facts/age-decideurs',
        destination: '/Facts/representativite/age',
        permanent: true,
      },
      {
        source: '/Facts/metiers-des-elus',
        destination: '/Facts/representativite/metiers',
        permanent: true,
      },
      {
        source: '/Facts/activite',
        destination: '/Activite',
        permanent: true,
      },
      // Un dossier n'a pas de page à lui : son contenu vit sur `/resume-ia`, et
      // ses voisines sont `/debats` et `/debats/[seance]`. L'adresse du dossier
      // seul répondait 404, alors que c'est ce qu'on obtient en raccourcissant
      // une URL partagée. Redirigée ici plutôt que par un `page.tsx` appelant
      // `redirect()` : sur une page statique, celui-ci rend un `meta refresh`
      // d'une seconde, soit une page blanche pour le lecteur et une redirection
      // que les moteurs ne suivent pas comme telle.
      //
      // Les deux formes, parce que `redirects()` s'applique avant le middleware
      // de next-intl : la première prend les liens réels, tous préfixés
      // (`localePrefix: 'always'`), la seconde l'adresse tapée sans préfixe.
      {
        source: '/:locale(fr|en)/dossiers-legislatifs/:uid',
        destination: '/:locale/dossiers-legislatifs/:uid/resume-ia',
        permanent: true,
      },
      {
        source: '/dossiers-legislatifs/:uid',
        destination: '/dossiers-legislatifs/:uid/resume-ia',
        permanent: true,
      },
    ];
  },
};

export default withNextIntl(nextConfig);

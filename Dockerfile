# Image du site pour le VPS géré par Coolify (D-325 à D-327).
#
# Elle ne compile rien : `next build` tourne avant, sur le runner GitHub, avec
# `NEXT_OUTPUT=standalone` (workflow `image-site.yml`). Le VPS ne tient pas un
# build Next.js, et les secrets dont le build a besoin pour fabriquer
# les pages statiques restent ainsi hors de `docker build` : l'image, publique
# sur GHCR, ne reçoit que le résultat.
#
# Le runner et le VPS sont tous deux en x86_64, et `node:24-slim` est une
# Debian (glibc) comme Ubuntu : les binaires natifs copiés depuis
# `node_modules` (sharp, pour `next/image`) tournent tels quels.
FROM node:24-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

WORKDIR /app

# Propriétaire `node`, pas root : le serveur écrit dans `.next` au fil des
# requêtes (pages ISR régénérées sous `.next/server`, cache de `fetch` sous
# `.next/cache`), et il tourne sous cet utilisateur.
# `standalone` ne contient ni `.next/static` ni `public` : Next les laisse à
# un CDN, ici c'est le serveur qui les sert, d'où les deux copies à part.
COPY --chown=node:node .next/standalone ./
COPY --chown=node:node .next/static ./.next/static
COPY --chown=node:node public ./public

USER node
EXPOSE 3000
CMD ["node", "server.js"]

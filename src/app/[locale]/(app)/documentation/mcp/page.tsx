// Page `/documentation/mcp` : comment brancher un assistant IA sur les données de
// LoiClair, ce que le serveur sait répondre, et ce qu'il ne rend jamais.
//
// Aucune donnée n'est lue ici : la liste des outils est une constante de cette
// page. Elle ne figure donc pas dans les chemins rafraîchis par `/api/revalidate`,
// qui ne sert qu'aux pages dont le contenu vient de la base. La minuterie ci-dessous
// n'existe que pour le badge de dernière mise à jour du pied de page.
export const revalidate = 86400;

import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Terminal, ShieldCheck, Link2 } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { buildAlternates } from '@/lib/og-metadata';

/**
 * L'adresse que les clients collent. Le chemin est celui de `src/app/api/mcp/route.ts`.
 *
 * Sans `www` : la forme en `www` répond 308 vers l'apex, que `share-url.ts` et
 * `sitemap.ts` déclarent canonique. C'est la seule chaîne de la page qu'un
 * lecteur recopie, elle ne doit pas le faire passer par une redirection.
 */
const ADRESSE_SERVEUR = 'https://loiclair.fr/api/mcp';

/**
 * Les dix outils, dans l'ordre où un lecteur les découvrirait.
 *
 * Recopiés ici plutôt qu'importés de `src/lib/mcp/` : la page tirerait sinon
 * `mcp-handler` et le client de la base (`db.ts`) dans son rendu, pour afficher dix noms.
 * En contrepartie, un outil ajouté se déclare aux deux endroits, d'où ce
 * commentaire, qui est le seul rappel qui existe.
 */
const OUTILS = [
  'catalogueFacts',
  'chercherElu',
  'ficheElu',
  'votesElu',
  'chercherLoi',
  'ficheLoi',
  'trouverTexte',
  'detailScrutin',
  'chiffresCles',
  'actualite',
] as const;

/** Ce que le serveur ne rend jamais, et pourquoi. */
const EXCLUSIONS = ['resumesIA', 'debats', 'centiles', 'agregations'] as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'mcp' });
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: buildAlternates(locale, '/documentation/mcp'),
  };
}

export default async function McpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'mcp' });

  return (
    // Cadre de 90rem comme les autres pages de `/documentation`, pour que le texte
    // parte sous le titre de l'en-tête commun ; la colonne de 48rem, collée à
    // gauche, garde des lignes courtes. Centrer cette colonne la décalait du titre.
    <div className="container mx-auto py-6 max-w-[90rem]">
      <div style={{ maxWidth: '48rem' }}>
        {/* Le titre vit dans l'en-tête commun (`usePageHero`). */}
        <p className="text-muted-foreground" style={{ fontSize: '1rem', lineHeight: 1.6 }}>
          {t('chapo')}
        </p>

        <Card className="mt-8 border-primary/30 bg-primary/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              <p className="font-semibold" style={{ fontSize: '0.875rem' }}>
                {t('adresse.titre')}
              </p>
            </div>
            <code
              className="mt-3 block rounded bg-background px-3 py-2 font-mono break-all"
              style={{ fontSize: '0.8125rem' }}
            >
              {ADRESSE_SERVEUR}
            </code>
            <p className="mt-3 text-muted-foreground" style={{ fontSize: '0.8125rem', lineHeight: 1.6 }}>
              {t('adresse.aide')}
            </p>
          </CardContent>
        </Card>

        <Separator className="my-10" />

        <h2 className="font-semibold" style={{ fontSize: '1.25rem' }}>
          {t('outils.titre')}
        </h2>
        <p className="mt-2 text-muted-foreground" style={{ fontSize: '0.875rem', lineHeight: 1.6 }}>
          {t('outils.chapo')}
        </p>
        <ul className="mt-6">
          {OUTILS.map((cle, i) => (
            <li key={cle}>
              {i > 0 && <Separator />}
              <div className="py-3">
                <p className="font-medium" style={{ fontSize: '0.9375rem' }}>
                  {t(`outils.${cle}Titre`)}
                </p>
                <p className="mt-1 text-muted-foreground" style={{ fontSize: '0.8125rem', lineHeight: 1.6 }}>
                  {t(`outils.${cle}Desc`)}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <Separator className="my-10" />

        <h2 className="font-semibold" style={{ fontSize: '1.25rem' }}>
          {t('limites.titre')}
        </h2>
        <p className="mt-2 text-muted-foreground" style={{ fontSize: '0.875rem', lineHeight: 1.6 }}>
          {t('limites.chapo')}
        </p>
        <ul className="mt-6">
          {EXCLUSIONS.map((cle, i) => (
            <li key={cle}>
              {i > 0 && <Separator />}
              <div className="flex gap-3 py-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium" style={{ fontSize: '0.9375rem' }}>
                    {t(`limites.${cle}Titre`)}
                  </p>
                  <p className="mt-1 text-muted-foreground" style={{ fontSize: '0.8125rem', lineHeight: 1.6 }}>
                    {t(`limites.${cle}Desc`)}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <Separator className="my-10" />

        <h2 className="font-semibold" style={{ fontSize: '1.25rem' }}>
          {t('attribution.titre')}
        </h2>
        <div className="mt-4 flex gap-3">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground" style={{ fontSize: '0.875rem', lineHeight: 1.6 }}>
            {t('attribution.texte')}
          </p>
        </div>
      </div>
    </div>
  );
}

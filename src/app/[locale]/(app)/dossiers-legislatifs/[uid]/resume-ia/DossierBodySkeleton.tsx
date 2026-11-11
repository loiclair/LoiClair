// Skeleton du corps du dossier (sans hero), fallback du <Suspense> de page.tsx
// pendant que les requêtes lourdes streamment. La fiche n'a plus de loading.tsx :
// en `force-static`, il partait dans le même paquet que la page et ne s'affichait
// jamais en production.
//
// La structure de la page est connue à l'avance : on rend déjà tous les titres
// de section et les cadres AI. Seul le contenu
// dépendant des données du dossier est en skeleton (résumé, arguments,
// timeline, articles, sources).

import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Skeleton } from '@/components/ui/skeleton';
import { AI_FRAME_STYLE, AI_INNER_STYLE, AIBadge } from './AICardElements';
import { CLE_PLI, IconeAncre, IconeSection, SECTIONS_HORS_CONTROLE } from './SectionsDossier';
import SectionRepliable from '@/components/SectionRepliable';
import BarreAncres from '@/components/BarreAncres';
import { BadgeIA } from '@/components/ChangementsConcernes';

// Sections IA (Résumé, Débat) : réutilise le même style que ResumeIAClient/ArgumentsPourContre
// Sections statiques (Parcours, Presse, Sources) : cadre simple via rounded-xl
const aiInnerStyle = { ...AI_INNER_STYLE, padding: '20px 24px' };
const plainCardStyle = { border: '1px solid var(--color-border)', backgroundColor: 'var(--card)', padding: '20px' };

/** `pourVous` : le texte touche au moins un profil de « Ce qui me concerne » (le
 *  chemin rapide de la page le sait déjà). Sans lui, le vrai corps ne met dans la
 *  section qu'une phrase d'absence, que la coquille rend telle quelle : une coquille
 *  de trois lignes se replierait d'un coup au basculement et tirerait toute la suite.
 *  `modifications` : le dossier a au moins un amendement déposé (compteur du chemin
 *  rapide). Sans lui, la section « Modifications du texte » n'a que sa phrase
 *  d'absence, rendue ici telle quelle. Il décide aussi de la coquille de « Les plus
 *  actifs dans ce dossier », dont le contenu dépend du heavy path : un texte amendé
 *  a presque toujours des élus à y montrer, et c'est le seul indice que le chemin
 *  rapide connaisse. Sans lui, la coquille ne réserve qu'une ligne neutre : un texte
 *  sans amendement peut avoir des élus actifs (paroles, commission), et la phrase
 *  d'absence affirmerait le contraire le temps du chargement.
 *  `cc` : le dossier a une décision du Conseil constitutionnel (`ccActe`, connu du
 *  chemin rapide). Avec elle, la coquille réserve une carte ; sans elle, une ligne.
 *  `controle` : dossier de contrôle ; les sections de `SECTIONS_HORS_CONTROLE` sont
 *  retirées, comme dans le vrai corps. */
export default async function DossierBodySkeleton({ locale = 'fr', pourVous = false, modifications = false, cc = false, controle = false }: { locale?: string; pourVous?: boolean; modifications?: boolean; cc?: boolean; controle?: boolean }) {
  const t = await getTranslations({ locale, namespace: 'resumeIA' });
  const argsForLabel = locale === 'en' ? 'Arguments in favor' : 'Arguments en faveur';
  const argsAgainstLabel = locale === 'en' ? 'Arguments against' : 'Arguments contre';
  const cles = (['resume', 'pourVous', 'debat', 'parcours', 'modifications', 'cc', 'elus', 'sources', 'presse'] as const)
    .filter((cle) => !controle || !SECTIONS_HORS_CONTROLE.has(cle));
  // Le libellé se déduit de la clé (`debat` → `anchorDebat`), sauf `cc` dont la clé
  // de traduction est `anchorCC`, sigle entier en capitales.
  const ancres = cles.map((cle) => ({
    cle,
    label: cle === 'cc' ? t('anchorCC') : t(`anchor${cle.charAt(0).toUpperCase()}${cle.slice(1)}`),
    icone: <IconeAncre cle={cle} />,
  }));

  return (
    <div className="container mx-auto pb-8 md:pb-10 max-w-[90rem]">
      {/* La barre d'ancres et les coquilles de section sont rendues à
          l'identique du vrai corps : c'est ce qui évite le saut de mise en page
          au basculement du `<Suspense>`. */}
      <BarreAncres ariaLabel={t('anchorsNavLabel')} ancres={ancres} />
      <div>

        {/* SECTION — Le résumé */}
        <SectionRepliable
          cle="resume"
          cleStockage={CLE_PLI}
          icone={<IconeSection cle="resume" />}
          titre={t('sectionResume')}
          badge={<AIBadge usage="loi" />}
        >
          <div style={AI_FRAME_STYLE}>
            <div style={aiInnerStyle} className="space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="h-4 w-4 rounded-full border-2 border-t-transparent animate-spin shrink-0" style={{ borderColor: '#06B6D4', borderTopColor: 'transparent' }} />
                <span
                  className="text-sm"
                  style={{ color: '#0891B2' }}
                >
                  {locale === 'en' ? 'Analyzing the official text…' : 'Analyse du texte officiel…'}
                </span>
              </div>
              <div className="space-y-2.5">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-4/5" />
                <Skeleton className="h-5 w-3/5" />
              </div>
              <div className="space-y-2.5">
                <Skeleton className="h-4 w-28" />
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-5 w-5 rounded-full shrink-0" />
                    <Skeleton className="h-4" style={{ width: `${85 - i * 7}%` }} />
                  </div>
                ))}
              </div>
              <div className="rounded-lg px-3.5 py-3" style={{ backgroundColor: 'rgba(6,182,212,0.06)' }}>
                <Skeleton className="h-5 w-3/4" />
              </div>
            </div>
          </div>
        </SectionRepliable>

        {/* SECTION : Ce qui change pour vous, présente sur toute fiche. Pour un
            texte classé, sa hauteur dépend des profils du lecteur, inconnus ici ;
            la coquille reprend l'état sans profil : la rangée des gestes (pastille),
            la phrase, puis le pied sous son filet (source et avertissement). */}
        <SectionRepliable
          cle="pourVous"
          cleStockage={CLE_PLI}
          icone={<IconeSection cle="pourVous" />}
          titre={t('sectionPourVous')}
          badge={<BadgeIA />}
        >
          {pourVous ? (
            <div style={AI_FRAME_STYLE}>
              <div style={aiInnerStyle} className="space-y-5">
                <Skeleton className="h-6 w-40 rounded-full" />
                <Skeleton className="h-5 w-4/5" />
                <div className="pt-3 border-t border-border/60 space-y-1.5">
                  <Skeleton className="h-3.5 w-56" />
                  <Skeleton className="h-3 w-3/5" />
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noPourVousData')}</p>
          )}
        </SectionRepliable>

        {/* SECTION — Le débat */}
        <SectionRepliable
          cle="debat"
          cleStockage={CLE_PLI}
          icone={<IconeSection cle="debat" />}
          titre={t('sectionDebat')}
          badge={<AIBadge usage="debats" />}
        >
          <div style={AI_FRAME_STYLE}>
            <div style={aiInnerStyle} className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <ThumbsUp className="h-4 w-4" style={{ color: '#1F8B4C', opacity: 0.5 }} />
                  <span className="text-sm font-semibold" style={{ color: '#1F8B4C', opacity: 0.5 }}>{argsForLabel}</span>
                </div>
                <div className="space-y-4">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="space-y-1.5">
                      <Skeleton className="h-4" style={{ width: `${85 - i * 10}%`, opacity: 0.6 }} />
                      <Skeleton className="h-3" style={{ width: `${70 - i * 8}%`, opacity: 0.4, backgroundColor: '#1F8B4C' }} />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <ThumbsDown className="h-4 w-4" style={{ color: '#B91C1C', opacity: 0.5 }} />
                  <span className="text-sm font-semibold" style={{ color: '#B91C1C', opacity: 0.5 }}>{argsAgainstLabel}</span>
                </div>
                <div className="space-y-4">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="space-y-1.5">
                      <Skeleton className="h-4" style={{ width: `${85 - i * 10}%`, opacity: 0.6 }} />
                      <Skeleton className="h-3" style={{ width: `${70 - i * 8}%`, opacity: 0.4, backgroundColor: '#B91C1C' }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </SectionRepliable>

        {/* SECTION — Le parcours de la loi */}
        <SectionRepliable
          cle="parcours"
          cleStockage={CLE_PLI}
          icone={<IconeSection cle="parcours" />}
          titre={t('sectionParcours')}
        >
          <div className="rounded-xl" style={plainCardStyle}>
            <Skeleton className="h-4 w-2/3 mb-4" />
            <div className="space-y-0">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center" style={{ width: 14 }}>
                    <Skeleton className="h-3.5 w-3.5 rounded-full shrink-0" style={{ marginTop: 3 }} />
                    {i < 4 && <div className="flex-1 border-l-2 border-muted" style={{ minHeight: 36 }} />}
                  </div>
                  <div className="flex-1 pb-3">
                    <div className="flex items-baseline gap-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-3.5 w-28" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SectionRepliable>

        {/* Retirées d'un dossier de contrôle, comme dans le vrai corps. */}
        {!controle && (
          <>
            {/* SECTION : Modifications du texte. La phrase, puis les barres d'une
                chambre à gauche et dix auteurs à droite, comme le vrai bloc. */}
            <SectionRepliable
              cle="modifications"
              cleStockage={CLE_PLI}
              icone={<IconeSection cle="modifications" />}
              titre={t('sectionModifications')}
            >
              {modifications ? (
                <div className="rounded-xl" style={plainCardStyle}>
                  <Skeleton className="h-4 w-1/2 mb-4" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
                    <div className="space-y-3">
                      <Skeleton className="h-3 w-28 mb-3" />
                      {[0, 1, 2, 3, 4].map(i => (
                        <div key={i} className="flex items-center gap-2.5">
                          <Skeleton className="h-3 w-14 shrink-0" />
                          <Skeleton className="h-1.5 rounded-full" style={{ width: `${70 - i * 12}%` }} />
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2.5">
                      <Skeleton className="h-3 w-32 mb-3" />
                      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => (
                        <div key={i} className="flex items-center gap-2.5">
                          <Skeleton className="h-7 w-7 rounded-lg shrink-0" />
                          <Skeleton className="h-4 w-40" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noModificationsData')}</p>
              )}
            </SectionRepliable>

            {/* SECTION : Le contrôle du Conseil constitutionnel. Une carte quand la
                décision existe, sinon la hauteur d'une ligne, celle de la phrase
                d'absence. */}
            <SectionRepliable
              cle="cc"
              cleStockage={CLE_PLI}
              icone={<IconeSection cle="cc" />}
              titre={t('sectionCC')}
            >
              {cc ? (
                <div className="rounded-xl" style={plainCardStyle}>
                  <Skeleton className="h-5 w-40 mb-4" />
                  <div className="space-y-2">
                    <Skeleton className="h-4" />
                    <Skeleton className="h-4" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                </div>
              ) : (
                <Skeleton className="h-5 w-3/5" />
              )}
            </SectionRepliable>
          </>
        )}

        {/* SECTION : Les plus actifs dans ce dossier. Le nom de la chambre
            puis cinq élus par colonne, comme le vrai bloc. */}
        <SectionRepliable
          cle="elus"
          cleStockage={CLE_PLI}
          icone={<IconeSection cle="elus" />}
          titre={t('sectionElus')}
        >
          {modifications ? (
            <div className="rounded-xl" style={plainCardStyle}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
                {[0, 1].map(col => (
                  <div key={col} className="space-y-2.5">
                    <Skeleton className="h-3 w-28 mb-3" />
                    {[0, 1, 2, 3, 4].map(i => (
                      <div key={i} className="flex items-center gap-2.5">
                        <Skeleton className="h-7 w-7 rounded-lg shrink-0" />
                        <Skeleton className="h-4 w-40" />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Skeleton className="h-5 w-3/5" />
          )}
        </SectionRepliable>

        {/* SECTION : Sources et acteurs */}
        <SectionRepliable
          cle="sources"
          cleStockage={CLE_PLI}
          icone={<IconeSection cle="sources" />}
          titre={t('sectionSources')}
        >
          <div className="rounded-xl grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6" style={plainCardStyle}>
            <div className="space-y-2.5">
              <Skeleton className="h-3 w-20 mb-3" />
              {[0, 1, 2].map(i => (
                <Skeleton key={i} className="h-4" style={{ width: `${80 - i * 12}%` }} />
              ))}
            </div>
            <div className="space-y-2.5">
              <Skeleton className="h-3 w-16 mb-3" />
              {[0, 1].map(i => (
                <div key={i} className="flex items-center gap-2.5">
                  <Skeleton className="h-7 w-7 rounded-lg shrink-0" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ))}
            </div>
          </div>
        </SectionRepliable>

        {/* SECTION — Ce sujet dans la presse */}
        <SectionRepliable
          cle="presse"
          cleStockage={CLE_PLI}
          icone={<IconeSection cle="presse" />}
          titre={t('sectionPresse')}
        >
          <div className="rounded-xl" style={plainCardStyle}>
            <Skeleton className="h-4 w-3/4 mb-4" />
            <div className="space-y-1">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex items-start gap-3 py-2.5 px-3">
                  <Skeleton className="h-4 w-4 rounded shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4" style={{ width: `${85 - i * 10}%` }} />
                    <Skeleton className="h-3.5 w-40" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SectionRepliable>

      </div>
    </div>
  );
}


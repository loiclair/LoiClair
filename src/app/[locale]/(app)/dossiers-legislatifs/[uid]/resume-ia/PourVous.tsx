'use client';

// « Ce qui change pour vous » sur la fiche d'un texte : la section placée juste après
// le résumé. Le résumé dit ce que dit le texte ; la section dit ce qu'il change pour
// les profils du lecteur (page « Ce qui me concerne »). Les profils se choisissent
// sans quitter la fiche, dans la fenêtre de `ChoixProfils`, montée par la page, et se
// modifient ou s'oublient depuis le haut de la carte.
//
// Confidentialité (D-243) : la fiche est statique, la même pour tous. Elle embarque
// les phrases de tous les profils pour ce texte, et le navigateur ne garde que celles
// des profils choisis, lus dans son stockage (`useMesProfils`). Aucune requête ne part
// avec un profil ; seul le tiroir demande le détail d'un élément, comme sur la page.
//
// Les profils n'arrivent qu'après l'hydratation : le rendu serveur montre l'état
// « aucun profil ».
//
// Un changement partagé arrive ici par `#changement=<id>` (`lienChangement`) : le
// tiroir de l'élément s'ouvre seul, au montage ou quand l'ancre change. L'ancre reste
// dans le navigateur, la requête de la fiche est la même pour tous (D-243).

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Trash2 } from 'lucide-react';
import { allerASection } from '@/components/BarreAncres';
import { HintIconButton, InfoBulle } from '@/components/ContacterMesElusBanner';
import { ouvrirChoixProfils } from '@/components/ChoixProfils';
import {
  BoutonLien, LigneChangement, STYLE_PETIT, TiroirChangement, changementDuFragment, elementDepuisAncre, lignesDe, useSourceDe, useSurvol, type Changement,
} from '@/components/ChangementsConcernes';
import { ACTIVE_BASE, ACTIVE_HOVER, BASE_PILL_STYLE } from '@/lib/pastille-or';
import { ORDRE_PROFILS, useMesProfils } from '@/hooks/useMesProfils';
import type { DossierConcerne, ElementConcerne } from '@/lib/ce-qui-me-concerne';
import { AI_FRAME_STYLE, AI_INNER_STYLE, AICardFooter } from './AICardElements';

/** Articles montrés par profil avant « Voir les N autres ». Les amendements, eux, ne
 *  sont jamais listés d'emblée : une ligne « + N amendements adoptés » les déplie. Au
 *  plus quatre lignes par profil, quel que soit le texte (75 changements pour le
 *  profil `mineur` de la loi violences sexuelles et sexistes, au 2026-10-17). */
const ARTICLES_VISIBLES = 3;
/** Profils nommés dans « Ce texte touche » et « Aussi touchés » avant « et N autres ». */
const NOMS_VISIBLES = 5;

const STYLE_PHRASE = { fontSize: '0.9375rem', lineHeight: 1.55, color: 'var(--foreground)', margin: 0 } as const;
// Les lignes ont leur propre marge intérieure (fond au survol) : la liste déborde
// d'autant pour que leur texte s'aligne sur celui de la carte.
const STYLE_LISTE = { listStyle: 'none', padding: 0, margin: '0 -16px', display: 'flex', flexDirection: 'column', gap: '0.125rem' } as const;

/** Un profil touché : son nom, ses premiers articles et « Voir les N autres », puis
 *  ses amendements repliés derrière une seule ligne. Chaque amendement y dit l'article
 *  qu'il modifie : ils sont listés à part, pas sous leur article. */
function BlocProfil({ profil, lignes, onOuvrir }: { profil: string; lignes: Changement[]; onOuvrir: (c: Changement) => void }) {
  const t = useTranslations('ceQuiMeConcerne');
  const [articlesEntiers, setArticlesEntiers] = useState(false);
  const [amendementsOuverts, setAmendementsOuverts] = useState(false);
  const articles = lignes.filter((c) => !c.e.propre);
  const amendements = lignes.filter((c) => c.e.propre);
  const montres = articlesEntiers ? articles : articles.slice(0, ARTICLES_VISIBLES);
  const ligne = (c: Changement) => <LigneChangement key={c.e.id} c={c} onOuvrir={() => onOuvrir(c)} dansLeTexte />;
  return (
    <section aria-labelledby={`pour-vous-${profil}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <h3 id={`pour-vous-${profil}`} style={{ fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.35, margin: '0 0 0.25rem' }}>
        {t(`profils.${profil}`)}
      </h3>
      {articles.length > 0 && <ul style={STYLE_LISTE}>{montres.map(ligne)}</ul>}
      {articles.length > ARTICLES_VISIBLES && (
        <span style={{ marginLeft: '-0.25rem' }}>
          <BoutonLien onClick={() => setArticlesEntiers((o) => !o)} aria-expanded={articlesEntiers}>
            {articlesEntiers ? t('voirMoins') : t('voirAutres', { n: articles.length - ARTICLES_VISIBLES })}
          </BoutonLien>
        </span>
      )}
      {amendements.length > 0 && (
        <>
          <span style={{ marginLeft: '-0.25rem' }}>
            <BoutonLien onClick={() => setAmendementsOuverts((o) => !o)} aria-expanded={amendementsOuverts}>
              {/* Le libellé reste le titre du groupe, ouvert ou fermé : « Réduire » à
                  la place se lisait, sous le « Réduire » des articles, comme un
                  doublon sans objet. Le signe dit le sens du geste. */}
              {amendementsOuverts ? '− ' : '+ '}{t('amendementsAdoptes', { n: amendements.length })}
            </BoutonLien>
          </span>
          {amendementsOuverts && <ul style={STYLE_LISTE}>{amendements.map(ligne)}</ul>}
        </>
      )}
    </section>
  );
}

/** Un bouton dans la phrase de `ProfilsNommes`, à la taille de la phrase qui le porte.
 *  Un nom garde la couleur de la phrase, souligné d'un trait pâle qui dit qu'il
 *  s'ouvre, et prend la couleur de lien au survol et tant que son bloc est ouvert :
 *  cinquante noms en couleur de lien chargeaient la carte, et « Réduire » s'y lisait
 *  comme un nom de plus. `action` (« et N autres », « Réduire ») est en couleur de
 *  lien. `BoutonLien` a sa propre taille et sa marge intérieure : en pleine phrase,
 *  il décalait les noms. `actif` dit si ce que le bouton déplie est ouvert.
 *  Le survol ne suit que la souris : sur iPhone, un toucher émet un `mouseenter` sans
 *  `mouseleave`, et un nom refermé restait en couleur de lien, comme s'il était ouvert. */
function BoutonNom({ onClick, actif, action, children }: { onClick: () => void; actif: boolean; action?: boolean; children: ReactNode }) {
  const [survole, setSurvole] = useState(false);
  const vif = action || survole || actif;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={actif}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setSurvole(true); }}
      onPointerLeave={() => setSurvole(false)}
      style={{
        font: 'inherit', background: 'none', border: 0, padding: 0, cursor: 'pointer', textUnderlineOffset: 3,
        // Le `nowrap` qui colle le nom à son point médian ne doit pas empêcher un
        // libellé plus long que la ligne de passer à la ligne : « In a couple, not
        // married or in a civil partnership » tient sur deux lignes à 390 px, son
        // point médian au bout de la seconde ligne de la carte. Un bouton centre son
        // texte par défaut.
        whiteSpace: 'normal', textAlign: 'start',
        color: vif ? 'var(--primary)' : 'inherit',
        textDecoration: action ? (survole ? 'underline' : 'none') : 'underline',
        textDecorationColor: vif ? 'currentColor' : 'var(--border)',
      }}
    >
      {children}
    </button>
  );
}

/** Les profils touchés nommés en une phrase (« Ce texte touche : … », « Aussi
 *  touchés : … »), les plus touchés d'abord. Chaque nom ouvre ou referme le bloc de son
 *  profil sous la phrase, pour lire ce que le texte change pour une situation qu'on n'a
 *  pas décrite, sans quitter la fiche ni en changer. Au-delà de `NOMS_VISIBLES`,
 *  « et N autres » déroule tous les noms : un gros texte en touche plus de quarante,
 *  dont la liste entière couvrait un écran de téléphone.
 *  `cle` : la phrase, dont la balise `<noms>` reçoit la liste ; `liste` : les profils
 *  et leurs lignes, calculés par `PourVousSection` ; `onOuvrir` reçoit aussi le
 *  profil du bloc, que le tiroir doit montrer même s'il n'est pas choisi. */
function ProfilsNommes({ cle, liste, style, onOuvrir }: {
  cle: 'ficheTouche' | 'ficheAucunTouche' | 'ficheAussiTouches';
  liste: { profil: string; lignes: Changement[] }[];
  style: CSSProperties;
  onOuvrir: (c: Changement, profil: string) => void;
}) {
  const t = useTranslations('ceQuiMeConcerne');
  const [tous, setTous] = useState(false);
  const [ouverts, setOuverts] = useState<string[]>([]);
  const tries = [...liste].sort((a, b) => b.lignes.length - a.lignes.length || ORDRE_PROFILS.indexOf(a.profil) - ORDRE_PROFILS.indexOf(b.profil));
  const montres = tous ? tries : tries.slice(0, NOMS_VISIBLES);
  const basculer = (profil: string) => setOuverts((o) => (o.includes(profil) ? o.filter((p) => p !== profil) : [...o, profil]));
  // Replier la liste referme aussi les blocs des noms qu'elle cache : leur nom, seul
  // moyen de les refermer, ne serait plus à l'écran.
  const replier = () => {
    const visibles = new Set(tries.slice(0, NOMS_VISIBLES).map((p) => p.profil));
    setOuverts((o) => o.filter((p) => visibles.has(p)));
    setTous(false);
  };
  return (
    <>
      <p style={style}>
        {t.rich(cle, {
          noms: () => (
            <>
              {/* Le nom et son point médian ne se séparent pas : un bouton se coupe de
                  ce qui le suit même devant une insécable, et le point commençait
                  alors une ligne dans Chrome. */}
              {montres.map(({ profil }, i) => (
                <Fragment key={profil}>
                  <span style={{ whiteSpace: 'nowrap' }}>
                    <BoutonNom onClick={() => basculer(profil)} actif={ouverts.includes(profil)}>{t(`profils.${profil}`)}</BoutonNom>
                    {i < montres.length - 1 && '\u00a0·'}
                  </span>
                  {' '}
                </Fragment>
              ))}
              {tries.length > NOMS_VISIBLES && (
                <BoutonNom action actif={tous} onClick={tous ? replier : () => setTous(true)}>
                  {tous ? t('voirMoins') : t('ficheEtAutres', { n: tries.length - NOMS_VISIBLES })}
                </BoutonNom>
              )}
            </>
          ),
        })}
      </p>
      {/* Dans l'ordre de la phrase, pas dans celui des clics : un bloc ouvert ne
          change pas de place quand on en ouvre un autre. Seuls les noms à l'écran
          montrent leur bloc : un changement de situation peut repousser un nom ouvert
          au-delà de `NOMS_VISIBLES`, et son bloc n'aurait plus de quoi se refermer. */}
      {montres.filter((p) => ouverts.includes(p.profil)).map(({ profil, lignes }) => (
        <BlocProfil key={profil} profil={profil} lignes={lignes} onOuvrir={(c) => onOuvrir(c, profil)} />
      ))}
    </>
  );
}

/** Le contenu de la section, dans le cadre doré des autres synthèses IA de la fiche.
 *  En haut de la carte, à gauche, les gestes sur les profils, et à droite la bulle de
 *  confidentialité : « Décrire ma situation » en pastille or, comme
 *  « Identifier mes élus » du bandeau, tant qu'aucun n'est choisi, puis « Ma situation »
 *  suivi de « Modifier » (rouvre le choix) et « Oublier » (efface les profils de ce
 *  navigateur), comme pour les élus du bandeau. Le corps ne porte pas de lien : il
 *  doublait celui du haut. Les profils que le lecteur n'a pas décrits ne sont que
 *  nommés, mais chaque nom ouvre leur bloc sur place (`ProfilsNommes`). En pied de
 *  carte, sous un filet comme les autres cartes IA, la version du texte classée.
 *  `dossier` : le texte assemblé pour tous les profils (`assemblerDossiers`) ;
 *  `version` entre dans l'adresse du détail du tiroir (voir `TiroirChangement`) ;
 *  `source` : la ligne « Source : … » rendue par `ResumeIAClient`, qui sait nommer
 *  une version du texte avec son étape. */
export function PourVousSection({ dossier, version, source }: {
  dossier: DossierConcerne;
  version: string;
  source: ReactNode;
}) {
  const t = useTranslations('ceQuiMeConcerne');
  const [choisis, ecrire] = useMesProfils();
  const { survole, surSurvol } = useSurvol();
  const sourceDe = useSourceDe();
  const [ouvert, setOuvert] = useState<{ dossier: DossierConcerne; e: ElementConcerne } | null>(null);
  // Le profil d'un bloc de `ProfilsNommes` dont une ligne a ouvert le tiroir. Sans lui,
  // un élément qui touche aussi un profil choisi n'y montrerait que celui-ci, et pas
  // le profil que le lecteur venait d'ouvrir (`profilsVus`).
  const [profilEnPlus, setProfilEnPlus] = useState<string | null>(null);
  // Vrai tant que le tiroir ouvert est celui d'un lien partagé.
  const parLien = useRef(false);

  // Ouvre le tiroir nommé par un lien partagé, au montage et quand seule l'ancre
  // change : un lien collé dans l'onglet déjà ouvert sur la fiche ne recharge pas la
  // page. Un élément qui n'est plus dans le texte (texte promulgué, nouvelle version
  // classée) laisse la fiche telle quelle, sans message.
  useEffect(() => {
    const ouvrirDepuisAncre = () => {
      const id = changementDuFragment(window.location.hash);
      const e = id ? elementDepuisAncre(dossier, id) : undefined;
      if (!e) return;
      parLien.current = true;
      setProfilEnPlus(null);
      setOuvert({ dossier, e });
    };
    // Dans un effet : l'ancre n'existe qu'après l'hydratation, le rendu serveur ne la connaît pas.
    ouvrirDepuisAncre();
    window.addEventListener('hashchange', ouvrirDepuisAncre);
    return () => window.removeEventListener('hashchange', ouvrirDepuisAncre);
  }, [dossier]);

  // À la fermeture d'un tiroir ouvert par le lien : l'ancre est retirée, pour qu'un
  // rechargement ne le rouvre pas, puis le lecteur arrive sur la section, rouverte
  // s'il l'avait repliée, au lieu du haut de la fiche où il ne verrait rien du sujet.
  const fermer = () => {
    setOuvert(null);
    if (!parLien.current) return;
    parLien.current = false;
    history.replaceState(history.state, '', window.location.pathname + window.location.search);
    allerASection('pourVous');
  };

  // Les lignes de chaque profil touché, sans retrait : les amendements sont rangés à
  // part (`BlocProfil`). Un profil sans ligne lisible ne compte pas comme touché.
  const parProfil = ORDRE_PROFILS
    .map((profil) => ({ profil, lignes: lignesDe(dossier, profil, sourceDe, { retrait: false }) }))
    .filter((p) => p.lignes.length > 0);
  const ouvrirLigne = (c: Changement, profil: string | null = null) => {
    setProfilEnPlus(profil);
    setOuvert({ dossier: c.dossier, e: c.e });
  };
  const vusDuTiroir = profilEnPlus && !choisis.includes(profilEnPlus) ? [...choisis, profilEnPlus] : choisis;
  const touches = parProfil.filter((p) => choisis.includes(p.profil));
  const autres = parProfil.filter((p) => !choisis.includes(p.profil));

  return (
    <div style={AI_FRAME_STYLE}>
      <div style={{ ...AI_INNER_STYLE, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {choisis.length === 0 ? (
            <button
              type="button"
              onClick={ouvrirChoixProfils}
              style={{ ...BASE_PILL_STYLE, ...(survole ? ACTIVE_HOVER : ACTIVE_BASE), cursor: 'pointer' }}
              {...surSurvol}
            >
              {t('ficheChoisir')}
              <span aria-hidden style={{ opacity: 0.6 }}>→</span>
            </button>
          ) : (
            <>
              {/* Sur téléphone, Modifier et Oublier ne montrent que leur icône : ce
                  libellé dit seul sur quoi ils portent. */}
              <span style={{ ...STYLE_PETIT, fontWeight: 500 }}>{t('ficheMesProfils')}</span>
              <HintIconButton ariaLabel={t('modifierProfils')} onClick={ouvrirChoixProfils} icon={<Pencil size={11} />} label={t('modifierCourt')} />
              <HintIconButton ariaLabel={t('oublierProfils')} onClick={() => ecrire([])} icon={<Trash2 size={11} />} label={t('oublierCourt')} />
            </>
          )}
          <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
            <InfoBulle ariaLabel={t('confidentialiteAide')} texte={t('confidentialite')} />
          </span>
        </div>

        {choisis.length === 0 ? (
          <ProfilsNommes cle="ficheTouche" liste={parProfil} style={STYLE_PHRASE} onOuvrir={ouvrirLigne} />
        ) : touches.length === 0 ? (
          <ProfilsNommes cle="ficheAucunTouche" liste={parProfil} style={STYLE_PHRASE} onOuvrir={ouvrirLigne} />
        ) : (
          <>
            {touches.map(({ profil, lignes }) => (
              <BlocProfil key={profil} profil={profil} lignes={lignes} onOuvrir={(c) => ouvrirLigne(c)} />
            ))}
            {autres.length > 0 && (
              <ProfilsNommes
                cle="ficheAussiTouches"
                liste={autres}
                style={{ ...STYLE_PETIT, fontSize: '0.8125rem', margin: 0, borderTop: '1px solid var(--border)', paddingTop: '1rem' }}
                onOuvrir={ouvrirLigne}
              />
            )}
          </>
        )}

        {/* L'écart de la colonne s'ajouterait à la marge haute du pied : on le retire,
            pour le même espace au-dessus du filet que sur les autres cartes IA. */}
        <div style={{ marginTop: '-1.25rem' }}>
          <AICardFooter>{source}</AICardFooter>
        </div>
      </div>
      <TiroirChangement ouvert={ouvert} onFermer={fermer} choisis={vusDuTiroir} version={version} />
    </div>
  );
}

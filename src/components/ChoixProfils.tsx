'use client';

// Choix des profils de « Ce qui me concerne » : les pastilles rangées par thème, le bas
// fixe (nombre choisi, « Tout effacer », sortie) et la fenêtre qui les porte. Servi à
// la page « Ce qui me concerne » (accueil et fenêtre « Ma situation ») et à la fiche
// d'un texte, qui ouvre la fenêtre sans quitter la page (`ouvrirChoixProfils`), sur
// le modèle de `TrouverMonDeputeModal` pour les élus. Chaque clic s'applique tout de
// suite : les profils vivent dans le navigateur (`useMesProfils`), et tout ce qui les
// lit se met à jour derrière la fenêtre.

import { useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Info, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useSurvol } from '@/components/ChangementsConcernes';
import { THEMES, lire, useMesProfils } from '@/hooks/useMesProfils';

const EVENEMENT_OUVRIR = 'loiclair:choix-profils';

/** Ouvre la fenêtre du choix montée par `ChoixProfilsModal`, depuis n'importe quel
 *  composant de la page. */
export function ouvrirChoixProfils() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENEMENT_OUVRIR));
}

/** Pastille de profil : contour, et une croix quand elle est choisie. Au survol, sur
 *  ordinateur, une infobulle donne la définition que lit l'IA pour classer : le
 *  lecteur sait ce que recouvre un profil avant de le cocher. Rien sur téléphone,
 *  choix assumé : Radix n'ouvre pas l'infobulle au toucher, qui coche la pastille. Le délai évite qu'elles s'allument toutes en traversant la liste. */
function PastilleProfil({ libelle, definition, actif, onClick, ariaRetirer }: { libelle: string; definition: string; actif: boolean; onClick: () => void; ariaRetirer: string }) {
  const { survole, surSurvol } = useSurvol();
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
    <button
      type="button"
      aria-pressed={actif}
      aria-label={actif ? ariaRetirer : undefined}
      onClick={onClick}
      {...surSurvol}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
        fontSize: '0.875rem', lineHeight: 1.4, padding: actif ? '0.3rem 0.55rem 0.3rem 0.8rem' : '0.3rem 0.8rem',
        borderRadius: 999,
        border: `1px solid ${actif ? 'var(--primary)' : survole ? 'var(--muted-foreground)' : 'var(--border)'}`,
        background: survole ? 'var(--muted)' : 'transparent',
        color: actif ? 'var(--primary)' : 'var(--card-foreground)',
        fontWeight: actif ? 600 : 400, cursor: 'pointer', transition: 'background-color .15s, border-color .15s',
      }}
    >
      {libelle}
      {actif && <X size={13} strokeWidth={2} aria-hidden />}
    </button>
      </TooltipTrigger>
      <TooltipContent>{definition}</TooltipContent>
    </Tooltip>
  );
}

/** Choix des profils, sur l'accueil comme dans la fenêtre : tous les thèmes ouverts,
 *  dans l'ordre d'affichage, chacun sous son intitulé, et rien que des pastilles. Un
 *  thème replié ou un menu cachait ce qu'il contenait : la plupart des profils
 *  n'étaient vus qu'en dépliant. Les identifiants changent avec `dansFenetre` : vider
 *  ses profils dans la fenêtre de la page « Ce qui me concerne » affiche l'accueil
 *  derrière elle, et les deux formulaires sont alors montés ensemble.
 *
 *  `onChanger` reçoit la liste suivante, à écrire par l'appelant. Elle part du
 *  stockage (`lire`), pas du dernier rendu : deux clics avant le rendu suivant
 *  partiraient sinon de la même liste, et le second effacerait le premier. Sur un
 *  thème à choix unique, cocher un profil retire d'abord celui du thème. */
export function FormulaireProfils({ dansFenetre, onChanger }: { dansFenetre: boolean; onChanger: (suivants: string[]) => void }) {
  const t = useTranslations('ceQuiMeConcerne');
  const [choisis] = useMesProfils();
  const basculer = (th: (typeof THEMES)[number], p: string) => {
    const actuels = lire();
    if (actuels.includes(p)) return onChanger(actuels.filter((x) => x !== p));
    onChanger([...(th.choixUnique ? actuels.filter((x) => !th.profils.includes(x)) : actuels), p]);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {THEMES.map((th) => (
        <section key={th.theme} aria-labelledby={`${dansFenetre ? 'fenetre-' : ''}theme-${th.theme}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {/* Seuls les thèmes à choix unique le disent : sans la mention, cocher une
              pastille en décochait une autre sans prévenir. Les autres n'en portent
              aucune, la consigne disant déjà de cocher tout ce qui décrit le lecteur. */}
          <h3 id={`${dansFenetre ? 'fenetre-' : ''}theme-${th.theme}`} style={{ fontSize: '0.9375rem', fontWeight: 500, margin: 0 }}>
            {t(`themes.${th.theme}`)}
            {th.choixUnique && <span style={{ fontWeight: 400, fontSize: '0.8125rem', color: 'var(--muted-foreground)' }}> · {t('uneSeuleReponse')}</span>}
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {th.profils.map((p) => (
              <PastilleProfil
                key={p}
                libelle={t(`profils.${p}`)}
                definition={t(`definitions.${p}`)}
                actif={choisis.includes(p)}
                onClick={() => basculer(th, p)}
                ariaRetirer={t('retirerProfil', { profil: t(`profils.${p}`) })}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Bas du choix, fixe pendant le défilement, sur une bande opaque à filet, de la
 *  teinte du fond qu'elle recouvre (page ou fenêtre) : à gauche le nombre de profils
 *  choisis et « Tout effacer », à droite la sortie
 *  (`libelle`), sans nombre : un compte de textes avant chargement ne pouvait suivre
 *  ni la recherche ni l'unité de la liste (articles et amendements). Le même sur
 *  l'accueil et dans la fenêtre, où il recouvre la marge du bas (`p-6`) pour que rien
 *  ne défile sous lui. `desactiveSansProfil` : la page « Ce qui me concerne » n'a rien
 *  à montrer sans profil ; la fiche d'un texte, elle, se referme simplement. */
export function PiedProfils({ dansFenetre, onChanger, onValider, libelle, desactiveSansProfil = false }: {
  dansFenetre: boolean;
  onChanger: (suivants: string[]) => void;
  onValider: () => void;
  libelle: string;
  desactiveSansProfil?: boolean;
}) {
  const t = useTranslations('ceQuiMeConcerne');
  const tCommon = useTranslations('common');
  const [choisis] = useMesProfils();
  const desactive = desactiveSansProfil && choisis.length === 0;
  return (
    <div
      style={{
        position: 'sticky', bottom: dansFenetre ? '-1.5rem' : 0, zIndex: 1,
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        // Le fond de ce qu'il recouvre : la fenêtre peint `--background`, la page non.
        // `AppShell` y pose un voile de `--muted` à 30 % d'opacité, que `color-mix` en
        // sRGB (l'espace où l'opacité se compose) recompose exactement ;
        // `--background` seul y dessinait un rectangle blanc, ou plus sombre que la
        // page en thème sombre.
        background: dansFenetre ? 'var(--background)' : 'color-mix(in srgb, var(--muted) 30%, var(--background))',
        borderTop: '1px solid var(--border)',
        ...(dansFenetre ? { margin: '0 -1.5rem -1.5rem', padding: '0.75rem 1.5rem 1.5rem' } : { padding: '0.75rem 0 0.75rem 0.75rem' }),
      }}
    >
      <span style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '0.75rem', whiteSpace: 'nowrap', fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>
        {t('nbProfils', { n: choisis.length })}
        {/* Même rendu que « Tout effacer » de `FilterBar` (classe de survol comprise) :
            un lien discret, pas un second bouton à côté de la sortie. */}
        {choisis.length > 0 && (
          <button
            type="button"
            onClick={() => onChanger([])}
            className="filter-bar-clear-all"
            style={{
              border: 'none', background: 'none', padding: '4px 2px', fontSize: '0.8125rem',
              color: 'var(--muted-foreground)', textDecoration: 'underline', textUnderlineOffset: 3,
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {tCommon('clearAll')}
          </button>
        )}
      </span>
      <button
        type="button"
        disabled={desactive}
        onClick={onValider}
        style={{
          whiteSpace: 'nowrap',
          border: 0, borderRadius: 9999, padding: '0.5rem 1.1rem', fontSize: '0.9375rem', fontWeight: 600,
          background: desactive ? 'var(--muted)' : 'var(--primary)',
          color: desactive ? 'var(--muted-foreground)' : 'var(--primary-foreground)',
          cursor: desactive ? 'default' : 'pointer',
        }}
      >
        {libelle}
      </button>
    </div>
  );
}

// Les pastilles que coche l'exemple de la consigne, nommées par leurs libellés
// (`profils.*`) plutôt que recopiées dans la phrase : un libellé renommé y suit seul.
const PROFILS_EXEMPLE = ['fonctionnaire', 'secteur_sante', 'locataire', 'grande_ville', 'parent', 'parent_isole', 'celibataire'];

/** Consigne du choix, en cartes titrées (classe `.intro-profils` de `globals.css`) :
 *  ce que la page montre (le bénéfice avant le geste, D-258), comment cocher, puis
 *  l'exemple. D'un seul tenant, elle formait sur ordinateur un pavé de neuf lignes
 *  dans une colonne de 62ch, la moitié droite vide. Sur l'accueil, trois cartes côte à côte ; dans la
 *  fenêtre (`dansFenetre`), deux cartes empilées et pas d'exemple, choix d'Alex :
 *  à 44rem, trois colonnes étroites étiraient la première sur quatorze lignes.
 *  Rend des `div` : l'appelant la pose dans un `div`, jamais dans un paragraphe.
 *
 *  Le « i » dit où vont les profils. Une bulle qui s'ouvre au toucher comme au clic,
 *  pas au survol, qui n'existe pas sur téléphone. Elle promet « aucune information
 *  sur vous » : profils, filtres et tri sont absents de toute requête et de l'adresse
 *  (D-243). Le tiroir demande bien un élément au serveur, mais le même pour tous,
 *  comme une fiche du site. Elle ne dit rien de la recherche, dont le `#q=` de
 *  l'adresse peut atteindre le compteur d'audience. Le « i » reste collé au dernier
 *  mot : seul, il passait à la ligne sur un téléphone de 390 px. */
export function IntroProfils({ dansFenetre = false }: { dansFenetre?: boolean }) {
  const t = useTranslations('ceQuiMeConcerne');
  const locale = useLocale();
  // La fenêtre n'affiche pas l'exemple : la liste n'y est pas formatée.
  const profilsExemple = dansFenetre ? '' : new Intl.ListFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { type: 'conjunction' })
    .format(PROFILS_EXEMPLE.map((p) => t(`profils.${p}`)));
  // Le « i » ferme la règle de cochage, la partie où le lecteur s'apprête à cocher.
  const consigne = t('aucunProfil');
  const coupure = consigne.lastIndexOf(' ') + 1;
  // Des `h3`, au niveau des questions qui suivent (`FormulaireProfils`) : un lecteur
  // d'écran passe ainsi d'une carte à l'autre par ses titres.
  const titre = { fontSize: '0.875rem', lineHeight: 1.5, fontWeight: 600, color: 'var(--card-foreground)', margin: '0 0 0.25rem' } as const;
  return (
    <div className={dansFenetre ? 'intro-profils intro-profils-empilee' : 'intro-profils'}>
      <div>
        <h3 style={titre}>{t('introTitreMontre')}</h3>
        {t('introLois')}
      </div>
      <div>
      <h3 style={titre}>{t('introTitreCocher')}</h3>
      {consigne.slice(0, coupure)}
      <span style={{ whiteSpace: 'nowrap' }}>
      {consigne.slice(coupure)}{' '}
      <Popover>
        <PopoverTrigger
          aria-label={t('confidentialiteAide')}
          style={{ display: 'inline-flex', verticalAlign: 'middle', background: 'none', border: 0, padding: '0.25rem', margin: '-0.25rem 0', cursor: 'pointer', color: 'var(--muted-foreground)' }}
        >
          <Info size={15} strokeWidth={1.5} aria-hidden />
        </PopoverTrigger>
        <PopoverContent style={{ maxWidth: 300, padding: '0.75rem 0.875rem', fontSize: '0.8125rem', lineHeight: 1.5 }}>
          {t('confidentialite')}
        </PopoverContent>
      </Popover>
      </span>
      </div>
      {!dansFenetre && (
        <div>
          <h3 style={titre}>{t('introTitreExemple')}</h3>
          {t('exempleCases', { profils: profilsExemple })}
        </div>
      )}
    </div>
  );
}

/** La fenêtre centrée du choix, la même que « Identifier mes élus »
 *  (`TrouverMonDeputeModal`) : titre, consigne, formulaire et bas (`pied`). */
export function FenetreProfils({ ouverte, onOuverture, onChanger, pied }: {
  ouverte: boolean;
  onOuverture: (ouverte: boolean) => void;
  onChanger: (suivants: string[]) => void;
  pied: ReactNode;
}) {
  const t = useTranslations('ceQuiMeConcerne');
  return (
    <Dialog open={ouverte} onOpenChange={onOuverture}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()} className="max-h-[85vh] overflow-y-auto p-6" largeurMax="44rem">
        <DialogTitle className="text-lg font-semibold">{t('profilsTitre')}</DialogTitle>
        {/* `asChild` : la consigne est faite de `div`, qu'un paragraphe ne peut pas contenir. */}
        <DialogDescription asChild style={{ fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--muted-foreground)' }}>
          <div><IntroProfils dansFenetre /></div>
        </DialogDescription>
        <div style={{ marginTop: '0.5rem' }}><FormulaireProfils dansFenetre onChanger={onChanger} /></div>
        {pied}
      </DialogContent>
    </Dialog>
  );
}

/** La fenêtre du choix pour une page autre que « Ce qui me concerne » : montée une
 *  fois, ouverte par `ouvrirChoixProfils`. Le bouton du bas la referme. */
export function ChoixProfilsModal() {
  const t = useTranslations('ceQuiMeConcerne');
  const [ouverte, setOuverte] = useState(false);
  const [, ecrire] = useMesProfils();
  useEffect(() => {
    const ouvrir = () => setOuverte(true);
    window.addEventListener(EVENEMENT_OUVRIR, ouvrir);
    return () => window.removeEventListener(EVENEMENT_OUVRIR, ouvrir);
  }, []);
  return (
    <FenetreProfils
      ouverte={ouverte}
      onOuverture={setOuverte}
      onChanger={ecrire}
      pied={<PiedProfils dansFenetre onChanger={ecrire} onValider={() => setOuverte(false)} libelle={t('termine')} />}
    />
  );
}

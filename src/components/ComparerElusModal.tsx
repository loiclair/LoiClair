'use client';

// Modale « Comparer » : le score d'activité de deux élus de la même chambre face à face,
// rang, score sur 100, un bloc de contexte (jours de mandat, cohésion, taux d'adoption),
// les sujets de prédilection, puis les quatre fonctions, chacune avec son rang sur la
// ligne de son titre et ses mesures brutes en chiffres, le meilleur mis en avant.
// Deux appelants : la liste de /les-elus (`ElusResultsClient`), qui l'ouvre dès le second
// élu coché et quitte son mode comparaison à la fermeture, et la fiche élu
// (`EluProfileClient`), qui l'ouvre avec le seul élu de la fiche, la recherche du second
// déjà ouverte. Les chiffres viennent de `/api/comparer-elus`, chargés dès que la paire
// est complète et à chaque remplacement. Nom, photo et groupe viennent de l'index de
// recherche des élus, qui sert aussi à choisir ou remplacer un élu sans quitter la modale.

import { useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Pencil, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import PhotoEluVignette from '@/components/PhotoEluVignette';
import { InfoBulle } from '@/components/ContacterMesElusBanner';
import { ACTIVITE_FUNCTIONS, type FonctionKey, type MetricKey } from '@/lib/activite-weights';
import { filterActeurs, loadActeurIndex, type ActeurIndex, type ActeurMeta } from '@/lib/search/acteur-index';
import type { ComparerElusResponse, EluCompare } from '@/app/api/comparer-elus/route';

const FONCTION_ORDER: FonctionKey[] = ['legiferer', 'deliberer', 'controler', 'commission'];

/** Couleurs de l'icône « i » sur fond clair, celles des cartes de la fiche élu
 *  (`COULEURS_INFO` de `EluRows.tsx`). */
const COULEURS_INFO = { repos: 'var(--muted-foreground)', actif: 'var(--foreground)' };

/** Résultats proposés quand on cherche un remplaçant : de quoi trouver un nom tapé en
 *  partie, sans allonger la modale d'une liste entière. */
const MAX_PROPOSITIONS = 6;

/** Chambre où l'élu est classé, dans les codes de `activite_elus_mv`. `null` pour un
 *  ministre en fonction, absent du score et donc pas comparable. Partagée avec la liste,
 *  qui grise les mêmes élus que ceux que la recherche de remplaçant écarte. */
export function chambreDe(a: ActeurMeta): 'AN' | 'SN' | null {
  if (a.est_ministre_actuel) return null;
  return a.est_depute_actuel ? 'AN' : a.est_senateur_actuel ? 'SN' : null;
}

type Etat =
  | { cle: string; statut: 'ok'; data: ComparerElusResponse }
  | { cle: string; statut: 'erreur' };

type Props = {
  /** Les deux élus comparés, `null` modale fermée. Le second manque quand la modale
   *  s'ouvre depuis une fiche : sa colonne est alors la recherche qui le choisit. */
  elus: [ActeurMeta, ActeurMeta | null] | null;
  /** Place l'élu choisi dans la colonne `rang` (remplacement, ou second élu). */
  onRemplacer: (rang: 0 | 1, acteur: ActeurMeta) => void;
  onClose: () => void;
};

export default function ComparerElusModal({ elus, onRemplacer, onClose }: Props) {
  const t = useTranslations('elus');
  const locale = useLocale();
  const cle = elus && elus[1] ? `${elus[0].uid},${elus[1].uid}` : '';
  const [etat, setEtat] = useState<Etat | null>(null);
  // Colonne en cours de remplacement, et ce qu'on y tape.
  const [remplace, setRemplace] = useState<0 | 1 | null>(null);
  const [requete, setRequete] = useState('');
  // Proposition surlignée, que les flèches déplacent et qu'Entrée choisit.
  const [actif, setActif] = useState(0);
  // Sans second élu, sa colonne est la recherche, sans croix pour l'annuler.
  const colonneRecherche: 0 | 1 | null = elus && !elus[1] ? 1 : remplace;

  // L'index des élus se charge à la première ouverture seulement : sur une fiche, aucun
  // visiteur qui ne compare pas ne le paie. `loadActeurIndex` garde sa promesse pour la
  // page entière et l'index dans le navigateur (IndexedDB) : la liste et la recherche du
  // menu, qui chargent le même, ne le font pas venir deux fois. Une promesse rejetée,
  // elle, n'est pas gardée : rouvrir la fenêtre après un échec retente le chargement.
  const ouverte = !!elus;
  const [index, setIndex] = useState<ActeurIndex | null>(null);
  // Sans lui, la recherche annoncerait « Aucun élu trouvé » pendant le chargement de
  // l'index, ou pour toujours s'il échoue, alors qu'elle n'a encore rien cherché.
  const [indexEchec, setIndexEchec] = useState(false);
  // Remis à faux à la fermeture, pendant le rendu plutôt qu'en effet : à la réouverture,
  // le nouvel essai s'annonce « en chargement » et non par l'erreur du précédent.
  if (!ouverte && indexEchec) setIndexEchec(false);
  useEffect(() => {
    if (!ouverte || index) return;
    let annule = false;
    loadActeurIndex()
      .then((i) => { if (!annule) setIndex(i); })
      .catch(() => { if (!annule) setIndexEchec(true); });
    return () => { annule = true; };
  }, [ouverte, index]);

  // Le résultat porte la paire qu'il décrit : une réponse arrivée après un changement de
  // paire n'est jamais affichée sous les mauvais noms, et le chargement se déduit d'un
  // état qui ne correspond pas encore à la paire ouverte.
  useEffect(() => {
    if (!cle) return;
    const ctrl = new AbortController();
    // La langue ne sert qu'aux noms des sujets de prédilection, traduits par la route.
    fetch(`/api/comparer-elus?uids=${cle}&locale=${locale}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        setEtat({ cle, statut: 'ok', data: (await r.json()) as ComparerElusResponse });
      })
      .catch(() => { if (!ctrl.signal.aborted) setEtat({ cle, statut: 'erreur' }); });
    return () => ctrl.abort();
  }, [cle, locale]);

  const courant = etat?.cle === cle ? etat : null;
  // Pendant un remplacement, les chiffres de la paire précédente restent, estompés,
  // jusqu'à l'arrivée des nouveaux : remplacés par « Chargement… », ils faisaient
  // rétrécir puis rallonger la modale. Seulement si la paire précédente garde un élu
  // dans la même colonne : sinon ses chiffres s'afficheraient sous le nom de l'autre.
  // La fermeture vide l'état (`onOpenChange`) : rouverte, même sur une paire qui
  // partage un élu (la fiche garde toujours le sien), la modale ne montre rien d'avant.
  const anciens = etat?.cle.split(',') ?? [];
  const precedent = etat?.statut === 'ok' && cle && cle.split(',').some((u, i) => anciens[i] === u) ? etat : null;
  const affiche = courant ?? precedent;
  const enChargement = !courant && !!precedent;
  // Formats créés une fois par rendu et non par cellule : la modale se redessine à
  // chaque lettre tapée dans la recherche. Cohésion et taux d'adoption à l'unité,
  // comme sur la fiche.
  const nombre = new Intl.NumberFormat(locale);
  const pourcent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  // Taux de participation au dixième au Sénat (presque tous y sont collés à 100 %), à
  // l'unité à l'Assemblée. Style `percent` : l'espace avant le signe est français, pas anglais.
  const decimalesPart = affiche?.statut === 'ok' && affiche.data.chambre === 'SN' ? 1 : 0;
  const participation = new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: decimalesPart, maximumFractionDigits: decimalesPart });
  // Valeur brute d'une mesure, écrite comme sur la fiche : un compte, ou le taux de participation.
  const brut = (v: number, m: MetricKey) => (m === 'cpPart' ? participation.format(v / 100) : nombre.format(v));

  const fermerRecherche = () => { setRemplace(null); setRequete(''); setActif(0); };
  // Un compte brut grandit avec la durée du mandat : entre un élu de 26 jours et un
  // autre de trois ans, le plus grand compte « gagnerait » partout sans rien dire de
  // l'activité. Au-delà de 25 % d'écart, les comptes ne sont donc plus mis en avant ;
  // la participation (un taux) et les rangs, rapportés à la durée, le restent.
  const dureesComparables = (() => {
    if (affiche?.statut !== 'ok') return true;
    const [j1, j2] = affiche.data.elus.map((e) => e.joursActifs);
    return Math.max(j1, j2) <= 1.25 * Math.min(j1, j2);
  })();
  // Remplaçants possibles : même chambre que la paire, ni ministre, ni l'autre élu.
  const chambre = elus ? chambreDe(elus[0]) : null;
  const propositions = elus && index && colonneRecherche !== null && requete.trim()
    ? filterActeurs(index, { role: chambre === 'AN' ? 'deputes' : 'senateurs', query: requete })
      .filter((a) => chambreDe(a) === chambre && a.uid !== elus[1 - colonneRecherche]?.uid)
      .slice(0, MAX_PROPOSITIONS)
    : [];
  const actifBorne = Math.min(actif, propositions.length - 1);
  const choisir = (rang: 0 | 1, p: ActeurMeta) => { onRemplacer(rang, p); fermerRecherche(); };

  return (
    <Dialog open={!!elus} onOpenChange={(o) => { if (!o) { fermerRecherche(); setEtat(null); onClose(); } }}>
      {/* Sans focus initial, comme `ChoixProfils` : constaté au simulateur, Safari d'iOS
          ouvrait la modale avec un anneau de focus autour de la croix de fermeture. */}
      <DialogContent
        largeurMax="36rem"
        className="max-h-[85vh] overflow-y-auto p-6"
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Échap pendant la recherche d'un remplaçant n'annule que la recherche :
        // fermer la modale quitterait le mode et viderait la sélection. Celle du second
        // élu, ouverte depuis une fiche, n'a rien à annuler : Échap ferme la modale.
        onEscapeKeyDown={(e) => { if (remplace !== null && elus?.[1]) { e.preventDefault(); fermerRecherche(); } }}
      >
        <DialogTitle className="text-lg font-semibold">{t('comparer.titre')}</DialogTitle>
        {elus && (
          <div className="cmp">
            <div className="cmp-deux">
              {elus.map((a, i) => colonneRecherche === i || !a ? (
                // Les résultats flottent sous le champ, par-dessus la suite : insérés dans
                // la colonne, ils agrandissaient l'en-tête et faisaient sauter la modale à
                // chaque lettre tapée.
                <div key="recherche" className="cmp-recherche">
                  <input
                    type="text"
                    autoFocus
                    value={requete}
                    onChange={(e) => { setRequete(e.target.value); setActif(0); }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        const pas = e.key === 'ArrowDown' ? 1 : -1;
                        const dernier = propositions.length - 1;
                        setActif((a) => Math.max(0, Math.min(Math.min(a, dernier) + pas, dernier)));
                      } else if (e.key === 'Enter' && propositions[actifBorne]) {
                        e.preventDefault();
                        choisir(i as 0 | 1, propositions[actifBorne]);
                      }
                    }}
                    placeholder={t('comparer.chercher', { chambre: chambre ?? 'AN' })}
                    aria-label={t('comparer.chercher', { chambre: chambre ?? 'AN' })}
                    // Un combobox : le lecteur d'écran annonce la liste et la proposition
                    // surlignée, le focus restant dans le champ.
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={!!requete.trim()}
                    aria-controls={`cmp-liste-${i}`}
                    aria-activedescendant={propositions[actifBorne] ? `cmp-choix-${propositions[actifBorne].uid}` : undefined}
                  />
                  {elus[1] && (
                    <button type="button" className="cmp-recherche-annuler" onClick={fermerRecherche} aria-label={t('comparer.annuler')} title={t('comparer.annuler')}>
                      <X aria-hidden style={{ width: 14, height: 14 }} />
                    </button>
                  )}
                  {/* Sans second élu (ouverture depuis une fiche), la modale n'a rien sous
                      l'en-tête : flottante, la liste y était coupée par son bas. Elle
                      reprend alors sa place dans le flux, et la modale grandit. */}
                  {requete.trim() && (
                    <div id={`cmp-liste-${i}`} role="listbox" className={elus[1] ? 'cmp-recherche-liste' : 'cmp-recherche-liste cmp-recherche-liste-flux'}>
                      {propositions.length === 0 && (
                        <span className="cmp-recherche-vide">
                          {indexEchec ? t('comparer.erreur') : !index ? t('comparer.chargement') : t('comparer.aucun')}
                        </span>
                      )}
                      {propositions.map((p, k) => (
                        <button
                          key={p.uid}
                          id={`cmp-choix-${p.uid}`}
                          type="button"
                          role="option"
                          aria-selected={k === actifBorne}
                          tabIndex={-1}
                          className="cmp-recherche-choix"
                          onMouseEnter={() => setActif(k)}
                          onClick={() => choisir(i as 0 | 1, p)}
                        >
                          {p.prenom} {p.nom}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div key={a.uid} className="cmp-elu">
                  <PhotoEluVignette acteur={a} taille={36} />
                  <div className="cmp-elu-texte">
                    {/* Le crayon au bout du nom, choix d'Alex : sous la photo, il s'y
                        lisait mal. Sur téléphone, un nom long passe donc sur trois lignes. */}
                    <div className="cmp-elu-ligne">
                      {/* Le nom mène à la fiche : les liens du pied y sont venus pour
                          raccourcir la modale. */}
                      <Link href={`/les-elus/${a.uid}`} prefetch={false} className="cmp-nom hover:underline">
                        {a.prenom} {a.nom}
                      </Link>
                      {/* Pas de crayon tant que la seconde colonne est la recherche (ouverture
                          depuis une fiche) : elle garde la main, et le clic n'aurait fait
                          que vider ce qu'on y tapait. */}
                      {elus[1] && (
                        <button
                          type="button"
                          className="cmp-changer"
                          onClick={() => { setRemplace(i as 0 | 1); setRequete(''); }}
                          aria-label={t('comparer.changer', { nom: `${a.prenom ?? ''} ${a.nom ?? ''}`.trim() })}
                          title={t('comparer.changer', { nom: `${a.prenom ?? ''} ${a.nom ?? ''}`.trim() })}
                        >
                          <Pencil aria-hidden style={{ width: 13, height: 13 }} />
                        </button>
                      )}
                    </div>
                    {a.groupe_libelle && <span className="cmp-groupe" title={a.groupe_libelle}>{a.groupe_libelle}</span>}
                  </div>
                </div>
              ))}
            </div>

            {!elus[1] ? null : !affiche ? (
              <p className="cmp-etat">
                <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} aria-hidden />
                {t('comparer.chargement')}
              </p>
            ) : affiche.statut === 'erreur' ? (
              <p className="cmp-etat">{t('comparer.erreur')}</p>
            ) : (
              <div className={enChargement ? 'cmp-corps cmp-corps-attente' : 'cmp-corps'} aria-busy={enChargement}>
                <div className="cmp-deux cmp-score">
                  {affiche.data.elus.map((e) => (
                    <BlocScore key={e.uid} elu={e} total={affiche.data.total} chambre={affiche.data.chambre} />
                  ))}
                </div>
                {/* Avant les fonctions, ce qui situe les chiffres sans les classer : les
                    jours de mandat, dont tous les comptes dépendent, puis deux taux de la
                    fiche. Aucun n'est mis en avant : un mandat plus long ou une cohésion
                    plus forte ne valent pas mieux, et le taux d'adoption ne se lit pas
                    seul, sans le nombre d'amendements qu'il rapporte. */}
                <section className="cmp-fonction">
                  <div className="cmp-mesure cmp-titre"><span /><span className="cmp-mesure-l">{t('comparer.contexte')}</span><span /></div>
                  <LigneChiffres
                    libelle={t('comparer.joursMandat')}
                    infobulle={t('joursActifsTooltip')}
                    g={affiche.data.elus[0].joursActifs} d={affiche.data.elus[1].joursActifs}
                    format={(v) => nombre.format(v)}
                    neutre
                  />
                  <LigneChiffres
                    libelle={t('comparer.cohesion')}
                    infobulle={t('tooltipCohesion')}
                    g={affiche.data.elus[0].cohesion} d={affiche.data.elus[1].cohesion}
                    format={(v) => pourcent.format(v / 100)}
                    neutre
                  />
                  <LigneChiffres
                    libelle={t('comparer.adoption')}
                    g={affiche.data.elus[0].adoptionAmendements} d={affiche.data.elus[1].adoptionAmendements}
                    format={(v) => pourcent.format(v)}
                    // Le taux n'existe que si l'élu a déposé un amendement : sans, la
                    // raison s'écrit, un « — » se lisait comme une donnée manquante.
                    absent={t('comparer.aucunDepose')}
                    neutre
                  />
                  {!dureesComparables && <p className="cmp-note">{t('comparer.dureesDifferentes')}</p>}
                </section>
                {/* Les sujets de prédilection, comme sur la fiche : les noms seuls, dans
                    l'ordre, l'écart à la chambre n'étant pas un compte. Rubrique absente
                    quand aucun des deux n'en a ; « — » pour celui qui n'en a pas. */}
                {affiche.data.elus.some((e) => e.themes.length > 0) && (
                  <section className="cmp-fonction">
                    <div className="cmp-mesure cmp-titre">
                      <span />
                      <span className="cmp-mesure-l">
                        <TexteAvecInfo texte={t('comparer.themes')} infobulle={t('themesPredilectionInfo')} />
                      </span>
                      <span />
                    </div>
                    <div className="cmp-deux">
                      {affiche.data.elus.map((e, i) => (
                        <ul key={e.uid} className={i === 1 ? 'cmp-themes cmp-themes-d' : 'cmp-themes'}>
                          {e.themes.length > 0 ? e.themes.map((th) => <li key={th}>{th}</li>) : <li>—</li>}
                        </ul>
                      ))}
                    </div>
                  </section>
                )}
                {FONCTION_ORDER.map((f) => {
                  const [ga, dr] = affiche.data.elus.map((e) => e.fonctions[f]);
                  const [mg, md] = affiche.data.elus.map((e) => e.mesures);
                  return (
                    <section key={f} className="cmp-fonction">
                      {/* Le rang de la fonction sur la ligne du titre, comme sur la fiche.
                          Il tient compte de la durée du mandat, ce que les comptes bruts
                          dessous ne font pas. Un élu hors classement n'en a pas, sa colonne
                          dit déjà pourquoi ; aucun des deux classé, les côtés restent vides. */}
                      <LigneChiffres
                        libelle={t(`activite.fonctions.${f}` as Parameters<typeof t>[0])}
                        g={ga} d={dr}
                        format={(v) => <>{v}<sup>{t('rangSuffixe', { rang: v })}</sup></>}
                        titre
                        inverse
                        vide={ga === null && dr === null}
                      />
                      {/* Les mesures brutes, elles, restent chez un élu hors classement,
                          comme sur sa fiche. Le libellé est au pluriel : il sert aux deux
                          comptes à la fois. */}
                      {ACTIVITE_FUNCTIONS[f].metrics.map((m) => (
                        <LigneChiffres
                          key={m}
                          libelle={m === 'cpPart' ? t('comparer.participation') : t(`activite.mesures.${m}` as Parameters<typeof t>[0], { count: 2 })}
                          g={mg[m]} d={md[m]}
                          format={(v) => brut(v, m)}
                          neutre={m !== 'cpPart' && !dureesComparables}
                        />
                      ))}
                    </section>
                  );
                })}
              </div>
            )}

            <p className="cmp-pied">
              {t('absencesNonPubliees')}{' '}
              <Link href="/Activite#methodologie" className="cmp-lien hover:underline">{t('scoreMethodologyLink')}</Link>
            </p>
          </div>
        )}
        <style>{`
          .cmp { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
          .cmp-deux { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
          .cmp-elu { display: flex; align-items: flex-start; gap: 0.5rem; min-width: 0; }
          .cmp-elu-texte { display: flex; flex-direction: column; gap: 0.125rem; min-width: 0; flex: 1; }
          .cmp-elu-ligne { display: flex; align-items: flex-start; gap: 0.25rem; min-width: 0; }
          .cmp-nom { font-size: 0.9375rem; font-weight: 600; line-height: 1.3; color: var(--foreground); min-width: 0; }
          .cmp-changer { display: grid; place-items: center; flex: none; width: 22px; height: 22px; margin-left: auto; padding: 0;
                         border: 0; border-radius: 9999px; background: none; color: var(--muted-foreground); cursor: pointer; }
          .cmp-changer:hover { color: var(--primary); }
          .cmp-groupe { font-size: 0.75rem; line-height: 1.35; color: var(--muted-foreground);
                        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .cmp-recherche { position: relative; align-self: start; min-width: 0; }
          .cmp-recherche input { width: 100%; height: 36px; padding: 0 2rem 0 0.75rem; border: 1px solid var(--border); border-radius: 9999px;
                                 background: var(--card); color: var(--foreground); font-size: 16px; }
          /* 16 px, pas moins : constaté au simulateur, Safari d'iOS zoome toute la page
             au focus d'un champ plus petit, et la modale sortait de l'écran par la gauche. */
          .cmp-recherche-annuler { position: absolute; top: 7px; right: 7px; display: grid; place-items: center; width: 22px; height: 22px;
                                   padding: 0; border: 0; border-radius: 9999px; background: none; color: var(--muted-foreground); cursor: pointer; }
          .cmp-recherche-liste { position: absolute; z-index: 10; top: calc(100% + 4px); left: 0; right: 0; display: flex; flex-direction: column;
                                 padding: 0.25rem; border: 1px solid var(--border); border-radius: 10px; background: var(--card);
                                 box-shadow: 0 6px 20px rgba(0,0,0,0.12); }
          .cmp-recherche-liste-flux { position: static; margin-top: 4px; box-shadow: none; }
          .cmp-recherche-choix { padding: 0.375rem 0.5rem; border: 0; background: none; text-align: left; font-size: 0.875rem;
                                 color: var(--foreground); cursor: pointer; border-radius: 6px; }
          .cmp-recherche-choix[aria-selected="true"] { background: var(--muted); }
          .cmp-recherche-vide { padding: 0.375rem 0.5rem; font-size: 0.8125rem; color: var(--muted-foreground); }
          .cmp-lien { font-weight: 500; color: var(--primary); }
          .cmp-corps { display: flex; flex-direction: column; gap: 1rem; transition: opacity 0.15s; }
          .cmp-corps-attente { opacity: 0.4; }
          .cmp-etat { display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 1.5rem 0;
                      font-size: 0.875rem; color: var(--muted-foreground); }
          .cmp-score { padding-top: 0.875rem; border-top: 1px solid var(--border); }
          .cmp-rang { display: flex; align-items: center; gap: 0.625rem; }
          .cmp-grand { font-size: 1.625rem; font-weight: 700; letter-spacing: -0.03em; line-height: 1; color: var(--foreground);
                       font-variant-numeric: tabular-nums; white-space: nowrap; }
          .cmp-grand sup { font-size: 0.75rem; letter-spacing: 0; vertical-align: 1.1em; line-height: 0; margin-left: 1px; }
          .cmp-legende { font-size: 0.75rem; line-height: 1.4; color: var(--muted-foreground); }
          .cmp-motif { font-size: 0.75rem; line-height: 1.45; color: var(--muted-foreground); }
          .cmp-fonction { display: flex; flex-direction: column; gap: 0.25rem; padding-top: 0.875rem; border-top: 1px solid var(--border); }
          .cmp-mesure { display: grid; grid-template-columns: 4rem 1fr 4rem; align-items: baseline; column-gap: 0.5rem; }
          .cmp-mesure-n { font-size: 0.875rem; font-weight: 500; color: var(--foreground); font-variant-numeric: tabular-nums; white-space: nowrap; }
          .cmp-mesure-n + .cmp-mesure-l + .cmp-mesure-n { text-align: right; }
          .cmp-mesure-l { font-size: 0.75rem; line-height: 1.35; color: var(--muted-foreground); text-align: center; }
          .cmp-titre { margin-bottom: 0.375rem; }
          .cmp-titre .cmp-mesure-n { font-size: 0.875rem; font-weight: 600; }
          .cmp-titre sup { font-size: 0.68em; line-height: 0; }
          .cmp-pastille { display: inline-block; padding: 0.125rem 0.5rem; border-radius: 9999px; background: var(--muted); color: var(--foreground); }
          .cmp-gagne .cmp-pastille { background: color-mix(in srgb, var(--primary) 14%, transparent); color: var(--primary); }
          .cmp-perd .cmp-pastille { color: var(--muted-foreground); }
          .cmp-titre .cmp-mesure-l { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.09em; color: var(--foreground); }
          .cmp-info { display: inline-flex; vertical-align: -1px; margin-left: 0.35rem; }
          .cmp-themes { display: flex; flex-direction: column; gap: 0.25rem; margin: 0; padding: 0; list-style: none;
                        font-size: 0.875rem; font-weight: 500; line-height: 1.35; color: var(--foreground); }
          .cmp-themes-d { text-align: right; }
          /* Texte dans une colonne de chiffres large de 4 rem : il passe à la ligne
             plutôt que de mordre sur le libellé central. */
          .cmp-absent { display: inline-block; font-size: 0.75rem; font-weight: 400; line-height: 1.25; white-space: normal;
                        color: var(--muted-foreground); }
          .cmp-mesure-n.cmp-gagne { color: var(--primary); font-weight: 700; }
          .cmp-mesure-n.cmp-perd { color: var(--muted-foreground); }
          .cmp-note { margin: 0.25rem 0 0; font-size: 0.75rem; line-height: 1.45; color: var(--muted-foreground); text-align: center; }
          .cmp-pied { padding-top: 0.875rem; border-top: 1px solid var(--border); font-size: 0.75rem; line-height: 1.5; color: var(--muted-foreground); }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}

/** Un libellé suivi de son icône « i ». Le dernier mot et l'icône ne se séparent pas :
 *  constaté à 390 px, l'icône de « Sujets de prédilection » passait seule à la ligne. */
function TexteAvecInfo({ texte, infobulle }: { texte: string; infobulle: string }) {
  const t = useTranslations('elus');
  const coupure = texte.lastIndexOf(' ');
  return (
    <>
      {texte.slice(0, coupure + 1)}
      <span style={{ whiteSpace: 'nowrap' }}>
        {texte.slice(coupure + 1)}
        <span className="cmp-info"><InfoBulle ariaLabel={t('infoBulleAria')} texte={infobulle} couleurs={COULEURS_INFO} /></span>
      </span>
    </>
  );
}

/** Une ligne de la comparaison : chiffre de gauche, libellé au centre, chiffre de droite.
 *  L'infobulle passe par `InfoBulle` et non par un attribut `title` : celui-ci ne s'ouvre
 *  jamais au doigt, et Alex ne le voyait pas s'ouvrir non plus à la souris.
 *  Le plus élevé passe en teal gras et l'autre en gris : chaque mesure du score compte
 *  une activité, donc plus vaut toujours plus. Sans gagnant (égalité, ou valeur absente
 *  d'un côté), les deux restent neutres, comme sur une ligne `neutre`, où plus ne vaut
 *  pas mieux. Sur une ligne `inverse` (un rang), c'est le plus petit qui l'emporte.
 *  Une valeur absente s'écrit « — », sauf sur une ligne `vide`, qui n'a que son
 *  libellé. `titre` est la ligne de tête d'une fonction. */
function LigneChiffres({ libelle, infobulle, g, d, format, absent, titre = false, neutre = false, inverse = false, vide = false }: {
  libelle: string;
  /** Définition du libellé, derrière une icône « i ». */
  infobulle?: string;
  g: number | null;
  d: number | null;
  format: (v: number) => ReactNode;
  /** Ce qui s'écrit à la place d'une valeur absente, quand « — » ne dit pas pourquoi. */
  absent?: string;
  titre?: boolean;
  neutre?: boolean;
  inverse?: boolean;
  vide?: boolean;
}) {
  const ton = (moi: number | null, autre: number | null) =>
    neutre || moi === null || autre === null || moi === autre ? '' : (moi > autre) !== inverse ? ' cmp-gagne' : ' cmp-perd';
  // Le rang d'une fonction va dans une pastille, choix d'Alex malgré la règle « pas de
  // badges » : sur la ligne de titre, il se repère d'un coup d'œil d'une rubrique à
  // l'autre. Un « — » reste nu, il n'y a rien à mettre en avant.
  const valeur = (v: number | null) => (vide ? null
    : v === null ? (absent ? <span className="cmp-absent">{absent}</span> : '—')
    : titre ? <span className="cmp-pastille">{format(v)}</span> : format(v));
  return (
    <div className={titre ? 'cmp-mesure cmp-titre' : 'cmp-mesure'}>
      <span className={`cmp-mesure-n${ton(g, d)}`}>{valeur(g)}</span>
      <span className="cmp-mesure-l">
        {infobulle ? <TexteAvecInfo texte={libelle} infobulle={infobulle} /> : libelle}
      </span>
      <span className={`cmp-mesure-n${ton(d, g)}`}>{valeur(d)}</span>
    </div>
  );
}

/** Rang et score d'un élu, ou le motif de son absence de classement, dans les mots de
 *  sa fiche (D-123). Le rang et sa légende tiennent sur une même ligne. */
function BlocScore({ elu, total, chambre }: { elu: EluCompare; total: number; chambre: 'AN' | 'SN' }) {
  const t = useTranslations('elus');
  if (elu.motif || elu.score === null || elu.rang === null) {
    return (
      <p className="cmp-motif">
        {elu.motif === 'presidentChambre' ? t('scoreUnavailablePresident')
          : elu.motif === 'presidentGroupe' ? t('scoreUnavailablePresidentGroupe')
          : t('scoreUnavailable', { joursActifs: elu.joursActifs })}
      </p>
    );
  }
  return (
    <div className="cmp-rang">
      <span className="cmp-grand">{elu.rang}<sup>{t('rangSuffixe', { rang: elu.rang })}</sup></span>
      <span className="cmp-legende">
        <TexteAvecInfo texte={t('rankOutOf', { total, chambre })} infobulle={t('rankOutOfTooltip')} />
        <br />
        {t('scoreSur100', { score: elu.score })}
      </span>
    </div>
  );
}

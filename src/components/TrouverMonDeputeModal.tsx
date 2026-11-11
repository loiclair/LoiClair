'use client';

// Modal « Trouver mes élus » : retrouve le député et les sénateurs d'un code
// postal ou d'un pays (Français de l'étranger), puis les enregistre comme
// « mes élus ». Monté une fois par le layout `(app)`, donc sur toutes les pages sauf
// l'accueil, il s'ouvre par l'événement `open-trouver-mon-depute-modal`, que déclenche
// `openTrouverMonDeputeModal()` (recherche d'élus, bandeau « Contacter mes élus »,
// « Identifier mes élus » du tiroir de « Ce qui me concerne »).
// La recherche se fait dans le navigateur (`src/lib/trouver-elus.ts`) : le code postal
// et le pays tapés ne partent jamais vers LoiClair.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { MapPin, Globe, Loader2, ChevronRight } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useEcranMobile } from '@/hooks/useEcranMobile';
import { cn } from '@/lib/utils';
import { normalizeFr } from '@/lib/search/normalize';
import { useMesElus, type SenateurRef, type MesElus } from '@/hooks/useMesElus';
import {
  chercherParCirco,
  chercherParCodePostal,
  chercherParPays,
  indexerCodesPostaux,
  type CirconscriptionsCp,
  type Commune,
  type EluLite,
  type ElusContact,
  type FeCirco,
  type FeJson,
  type FePays,
  type LookupResult,
} from '@/lib/trouver-elus';

const EVENT_OPEN = 'open-trouver-mon-depute-modal';

// Les deux fichiers de la recherche, chargés une fois par page et partagés par toutes les
// ouvertures de la modale. Une promesse rejetée est oubliée, pour qu'un nouvel essai
// retélécharge au lieu de rejouer l'échec.
let codesPostauxPromise: Promise<Map<string, Commune[]>> | null = null;
let elusPromise: Promise<ElusContact> | null = null;

// `no-cache` : `/api/elus-contact` est servie avec `stale-while-revalidate`, que le navigateur
// applique aussi à son propre cache. Sans revalidation, un visiteur garderait des jours une
// liste d'élus périmée. Le site n'envoie aucun `ETag` (identifiant de version) : la liste
// se retélécharge donc entière, même inchangée.
async function lireJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  return (await res.json()) as T;
}

function chargerCodesPostaux(): Promise<Map<string, Commune[]>> {
  codesPostauxPromise ??= lireJson<CirconscriptionsCp>('/data/circonscriptions.json')
    .then(indexerCodesPostaux)
    .catch((e) => { codesPostauxPromise = null; throw e; });
  return codesPostauxPromise;
}

/** La liste des élus, téléchargée une fois par page. Servie aussi à la bande des élus
 *  de la fiche dossier (`ContacterMesElusBanner`), qui y complète la fiche officielle
 *  des sénateurs enregistrés avant son ajout. */
export function chargerElus(): Promise<ElusContact> {
  elusPromise ??= lireJson<ElusContact>('/api/elus-contact')
    .catch((e) => { elusPromise = null; throw e; });
  return elusPromise;
}

export function openTrouverMonDeputeModal(opts?: { initialCp?: string; initialTab?: 'cp' | 'pays' }) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_OPEN, { detail: opts ?? {} }));
}

function toEluRef(e: EluLite) {
  return {
    uid: e.uid,
    prenom: e.prenom,
    nom: e.nom,
    civ: e.civ,
    email: e.email,
    twitter_url: e.twitter_url,
    instagram_url: e.instagram_url,
    facebook_url: e.facebook_url,
    linkedin_url: e.linkedin_url,
    groupe_libelle: e.groupe_libelle,
    groupe_abrege: e.groupe_abrege,
    date_debut_mandat: e.date_debut_mandat,
    periodes_mandat_assemblee: e.periodes_mandat_assemblee,
    url_profil_officiel: e.url_profil_officiel,
  };
}

export default function TrouverMonDeputeModal() {
  const t = useTranslations('elus.monDepute');
  const locale = useLocale();
  const router = useRouter();
  const { setAll } = useMesElus();
  const mobile = useEcranMobile();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'cp' | 'pays'>('cp');
  const [cpInput, setCpInput] = useState('');
  const [paysCode, setPaysCode] = useState('');
  const [paysQuery, setPaysQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feData, setFeData] = useState<FeJson | null>(null);

  useEffect(() => {
    if (tab !== 'pays' || feData) return;
    fetch('/data/circonscriptions_fe.json').then((r) => r.json()).then((d) => setFeData(d)).catch(() => {});
  }, [tab, feData]);

  // `chercher` charge ce qui lui manque puis cherche dans le navigateur (`trouver-elus.ts`) :
  // seul le chargement peut échouer, et il affiche `errorLookup`.
  const runLookup = useCallback(async (chercher: () => Promise<LookupResult>) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await chercher());
    } catch {
      setError(t('errorLookup'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const runCpLookup = useCallback(
    (cp: string) =>
      runLookup(async () => {
        const [index, elus] = await Promise.all([chargerCodesPostaux(), chargerElus()]);
        return chercherParCodePostal(cp, index, elus);
      }),
    [runLookup],
  );
  // La liste des pays ne s'affiche qu'une fois `feData` chargé : il est donc là au choix d'un pays.
  const runPaysLookup = useCallback(
    (code: string) => {
      if (!feData) return;
      runLookup(async () => chercherParPays(code, feData, await chargerElus(), locale));
    },
    [feData, runLookup, locale],
  );
  const runDeptCircoLookup = useCallback(
    (dept: string, circo: string, libelle: string) =>
      runLookup(async () => chercherParCirco(dept, circo, libelle, await chargerElus())),
    [runLookup],
  );

  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ initialCp?: string; initialTab?: 'cp' | 'pays' }>).detail || {};
      setTab(detail.initialTab ?? 'cp');
      setCpInput(detail.initialCp ?? '');
      setResult(null);
      setError(null);
      setOpen(true);
      // Préchargement pendant que le visiteur tape : la table des codes postaux pèse environ
      // 400 Ko compressée. Un échec est oublié ici et rejoué par la recherche, qui l'affiche.
      if ((detail.initialTab ?? 'cp') === 'cp') chargerCodesPostaux().catch(() => {});
      chargerElus().catch(() => {});
      if (detail.initialCp && /^\d{5}$/.test(detail.initialCp)) {
        runCpLookup(detail.initialCp);
      }
    };
    window.addEventListener(EVENT_OPEN, handler as EventListener);
    return () => window.removeEventListener(EVENT_OPEN, handler as EventListener);
  }, [runCpLookup]);

  const handleSubmitCp = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{5}$/.test(cpInput)) {
      setError(t('errorInvalidCp'));
      return;
    }
    runCpLookup(cpInput);
  }, [cpInput, runCpLookup, t]);

  const handlePickPays = useCallback((code: string) => {
    setPaysCode(code);
    runPaysLookup(code);
  }, [runPaysLookup]);

  const persist = useCallback((depute: EluLite | null, senateurs: EluLite[], origin: 'cp' | 'pays', originVal: string, dept: string) => {
    const next: MesElus = {
      depute: depute
        ? { ...toEluRef(depute), num_circo: depute.num_circo, num_dept: dept }
        : null,
      senateurs: senateurs.map((s): SenateurRef => ({ ...toEluRef(s), num_dept: dept })),
      num_dept: dept,
      source: origin,
      origine: originVal,
      updated_at: new Date().toISOString(),
    };
    setAll(next);
  }, [setAll]);

  const goDepute = useCallback((depute: EluLite, senateurs: EluLite[], origin: 'cp' | 'pays', originVal: string, dept: string) => {
    persist(depute, senateurs, origin, originVal, dept);
    setOpen(false);
    router.push(`/les-elus/${depute.uid}`);
  }, [persist, router]);

  const validateOnly = useCallback((depute: EluLite | null, senateurs: EluLite[], origin: 'cp' | 'pays', originVal: string, dept: string) => {
    persist(depute, senateurs, origin, originVal, dept);
    setOpen(false);
  }, [persist]);

  // `nom` est le nom affiché, dans la langue de la page, et fixe l'ordre de la liste.
  const allPays = useMemo(() => {
    if (!feData) return [];
    return feData.circos
      .flatMap((c) => c.pays.map((p) => ({ ...p, nom: locale === 'fr' ? p.nom_fr : p.nom_en, circo: c })))
      .sort((a, b) => a.nom.localeCompare(b.nom, locale) || a.code.localeCompare(b.code));
  }, [feData, locale]);

  // La recherche lit les deux noms : un Français de l'étranger tape souvent le nom
  // français du pays, même sur la version anglaise du site.
  const filteredPays: (FePays & { nom: string; circo: FeCirco })[] = useMemo(() => {
    const q = normalizeFr(paysQuery.trim());
    if (!q) return allPays;
    return allPays
      .filter((p) => normalizeFr(p.nom_fr).includes(q) || normalizeFr(p.nom_en).includes(q) || p.code.toLowerCase().startsWith(q))
      .slice(0, 50);
  }, [allPays, paysQuery]);

  // Changer d'onglet efface le résultat et l'erreur de l'onglet quitté.
  const changerOnglet = (onglet: 'cp' | 'pays') => {
    setTab(onglet);
    setResult(null);
    setError(null);
  };

  // Clic gauche seul : un clic droit ou un Ctrl+clic garde le comportement de Radix.
  const activerAuClic = (e: React.MouseEvent, onglet: 'cp' | 'pays') => {
    if (e.button !== 0 || e.ctrlKey) return;
    e.preventDefault();
    changerOnglet(onglet);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Sur téléphone, la fenêtre se cale en haut au lieu d'être centrée : le clavier
          d'iOS couvre la moitié basse de l'écran, où tombait le champ du code postal.
          `translate` remplace celui des classes `translate-x/y` de `DialogContent` : si le
          centrage y passait un jour par `transform`, les deux décalages s'additionneraient. */}
      <DialogContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="max-h-[85vh] overflow-y-auto p-6"
        largeurMax="36rem"
        style={mobile ? { top: '1rem', translate: '-50% 0' } : undefined}
      >
        <DialogTitle className="text-lg font-semibold">{t('modalTitle')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('modalDescription')}
        </DialogDescription>

        {/* Activation manuelle : chaque panneau a un champ en `autoFocus`. En mode
            automatique, une flèche changerait d'onglet, monterait le champ, et le
            focus sauterait dedans au lieu de rester sur les onglets. Ici la flèche
            déplace le focus, Entrée ou Espace ouvre l'onglet.
            Les classes surchargent celles de shadcn pour garder la pilule d'origine,
            y compris le retour à la ligne : « Français·e de l'étranger » ne tient
            pas sur une ligne à côté de « Code postal » sur un téléphone, et le
            `whitespace-nowrap` de shadcn ferait déborder la pilule du modal.
            `tabIndex={-1}` sur les panneaux : Radix les rend tabulables, ce qui
            ajouterait un arrêt invisible entre les onglets et le champ.
            `onMouseDown` : Radix change d'onglet dès l'appui du bouton, le champ
            prend alors le focus, puis le navigateur le rend à l'onglet cliqué.
            Empêcher ce focus et changer d'onglet nous-mêmes laisse le curseur
            dans le champ, comme avant. Le clavier passe toujours par Radix. */}
        <Tabs
          value={tab}
          onValueChange={(v) => { if (v === 'cp' || v === 'pays') changerOnglet(v); }}
          activationMode="manual"
          className="gap-0"
        >
            <TabsList className="group-data-[orientation=horizontal]/tabs:h-auto rounded-full border p-1 mb-4 bg-muted/40">
              <TabsTrigger
                value="cp"
                onMouseDown={(e) => activerAuClic(e, 'cp')}
                className="h-auto flex-initial whitespace-normal border-0 rounded-full px-4 py-1.5 font-normal text-muted-foreground transition-colors dark:data-[state=active]:bg-background"
              >
                <MapPin className="size-3.5" /> {t('tabCp')}
              </TabsTrigger>
              <TabsTrigger
                value="pays"
                onMouseDown={(e) => activerAuClic(e, 'pays')}
                className="h-auto flex-initial whitespace-normal border-0 rounded-full px-4 py-1.5 font-normal text-muted-foreground transition-colors dark:data-[state=active]:bg-background"
              >
                <Globe className="size-3.5" /> {t('tabPays')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="cp" tabIndex={-1}>
              <form onSubmit={handleSubmitCp} className="space-y-3">
                <label className="block">
                  <span className="text-sm font-medium block mb-1.5">{t('cpLabel')}</span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="\d{5}"
                      maxLength={5}
                      value={cpInput}
                      onChange={(e) => setCpInput(e.target.value.replace(/\D/g, '').slice(0, 5))}
                      placeholder="75001"
                      className="flex-1 rounded-md border bg-background px-3 py-2 text-base outline-none focus:border-primary"
                      // Un champ réclame sa largeur par défaut (environ 200 px) même en `flex-1`,
                      // et la colonne de la grille de `DialogContent` grandit pour la lui donner
                      // alors que la fenêtre, elle, garde sa largeur : sous 400 px, « Rechercher »
                      // débordait de la fenêtre. `flex-1` lui rend ensuite la place libre.
                      style={{ width: 0, minWidth: 0 }}
                      autoFocus
                    />
                    <button
                      type="submit"
                      disabled={loading || cpInput.length !== 5}
                      className="rounded-full border bg-background text-foreground px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                    >
                      {loading ? <Loader2 className="animate-spin" size={16} /> : t('lookupBtn')}
                    </button>
                  </div>
                </label>
              </form>
            </TabsContent>

            <TabsContent value="pays" tabIndex={-1}>
              <div className="space-y-3">
                <label className="block">
                  <span className="text-sm font-medium block mb-1.5">{t('paysLabel')}</span>
                  <input
                    type="text"
                    value={paysQuery}
                    onChange={(e) => setPaysQuery(e.target.value)}
                    placeholder={t('paysPlaceholder')}
                    className="w-full rounded-md border bg-background px-3 py-2 text-base outline-none focus:border-primary"
                    autoFocus
                  />
                </label>
                <div className="max-h-56 overflow-y-auto rounded-md border bg-muted/20 divide-y">
                  {filteredPays.length === 0 && (
                    <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                      {feData ? t('paysNoMatch') : t('paysLoading')}
                    </p>
                  )}
                  {filteredPays.map((p) => (
                    <button
                      key={p.code}
                      type="button"
                      onClick={() => handlePickPays(p.code)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted transition-colors',
                        paysCode === p.code && 'bg-muted',
                      )}
                    >
                      <span>
                        <span className="font-medium">{p.nom}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{t('circoNum', { num: p.circo.num })}</span>
                      </span>
                      <ChevronRight size={14} className="text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>
            </TabsContent>

            {error && (
              <p className="mt-4 text-sm text-destructive">{error}</p>
            )}

            {result && !loading && (
              <ResultPanel
                result={result}
                onValidate={(d, s) => {
                  const dept = result.circo?.dept ?? d?.num_departement ?? s[0]?.num_departement ?? '';
                  validateOnly(d, s, result.origine, result.input, dept);
                }}
                onSelectDepute={(d, s) => {
                  const dept = result.circo?.dept ?? d.num_departement ?? s[0]?.num_departement ?? '';
                  goDepute(d, s, result.origine, result.input, dept);
                }}
                onPickAmbiguous={runDeptCircoLookup}
              />
            )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function ResultPanel({
  result,
  onValidate,
  onSelectDepute,
  onPickAmbiguous,
}: {
  result: LookupResult;
  onValidate: (depute: EluLite | null, senateurs: EluLite[]) => void;
  onSelectDepute: (depute: EluLite, senateurs: EluLite[]) => void;
  onPickAmbiguous: (dept: string, circo: string, libelle: string) => void;
}) {
  const t = useTranslations('elus.monDepute');

  // Cas ambigu : plusieurs communes ou plusieurs circos pour le même CP.
  if (!result.depute && (result.communes?.length ?? 0) > 0) {
    const ambiguous = result.communes!;
    return (
      <div className="mt-4 space-y-2">
        <p className="text-sm text-muted-foreground">{t('ambiguousIntro')}</p>
        <ul className="space-y-1">
          {ambiguous.map((c) =>
            c.circos.map((circo) => (
              <li key={`${c.insee}-${circo}`}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 hover:bg-muted text-sm transition-colors"
                  onClick={() => onPickAmbiguous(c.dept, circo, c.libelle)}
                >
                  <span>
                    <span className="font-medium">{c.libelle}</span>
                    <span className="ml-2 text-muted-foreground text-xs">{t('circoNum', { num: circo })}</span>
                  </span>
                  <ChevronRight size={14} className="text-muted-foreground" />
                </button>
              </li>
            )),
          )}
        </ul>
      </div>
    );
  }

  if (!result.depute && result.senateurs.length === 0) {
    return <p className="mt-4 text-sm text-muted-foreground">{t('noResult')}</p>;
  }

  return (
    <div className="mt-5 space-y-4">
      {result.depute && (
        <div className="rounded-lg border p-4 bg-muted/30">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
            {result.origine === 'pays' ? t('headingDeputeFe') : t('headingDepute')}
            {result.circo?.libelle ? <span className="text-muted-foreground/70"> — {result.circo.libelle}</span> : null}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm leading-tight min-w-0">
              <span className="font-medium">{result.depute.prenom} {result.depute.nom}</span>
              {result.depute.groupe_abrege ? <span className="text-muted-foreground"> ({result.depute.groupe_abrege})</span> : null}
            </p>
            <button
              type="button"
              onClick={() => onSelectDepute(result.depute!, result.senateurs)}
              className="text-xs text-primary hover:underline shrink-0"
            >
              {t('viewProfile', { prenom: result.depute.prenom ?? '' })}
            </button>
          </div>
        </div>
      )}

      {result.senateurs.length > 0 && (
        <div className="rounded-lg border p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
            {result.origine === 'pays' ? t('headingSenateursFe') : t('headingSenateurs', { count: result.senateurs.length })}
          </p>
          {/* Les sénateurs des Français de l'étranger sont élus dans une circonscription
              unique, le monde entier : la liste est la même quel que soit le pays choisi.
              Sans cette phrase, un visiteur croit à une erreur en voyant douze noms. */}
          {result.origine === 'pays' && (
            <p className="text-muted-foreground mb-3" style={{ fontSize: '0.75rem', lineHeight: 1.4 }}>
              {t('noteSenateursFe', { count: result.senateurs.length })}
            </p>
          )}
          <ul className="text-sm space-y-1">
            {result.senateurs.map((s) => (
              <li key={s.uid} className="flex items-center justify-between gap-2">
                <span>
                  {s.prenom} {s.nom}
                  {s.groupe_abrege ? <span className="text-muted-foreground"> ({s.groupe_abrege})</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={() => onValidate(result.depute, result.senateurs)}
          className="rounded-full bg-primary text-primary-foreground px-5 py-2 text-sm font-medium hover:bg-primary/90"
        >
          {t('validateBtn')}
        </button>
      </div>
    </div>
  );
}

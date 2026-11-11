'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { stockageLocal } from '@/lib/stockage-navigateur';

export const STORAGE_KEY = 'loiclair-mes-elus';

/** Une période de présence dans la chambre actuelle, telle qu'écrite par l'import
 *  (`periodes_mandat_assemblee`). Dates ISO, `fin` nulle pour le mandat en cours. */
export type PeriodeMandat = { debut?: string | null; fin?: string | null };

export type EluRef = {
  uid: string;
  prenom: string | null;
  nom: string | null;
  // Optionnelle : les élus mémorisés avant son ajout ne la portent pas, et le
  // bouton de contact retombe alors sur « Prénom Nom » (`appellation`).
  civ?: string | null;
  email: string | null;
  twitter_url?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  linkedin_url?: string | null;
  groupe_libelle: string | null;
  groupe_abrege: string | null;
  date_debut_mandat?: string | null;
  /** Ce qui dit si l'élu siégeait le jour d'un vote (`ContacterMesElusBanner`) : la date
   *  ci-dessus ne part que du dernier retour d'un élu dont le mandat a été interrompu.
   *  Absentes chez les élus enregistrés avant leur ajout, et le bandeau retombe alors sur
   *  la date. */
  periodes_mandat_assemblee?: PeriodeMandat[] | null;
  /** Fiche officielle d'un sénateur, d'où se déduit sa photo (`photo-elu.ts`). Absente
   *  chez les élus enregistrés avant son ajout : la bande des élus la complète alors une
   *  fois (`ContacterMesElusBanner`), et null dit que la liste n'en avait pas. */
  url_profil_officiel?: string | null;
};

export type DeputeRef = EluRef & { num_circo: string | null; num_dept: string };
export type SenateurRef = EluRef & { num_dept: string };

export type MesElus = {
  depute: DeputeRef | null;
  senateurs: SenateurRef[];
  num_dept: string | null;
  source: 'cp' | 'pays' | 'manuel';
  origine: string | null;
  updated_at: string;
};

function emptyState(): MesElus {
  return {
    depute: null,
    senateurs: [],
    num_dept: null,
    source: 'manuel',
    origine: null,
    updated_at: new Date().toISOString(),
  };
}

// Cache module-level pour stabiliser les références : useSyncExternalStore
// re-render dès que la référence retournée change. On parse une seule fois par
// changement réel (raw string différent) et on réutilise le même objet sinon.
let cachedRaw: string | null = null;
let cachedValue: MesElus | null = null;

function read(): MesElus | null {
  if (typeof window === 'undefined') return null;
  const raw = stockageLocal.lire(STORAGE_KEY);
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  if (!raw) {
    cachedValue = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as MesElus;
    cachedValue = parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    cachedValue = null;
  }
  return cachedValue;
}

function write(value: MesElus | null) {
  if (typeof window === 'undefined') return;
  if (value === null) {
    stockageLocal.effacer(STORAGE_KEY);
    cachedRaw = null;
    cachedValue = null;
  } else {
    const serialized = JSON.stringify(value);
    stockageLocal.ecrire(STORAGE_KEY, serialized);
    cachedRaw = serialized;
    cachedValue = value;
  }
  window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

export type UseMesElusReturn = {
  data: MesElus | null;
  setAll: (m: MesElus) => void;
  setDepute: (d: DeputeRef) => void;
  toggleSenateur: (s: SenateurRef) => void;
  clearDepute: () => void;
  clear: () => void;
};

export function useMesElus(): UseMesElusReturn {
  const data = useSyncExternalStore(subscribe, read, () => null);

  const setAll = useCallback((next: MesElus) => {
    write({ ...next, updated_at: new Date().toISOString() });
  }, []);

  const setDepute = useCallback((d: DeputeRef) => {
    const current = read() ?? emptyState();
    if (current.depute?.uid === d.uid && current.num_dept === d.num_dept) return;
    write({
      ...current,
      depute: d,
      num_dept: d.num_dept,
      source: 'manuel',
      origine: null,
      updated_at: new Date().toISOString(),
    });
  }, []);

  const toggleSenateur = useCallback((s: SenateurRef) => {
    const current = read() ?? emptyState();
    const exists = current.senateurs.some((x) => x.uid === s.uid);
    const senateurs = exists
      ? current.senateurs.filter((x) => x.uid !== s.uid)
      : [...current.senateurs, s];
    write({
      ...current,
      senateurs,
      num_dept: current.num_dept ?? s.num_dept,
      source: 'manuel',
      updated_at: new Date().toISOString(),
    });
  }, []);

  const clearDepute = useCallback(() => {
    const current = read();
    if (!current || !current.depute) return;
    write({ ...current, depute: null, updated_at: new Date().toISOString() });
  }, []);

  const clear = useCallback(() => {
    write(null);
  }, []);

  return { data, setAll, setDepute, toggleSenateur, clearDepute, clear };
}

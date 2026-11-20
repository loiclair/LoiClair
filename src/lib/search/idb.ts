// src/lib/search/idb.ts
// Helpers IndexedDB partagés par les index des dossiers, des acteurs et des amendements.
// Chaque magasin vit dans une base nommée par `BASES`.

// Un magasin nouveau va dans une base nouvelle, à la version 1, plutôt que de monter la
// version d'une base existante : `open()` ne ferme jamais ses connexions, et un onglet
// resté ouvert sur l'ancienne version bloquerait la montée (`onblocked`) dans tous les
// onglets suivants, liste des textes comprise, jusqu'à sa fermeture.
const BASES = {
  'dossier-index': 'loiclair-search',
  'acteur-index': 'loiclair-search',
  // LOI-83 : l'index des amendements de la page Textes.
  'amendement-index': 'loiclair-search-amendements',
} as const;
const DB_VERSION = 1;
export type Store = keyof typeof BASES;

function open(store: Store): Promise<IDBDatabase> {
  const nom = BASES[store];
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(nom, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [s, base] of Object.entries(BASES)) {
        if (base === nom && !db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(store: Store, key: string): Promise<T | undefined> {
  try {
    const db = await open(store);
    return await new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function idbSet(store: Store, key: string, value: unknown): Promise<void> {
  try {
    const db = await open(store);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // best-effort cache — pas d'impact fonctionnel en cas d'échec
  }
}

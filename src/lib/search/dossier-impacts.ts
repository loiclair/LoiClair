// src/lib/search/dossier-impacts.ts
// Serveur uniquement. Ce que chaque texte change, selon « Ce qui me concerne » : les
// phrases de ses articles et les résumés de ses amendements adoptés, en français et
// en anglais. Servis par `/api/search-index/dossiers/impacts`, troisième morceau de
// l'index : le client lit ces morceaux séparés. La version vient de Postgres
// (`lireVersionImpacts`), que la route de la liste appelle aussi pour l'annoncer.

import { sql } from '@/lib/db';

export type ImpactsPayload = { version: string; impacts: Record<string, string> };

type LigneImpact = {
  dossier_uid: string;
  phrase_fr: string | null;
  phrase_en: string | null;
  resume_fr: string | null;
  resume_en: string | null;
};

/** La version des impacts, calculée par la fonction `impacts_empreinte()`
 *  (migration `2026-10-23_impacts_empreinte.sql`) : 32 caractères, là où la calculer
 *  ici obligeait la liste à relire les 3,3 Mo bruts de la vue. Lève si la lecture échoue, comme `lireImpacts`. */
export async function lireVersionImpacts(): Promise<string> {
  const [{ v }] = await sql<{ v: string | null }[]>`select impacts_empreinte() as v`;
  if (typeof v !== 'string') throw new Error('impacts_empreinte : réponse vide');
  return v;
}

/** Lit le classement en cours et rend, par uid, son texte cherchable. Lève si
 *  la lecture échoue (une réponse d'erreur rendue serait mise en cache 24 h).
 *
 *  `impacts_courants` est ce que montre la page : un amendement n'y figure que s'il
 *  touche au moins un profil, et sa ligne porte déjà le résumé du classement le plus
 *  récent, le même que lit `resumesAmendements`. Une phrase d'article change selon
 *  le profil, un résumé d'amendement non : il revient sur chaque ligne de profil,
 *  d'où le dédoublonnage. Aucun numéro d'amendement ni d'article : seul ce que
 *  l'élément change se cherche (choix du 2026-10-23). */
export async function lireImpacts(): Promise<ImpactsPayload> {
  // Tri complet : (element_type, element_id, profil) est unique dans la vue, vérifié
  // le 2026-10-23. Sans lui, les phrases d'un texte changeraient d'ordre d'une
  // régénération à l'autre. Les colonnes du tri ne sont pas lues : 3,3 Mo bruts au
  // lieu de 4 (8 441 lignes le 2026-10-23).
  const [rows, version] = await Promise.all([
    sql<LigneImpact[]>`
      select dossier_uid, phrase_fr, phrase_en, resume_fr, resume_en
      from impacts_courants
      order by dossier_uid, element_type, element_id, profil`,
    lireVersionImpacts(),
  ]);

  const fr = new Map<string, Set<string>>();
  const en = new Map<string, Set<string>>();
  const ajouter = (m: Map<string, Set<string>>, uid: string, texte: string | null) => {
    if (!texte) return;
    let s = m.get(uid);
    if (!s) m.set(uid, (s = new Set()));
    s.add(texte);
  };
  for (const r of rows) {
    // Une ligne d'article porte une phrase et pas de résumé, une ligne d'amendement
    // l'inverse : les deux se cherchent pareil.
    ajouter(fr, r.dossier_uid, r.phrase_fr || r.resume_fr);
    ajouter(en, r.dossier_uid, r.phrase_en || r.resume_en);
  }

  // Clés rangées par uid : l'ordre d'insertion des lignes l'est déjà, mais un texte
  // sans aucune phrase française n'entrerait qu'avec l'anglais.
  const impacts: Record<string, string> = {};
  for (const uid of [...new Set([...fr.keys(), ...en.keys()])].sort()) {
    impacts[uid] = [...(fr.get(uid) ?? []), ...(en.get(uid) ?? [])].join(' ');
  }
  return { version, impacts };
}

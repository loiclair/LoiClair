// Texte des interventions de débat, lu dans `debat_interventions.texte`.
//
// D'octobre 2026 à la bascule vers le VPS (D-325), le texte vivait hors de la base,
// dans un fichier par séance, faute de place dans la base d'alors. Il est
// revenu en base avec cette bascule ; l'import des débats
// (`pipeline/debats/import_debats.py`) l'écrit avec les autres colonnes.
//
// `debat_seances.texte_hash` reste l'empreinte du texte de la séance. L'appelant lit
// les lignes et `texte_hash` dans une même requête ; la lecture du texte ne rend que
// les séances dont l'empreinte est encore celle-là. Si l'import a réécrit une séance
// entre les deux requêtes, ses textes manquent et la lecture lève, au lieu d'associer
// des lignes d'une version aux textes d'une autre (des textes décalés).
//
// Appelé par la page de séance et `/api/resume-debats`. `/api/elus/[uid]/paroles`
// n'en a pas besoin : il lit ses lignes et leur texte dans la même requête. Un texte
// introuvable lève toujours : rendre la ligne sans texte figerait une page amputée en
// cache, et un résumé fait sur un débat incomplet passerait pour juste.

import { sql } from '@/lib/db';

export type RefSeanceTexte = { uid: string; texte_hash: string | null };

/**
 * Charge le texte des séances données, en une requête, et rend une fonction
 * `texte(seanceUid, ordre)`. Cette fonction lève si la séance n'a pas été chargée
 * (empreinte changée depuis la lecture de l'appelant) ou si elle n'a pas cet `ordre`.
 */
export async function lecteurDeTextes(
  seances: Iterable<RefSeanceTexte>,
): Promise<(seanceUid: string, ordre: number) => string> {
  const versions = new Map<string, string>();
  for (const s of seances) {
    if (!s.texte_hash) throw new Error(`Séance ${s.uid} sans empreinte de texte`);
    // Deux empreintes pour une séance : l'appelant a vu l'import la corriger entre
    // deux de ses lectures. Garder la dernière ferait lire les lignes de l'ancienne
    // version avec les textes de la nouvelle, donc des textes décalés.
    const deja = versions.get(s.uid);
    if (deja && deja !== s.texte_hash) {
      throw new Error(`Séance ${s.uid} : deux empreintes de texte dans la même lecture`);
    }
    versions.set(s.uid, s.texte_hash);
  }
  const uids = [...versions.keys()];
  const lignes = uids.length === 0 ? [] : await sql<{ seance_uid: string; ordre: number; texte: string | null }[]>`
    select i.seance_uid, i.ordre, i.texte
    from unnest(${uids}::text[], ${uids.map((u) => versions.get(u) as string)}::text[]) as v(uid, empreinte)
    join debat_seances s on s.uid = v.uid and s.texte_hash = v.empreinte
    join debat_interventions i on i.seance_uid = s.uid`;
  const textes = new Map<string, string>();
  for (const l of lignes) {
    if (typeof l.texte === 'string') textes.set(`${l.seance_uid}|${l.ordre}`, l.texte);
  }
  return (seanceUid, ordre) => {
    const texte = textes.get(`${seanceUid}|${ordre}`);
    if (typeof texte !== 'string') {
      throw new Error(`Texte absent : séance ${seanceUid}, ordre ${ordre}`);
    }
    return texte;
  };
}

/**
 * Ce qu'une fiche d'élu compte comme ses prises de parole, à poser dans le `where` d'une
 * requête où `debat_interventions` porte l'alias `i`. Appelé par la fiche et par
 * `/api/elus/[uid]/paroles`, pour que le fil et le tiroir lisent les mêmes lignes.
 *
 * Hors présidence de séance, et plus de 20 mots comme le score (`recalc_nb_prises_parole`).
 */
export function filtreParolesElu() {
  return sql`
    (i.role_debat <> 'president' or i.role_debat is null)
    and (i.orateur_qualite <> 'président de séance' or i.orateur_qualite is null)
    and i.nb_mots > 20`;
}

/**
 * La séance d'une ligne sans son `texte_hash`, qui ne sert qu'à vérifier la version
 * du texte. Appelée par la page de séance, pour que les données envoyées au client
 * restent celles d'avant le passage du texte en fichiers.
 */
export function seanceSansEmpreinte(
  seance: (RefSeanceTexte & Record<string, unknown>) | null,
): Record<string, unknown> | null {
  if (!seance) return null;
  const { texte_hash: _texteHash, ...reste } = seance;
  void _texteHash;
  return reste;
}

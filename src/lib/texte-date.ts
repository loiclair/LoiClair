/**
 * Date d'un texte législatif, tous producteurs confondus.
 *
 * Les trois préfixes créés par `sync_senat.py` (`RCTLSNR`, `PRESSNR`, `RAVISSNR`,
 * 597 textes) n'ont ni `date_creation` ni `date_publication` : le dump du Sénat ne
 * fournit que la date de dépôt, et l'import l'écrit sous son vrai nom. Sans ce
 * repli, ces textes passent pour non datés, donc rangés en fin de tri et pris
 * comme « le plus récent » par la sélection par défaut de la fiche dossier.
 *
 * `generate_search_summaries.py:text_priority_key` applique déjà le même repli
 * côté Python.
 */

export function dateTexte(
  tx: { date_creation?: string | null; date_publication?: string | null; date_depot?: string | null } | undefined | null,
): string | null {
  return tx?.date_creation || tx?.date_publication || tx?.date_depot || null;
}

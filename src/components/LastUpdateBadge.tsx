import { Clock } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { auPlusUneLigne, sql } from "@/lib/db"

/**
 * Date de la dernière nuit où le cron a terminé toutes ses étapes.
 *
 * Écrite par `pipeline/bilan_nightly.py`, qui ne la pose qu'après avoir constaté
 * que toutes les étapes du workflow sont passées. Le badge lisait auparavant l'API
 * GitHub et demandait le dernier run `status=success` : vert signifie « le processus
 * est sorti en 0 », pas « le travail a été fait ». Pendant trois semaines la date
 * affichée est restée rassurante alors que le dump sénateurs arrivait vide et que
 * deux étapes mouraient en silence.
 *
 * Lue sans cache, à chaque rendu de la page qui porte le pied de page : une ligne par
 * régénération, donc presque rien. Un `unstable_cache` a vécu ici, et il faisait deux
 * dégâts qu'on ne voit pas dans ce fichier. Sa durée plafonnait celle de toutes les
 * pages du site, puisque Next retient la plus courte : les pages à 48 h restaient à
 * 24 h. Et son tag était recopié sur chaque page (`x-next-cache-tags`), si bien que le
 * vider pour rafraîchir la date aurait invalidé aussi les milliers de fiches.
 *
 * Conséquence à connaître : ce composant n'impose plus aucune durée. Une page sans
 * `revalidate` ne se régénère donc jamais, et son badge garde la date du déploiement.
 * Toute page figée déclare donc son propre `revalidate`.
 *
 * Renvoie `null` en cas d'échec, ce qui fait disparaître le badge plutôt que d'afficher
 * une date fausse.
 */
async function getDerniereSynchro(): Promise<string | null> {
  try {
    const ligne = await auPlusUneLigne(
      sql<{ derniere_reussite: string | null }[]>`select derniere_reussite from sync_etat where cle = 'nightly'`,
      "sync_etat",
    )
    return ligne?.derniere_reussite ?? null
  } catch {
    return null
  }
}

/**
 * La date reste toujours dans le fuseau de Paris : c'est l'heure à laquelle le cron
 * a fini, pas une heure locale au visiteur. Seule la langue du mois change.
 */
function formatDate(iso: string, locale: string): string {
  const d = new Date(iso)
  const tag = locale === "en" ? "en-GB" : "fr-FR"
  return d.toLocaleDateString(tag, {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris"
  })
}

/**
 * Badge du pied de page. Le libellé dit « mise à jour complète » parce que la date
 * ne bouge que si toutes les étapes ont réussi : une nuit où une seule source échoue,
 * les autres données sont quand même rafraîchies, et la date ancienne ne doit pas
 * laisser croire que rien n'a bougé depuis.
 */
export async function LastUpdateBadge({ locale, className }: { locale: string; className?: string }) {
  const updatedAt = await getDerniereSynchro()
  if (!updatedAt) return null

  const t = await getTranslations({ locale, namespace: "common" })
  const date = formatDate(updatedAt, locale)

  return (
    <span className={`inline-flex items-start gap-1.5 text-xs text-muted-foreground ${className ?? ""}`}>
      <Clock className="h-3 w-3 flex-shrink-0 mt-0.5" />
      {t("lastUpdate", { date })}
    </span>
  )
}

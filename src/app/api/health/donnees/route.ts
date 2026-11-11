// Surveillance de la fraîcheur des données : UptimeRobot interroge cette route et alerte
// sur un 503. Elle couvre ce que l'email du cron ne peut pas dire, puisqu'il part de
// l'intérieur du run : un cron qui ne démarre plus du tout. Sur un dépôt public, GitHub
// coupe justement les tâches planifiées après 60 jours sans activité.
import { NextResponse } from "next/server"
import { auPlusUneLigne, sql } from "@/lib/db"

// Jamais mis en cache : une réponse figée dirait « à jour » pendant une panne.
export const dynamic = "force-dynamic"

// `sync_etat` n'avance que sur un run complet réussi (`bilan_nightly.py`), et une nuit
// ratée à cause d'un dump vide du Sénat a déjà son propre email : 72 h laissent passer
// deux nuits de ce genre sans alerte en double.
const AGE_MAX_HEURES = 72

export async function GET() {
  try {
    const etat = await auPlusUneLigne(
      sql<{ derniere_reussite: string | null }[]>`select derniere_reussite from sync_etat where cle = 'nightly'`,
      "sync_etat",
    )

    const reussite = etat?.derniere_reussite ? new Date(etat.derniere_reussite).getTime() : NaN
    const ageHeures = Math.round((Date.now() - reussite) / 3_600_000)

    // Une date absente ou illisible donne NaN : elle compte comme périmée.
    if (!(ageHeures <= AGE_MAX_HEURES)) {
      return NextResponse.json(
        { status: "stale", derniereReussite: etat?.derniere_reussite ?? null },
        { status: 503 }
      )
    }
    return NextResponse.json({ status: "ok", derniereReussite: etat?.derniere_reussite, ageHeures })
  } catch (err) {
    console.error("Healthcheck données error:", err)
    return NextResponse.json({ status: "error" }, { status: 503 })
  }
}

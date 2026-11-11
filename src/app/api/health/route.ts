// Endpoint de monitoring (uptime, alertes) : dit si la base répond, et en combien
// de temps. Appelé par la surveillance externe, jamais par le site lui-même.
import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

// Jamais mis en cache : une réponse figée dirait « up » pendant une panne.
export const dynamic = "force-dynamic"

export async function GET() {
  const startedAt = Date.now()
  try {
    // Requête minimale : ne lit aucune table, vérifie seulement que la base répond.
    await sql`select 1`

    return NextResponse.json({
      status: "ok",
      database: "up",
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error("Healthcheck error:", err)
    return NextResponse.json(
      { status: "error", database: "down", timestamp: new Date().toISOString() },
      { status: 503 }
    )
  }
}

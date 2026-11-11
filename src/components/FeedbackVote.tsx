"use client"

import { useState, useSyncExternalStore } from "react"
import { useTranslations } from "next-intl"
import { ThumbsUp, ThumbsDown, Loader2 } from "lucide-react"
import { stockageLocal } from "@/lib/stockage-navigateur"

type Vote = "like" | "dislike"

const LS_KEY = "loiclair-feedback-vote"

// `getSnapshot` d'un `useSyncExternalStore` : appelé pendant le rendu, et le pied de
// page qui monte ce composant est présent sur toutes les pages. Une exception ici
// emporterait le site entier, d'où le passage obligé par `stockageLocal`.
function getStoredVote(): Vote | null {
  const stored = stockageLocal.lire(LS_KEY)
  return stored === "like" || stored === "dislike" ? stored : null
}

function getServerVote(): Vote | null {
  return null
}

// no-op subscribe: we only need the initial client value
function subscribeStorage() {
  return () => {}
}

export default function FeedbackVote() {
  const t = useTranslations("footer")
  const storedVote = useSyncExternalStore(subscribeStorage, getStoredVote, getServerVote)

  // localVote overrides storedVote once the user interacts
  const [localVote, setLocalVote] = useState<Vote | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const voted: Vote | null = localVote ?? storedVote

  async function handleVote(vote: Vote) {
    setLoading(true)
    setErrorMsg(null)

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote }),
      })

      if (res.status === 429) {
        setErrorMsg(t("feedbackErrorRateLimit"))
        setLoading(false)
        return
      }

      if (!res.ok) {
        setErrorMsg(t("feedbackErrorGeneric"))
        setLoading(false)
        return
      }

      stockageLocal.ecrire(LS_KEY, vote)
      setLocalVote(vote)
      setLoading(false)
    } catch {
      setErrorMsg(t("feedbackErrorGeneric"))
      setLoading(false)
    }
  }

  const circle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "2.25rem",
    height: "2.25rem",
    borderRadius: "9999px",
    border: "1px solid var(--footer-share-border)",
    background: "var(--footer-share-bg)",
    color: "var(--footer-share-color)",
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 0,
  }

  const activeLike: React.CSSProperties = {
    ...circle,
    color: "var(--primary)",
    border: "1px solid var(--primary)",
    background: "rgba(20,184,166,0.12)",
  }

  const activeDislike: React.CSSProperties = {
    ...circle,
    color: "var(--destructive)",
    border: "1px solid var(--destructive)",
    background: "rgba(239,68,68,0.12)",
  }

  const dimmed: React.CSSProperties = {
    ...circle,
    opacity: 0.3,
    cursor: "default",
  }

  const disabledCircle: React.CSSProperties = {
    ...circle,
    opacity: 0.5,
    cursor: "default",
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: "0.25rem 0.625rem" }}>
      <span style={{ color: "var(--footer-fg)", fontSize: "0.875rem", lineHeight: 1.5, whiteSpace: "nowrap" }}>
        {t("feedbackPrompt")}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: "0.5rem" }}>
        <button
          type="button"
          onClick={() => !loading && handleVote("like")}
          aria-pressed={voted === "like"}
          aria-label={t("feedbackLike")}
          disabled={loading}
          style={loading ? disabledCircle : voted === "dislike" ? dimmed : voted === "like" ? activeLike : circle}
        >
          <ThumbsUp size={14} />
        </button>
        <button
          type="button"
          onClick={() => !loading && handleVote("dislike")}
          aria-pressed={voted === "dislike"}
          aria-label={t("feedbackDislike")}
          disabled={loading}
          style={loading ? disabledCircle : voted === "like" ? dimmed : voted === "dislike" ? activeDislike : circle}
        >
          <ThumbsDown size={14} />
        </button>
        {loading && (
          <Loader2 size={14} style={{ color: "var(--footer-share-color)", animation: "spin 1s linear infinite" }} />
        )}
        {!loading && errorMsg && (
          <span style={{ fontSize: "0.8rem", color: "var(--destructive)", textAlign: "center" }}>
            {errorMsg}
          </span>
        )}
        {!loading && !errorMsg && voted && (
          <span style={{ fontSize: "0.8rem", color: "var(--footer-fg)", whiteSpace: "nowrap" }}>
            {t("feedbackThankYou")}
          </span>
        )}
      </div>
    </div>
  )
}

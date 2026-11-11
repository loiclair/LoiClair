"use client"

// Client hook that renders a Cloudflare Turnstile widget into a container and exposes
// its token. Used by the newsletter, report and membership forms and by the
// unsubscribe page; the token is then checked server-side by `src/lib/turnstile.ts`.

import { useEffect, useRef, useState, useCallback } from "react"

interface TurnstileRenderOptions {
  sitekey: string
  size?: "compact" | "normal" | "flexible"
  theme?: "auto" | "light" | "dark"
  appearance?: "always" | "execute" | "interaction-only"
  callback?: (token: string) => void
  "expired-callback"?: () => void
  "error-callback"?: () => void
}

interface TurnstileApi {
  render: (container: HTMLElement | string, options: TurnstileRenderOptions) => string
  remove: (widgetId: string) => void
  reset: (widgetId: string) => void
  getResponse: (widgetId: string) => string | undefined
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js"
let scriptPromise: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`)
    if (existing) {
      if (window.turnstile) return resolve()
      existing.addEventListener("load", () => resolve(), { once: true })
      existing.addEventListener("error", () => reject(new Error("Turnstile script failed to load")), { once: true })
      return
    }
    const script = document.createElement("script")
    script.src = SCRIPT_URL
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptPromise = null
      reject(new Error("Turnstile script failed to load"))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

interface UseTurnstileOptions {
  sitekey: string | undefined
  size?: "compact" | "normal" | "flexible"
  theme?: "auto" | "light" | "dark"
  appearance?: "always" | "execute" | "interaction-only"
  /** When false, no widget is rendered (but the script may still be pre-warmed during idle). Defaults to true. */
  enabled?: boolean
}

type IdleCancelId = number | ReturnType<typeof setTimeout>
type IdleHandle = { cancel: () => void }

function scheduleIdle(cb: () => void): IdleHandle {
  if (typeof window === "undefined") return { cancel: () => {} }
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  if (typeof w.requestIdleCallback === "function") {
    const id: IdleCancelId = w.requestIdleCallback(cb, { timeout: 3000 })
    return { cancel: () => w.cancelIdleCallback?.(id as number) }
  }
  const id: IdleCancelId = setTimeout(cb, 1500)
  return { cancel: () => clearTimeout(id as ReturnType<typeof setTimeout>) }
}

export function useTurnstile({ sitekey, size, theme, appearance = "always", enabled = true }: UseTurnstileOptions) {
  const [token, setToken] = useState("")
  const [scriptReady, setScriptReady] = useState(() => typeof window !== "undefined" && !!window.turnstile)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)

  // Pre-warm the Turnstile script during browser idle so that, by the time the user
  // interacts with the form, render() is near-instant and doesn't freeze the input.
  useEffect(() => {
    if (!sitekey || scriptReady) return
    const handle = scheduleIdle(() => {
      loadScript()
        .then(() => setScriptReady(true))
        .catch(() => {})
    })
    return () => handle.cancel()
  }, [sitekey, scriptReady])

  useEffect(() => {
    if (!enabled || !sitekey || !container || !scriptReady) return
    if (!window.turnstile) return

    try {
      widgetIdRef.current = window.turnstile.render(container, {
        sitekey,
        size,
        theme,
        appearance,
        callback: (t: string) => setToken(t),
        "expired-callback": () => setToken(""),
        "error-callback": () => setToken(""),
      })
    } catch (err) {
      console.error("Turnstile render failed:", err)
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {}
        widgetIdRef.current = null
      }
      setToken("")
    }
  }, [enabled, sitekey, size, theme, appearance, container, scriptReady])

  const reset = useCallback(() => {
    if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current)
        setToken("")
      } catch {}
    }
  }, [])

  return { setContainer, token, reset }
}

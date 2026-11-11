"use client"

import { Sun, Moon } from "lucide-react"
import { useTheme } from "next-themes"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"

export default function ThemeToggleSwitch() {
  const t = useTranslations("common")
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- pattern hydration
  useEffect(() => { setMounted(true) }, [])

  const isDark = mounted && resolvedTheme === "dark"

  function toggle() {
    const next = isDark ? "light" : "dark"
    if (document.startViewTransition) {
      document.startViewTransition(() => setTheme(next))
    } else {
      setTheme(next)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? t("themeToLight") : t("themeToDark")}
      onClick={toggle}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        width: "2.75rem",
        height: "1.5rem",
        borderRadius: "9999px",
        border: "1px solid var(--footer-share-border)",
        backgroundColor: "var(--footer-share-bg)",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: "0.25rem",
          display: "flex",
          color: isDark ? "var(--footer-share-color)" : "var(--footer-fg)",
          opacity: isDark ? 1 : 0.4,
          transition: "opacity 150ms",
        }}
      >
        <Sun style={{ width: "0.75rem", height: "0.75rem" }} />
      </span>
      <span
        style={{
          position: "absolute",
          right: "0.25rem",
          display: "flex",
          color: isDark ? "var(--footer-fg)" : "var(--footer-share-color)",
          opacity: isDark ? 0.4 : 1,
          transition: "opacity 150ms",
        }}
      >
        <Moon style={{ width: "0.75rem", height: "0.75rem" }} />
      </span>
      <span
        style={{
          position: "absolute",
          left: isDark ? "calc(100% - 1.25rem)" : "0.125rem",
          width: "1.125rem",
          height: "1.125rem",
          borderRadius: "9999px",
          backgroundColor: "var(--footer-heading)",
          transition: "left 150ms",
        }}
      />
    </button>
  )
}

"use client"

import { Link } from "@/i18n/navigation"

const baseStyle: React.CSSProperties = {
  color: "inherit",
  textDecoration: "none",
  transition: "color 150ms",
}

export default function FooterLink({ href, label, external }: { href: string; label: string; external?: boolean }) {
  const onEnter = (e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.color = "var(--foreground)" }
  const onLeave = (e: React.MouseEvent<HTMLAnchorElement>) => { e.currentTarget.style.color = "inherit" }

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={baseStyle}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        {label}
      </a>
    )
  }

  return (
    <Link
      href={href}
      style={baseStyle}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {label}
    </Link>
  )
}

'use client'

import { useEffect, useRef } from 'react'
import { Card } from '@/components/ui/card'
import { getReadableTextColor } from '@/lib/groupe-colors'

// Même "plaque de verre" que le résultat inline du quiz (QuizResultView,
// QuizProcessusResultView), réutilisée ici pour les pages de partage.
export function SharedResultPlaque({
  color,
  logo,
  title,
  pillValue,
  pillLabel,
}: {
  color: string
  logo: React.ReactNode
  title: string
  pillValue: string
  pillLabel?: string
}) {
  const plaqueWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const wrap = plaqueWrapRef.current
    if (!wrap) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    const MAX_TILT_DEG = 4
    const MAX_PARALLAX_PX = 6

    const handleMove = (e: MouseEvent) => {
      const rect = wrap.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const px = Math.max(-1, Math.min(1, (e.clientX - centerX) / rect.width))
      const py = Math.max(-1, Math.min(1, (e.clientY - centerY) / rect.height))
      wrap.style.setProperty('--ry', `${px * MAX_TILT_DEG}deg`)
      wrap.style.setProperty('--rx', `${py * -MAX_TILT_DEG}deg`)
      wrap.style.setProperty('--tx', `${px * MAX_PARALLAX_PX}px`)
      wrap.style.setProperty('--ty', `${py * MAX_PARALLAX_PX}px`)
    }

    window.addEventListener('mousemove', handleMove)
    return () => window.removeEventListener('mousemove', handleMove)
  }, [])

  return (
    <div
      ref={plaqueWrapRef}
      className="quiz-result-reveal quiz-plaque-perspective"
      style={{ '--gcolor': color } as React.CSSProperties}
    >
      <Card className="quiz-plaque flex flex-col items-center gap-3 rounded-[22px] border-0 p-10 text-center">
        <div className="quiz-plaque-wash" />
        <div className="quiz-plaque-frost" />
        <div className="quiz-plaque-sheen" />
        <div className="quiz-plaque-rim" />

        <div className="quiz-plaque-content relative z-10 flex flex-col items-center gap-2">
          <div className="rounded-lg border bg-white p-2">{logo}</div>
          <h1 className="text-xl md:text-2xl font-bold text-balance">{title}</h1>
          <div
            className="mt-2 rounded-xl px-5 py-2.5"
            style={{ backgroundColor: color, color: getReadableTextColor(color) }}
          >
            <span className="text-xl font-extrabold">{pillValue}</span>
            {pillLabel && <span className="ml-1.5 text-xs font-semibold opacity-90">{pillLabel}</span>}
          </div>
        </div>
      </Card>
    </div>
  )
}

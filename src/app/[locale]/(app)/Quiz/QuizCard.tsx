'use client'

import { Link } from '@/i18n/navigation'
import { ArrowRight, Clock, List, type LucideIcon } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const ACCENT_STYLES = {
  primary: {
    badge: 'bg-primary/15 text-primary',
    card: 'hover:border-primary hover:bg-primary/[0.03]',
  },
  gold: {
    badge: 'bg-gold/15 text-gold',
    card: 'hover:border-gold hover:bg-gold/[0.03]',
  },
} as const

export type QuizCardProps = {
  icon: LucideIcon
  accent: 'primary' | 'gold'
  title: string
  description: string
  countLabel: string
  durationLabel: string
  href: string
  hasResult: boolean
  resultSummary?: string
  notice?: string
  ctaLabel: string
  viewResultLabel: string
  retryLabel: string
  deleteLabel: string
  onRetry: () => void
  onDelete: () => void
}

export default function QuizCard({
  icon: Icon,
  accent,
  title,
  description,
  countLabel,
  durationLabel,
  href,
  hasResult,
  resultSummary,
  notice,
  ctaLabel,
  viewResultLabel,
  retryLabel,
  deleteLabel,
  onRetry,
  onDelete,
}: QuizCardProps) {
  const styles = ACCENT_STYLES[accent]

  return (
    <Card className={cn('group transition-all hover:-translate-y-1 hover:shadow-lg', styles.card)}>
      <CardHeader>
        <div className={cn('flex h-12 w-12 items-center justify-center rounded-full', styles.badge)}>
          <Icon className="h-6 w-6" />
        </div>
        <CardTitle className="text-xl mt-2">{title}</CardTitle>
        <CardDescription className="text-base">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="font-normal">
            <List className="h-3 w-3" />
            {countLabel}
          </Badge>
          <Badge variant="secondary" className="font-normal">
            <Clock className="h-3 w-3" />
            {durationLabel}
          </Badge>
        </div>
        <div className="min-h-6 flex flex-wrap items-center gap-x-3 gap-y-1">
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
          {!notice && hasResult && (
            <>
              <p className="text-sm font-medium">{resultSummary}</p>
              <div className="flex items-center gap-2 text-sm">
                <Link
                  href={href}
                  className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
                >
                  {viewResultLabel}
                </Link>
                <span className="text-muted-foreground/50" aria-hidden="true">
                  ·
                </span>
                <button
                  type="button"
                  onClick={onDelete}
                  className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
                >
                  {deleteLabel}
                </button>
              </div>
            </>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href={href} onClick={hasResult ? onRetry : undefined}>
            {hasResult ? retryLabel : ctaLabel}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

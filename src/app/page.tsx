import { redirect } from 'next/navigation'
import { routing } from '@/i18n/routing'

// Fallback : le proxy (`src/proxy.ts`) redirige déjà / vers /fr, ou vers /en si le
// lecteur l'a choisi, en prod comme sous `next dev` (constaté le 2026-11-07). Ce
// fallback ignore ce choix ; il ne sert que si une requête atteint la page sans passer
// par le proxy.
export default function RootPage() {
  redirect(`/${routing.defaultLocale}`)
}

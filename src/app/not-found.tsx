import Link from "next/link"
import { getTranslations } from "next-intl/server"

// 404 des adresses qui n'atteignent aucune langue : une adresse d'un seul segment
// avec un point (`/wp-login.php`), que le proxy ne voit pas, arrive sous
// `[locale]` avec une langue inconnue, et le `notFound()` de sa mise en page remonte
// jusqu'ici. Rendue hors de `[locale]`, donc sans `<html>` hérité (voir
// `app/layout.tsx`), ni fournisseur de traductions, ni thème : en français, la
// langue par défaut, avec ses propres balises. Les 404 d'une langue connue passent
// par `[locale]/not-found.tsx`.
export default async function RootNotFound() {
  const t = await getTranslations({ locale: "fr", namespace: "errors" })

  return (
    <html lang="fr">
      <body className="min-h-screen antialiased bg-background">
        <main className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: "100dvh" }}>
          <div className="space-y-6 max-w-lg">
            <p className="text-xs font-medium text-muted-foreground">{t("notFoundBadge")}</p>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.12]">
              {t.rich("notFoundTitle", {
                highlight: (chunks) => <span className="text-primary">{chunks}</span>,
              })}
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">{t("notFoundSubtitle")}</p>
            {/* Le `Link` de Next et non celui de next-intl, qui demande le fournisseur
                absent ici : l'adresse porte donc sa langue en clair. */}
            <Link href="/fr" className="inline-block text-primary underline underline-offset-4">
              {t("home")}
            </Link>
          </div>
        </main>
      </body>
    </html>
  )
}

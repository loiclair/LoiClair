import TopNav from "@/components/TopNav"
import Footer from "@/components/Footer"
import SignalerProbleme from "@/components/SignalerProbleme"
import AdhesionDialog from "@/components/AdhesionDialog"
import TraductionsRoute from "@/i18n/TraductionsRoute"
import { messagesRoute } from "@/i18n/messages-client"
import { getMessages } from "next-intl/server"

// Mise en page de la seule page d'accueil, qui n'utilise pas AppShell (ni
// en-tête de page, ni pages sœurs) : elle monte donc elle-même TopNav. La page
// reçoit en plus du socle les traductions `landing` (TRADUCTIONS_PAR_ROUTE).
export default async function LandingLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <TopNav />
      <main style={{ flex: 1, paddingTop: "3.5rem" }}>
        <TraductionsRoute messages={messagesRoute(await getMessages({ locale }), "(landing)")}>
          {children}
        </TraductionsRoute>
      </main>
      <Footer locale={locale} />
      <SignalerProbleme />
      <AdhesionDialog />
    </div>
  )
}

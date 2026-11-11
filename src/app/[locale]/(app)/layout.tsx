// Mise en page de toutes les pages sauf l'accueil : AppShell, pied de page, et
// les fenêtres montées une fois pour tout le site, ouvertes par événement
// (`open-signaler`, `open-adhesion`, `open-trouver-mon-depute-modal`). Une fenêtre
// montée par page laissait muet le bouton d'une page qui l'oubliait, et deux montées
// sur la même page s'ouvraient l'une sur l'autre.
import AppShell from "@/components/AppShell"
import Footer from "@/components/Footer"
import SignalerProbleme from "@/components/SignalerProbleme"
import AdhesionDialog from "@/components/AdhesionDialog"
import TrouverMonDeputeModal from "@/components/TrouverMonDeputeModal"

export default async function AppLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <>
      <AppShell>
        <div
          style={{
            flex: 1,
            paddingBottom: "8rem",
          }}
        >
          {children}
        </div>
      </AppShell>
      <Footer locale={locale} />
      <SignalerProbleme />
      <AdhesionDialog />
      <TrouverMonDeputeModal />
    </>
  )
}

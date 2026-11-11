"use client"

/**
 * Tiroir « Devenir membre de l'association » (`TiroirFormulaire`, qui remonte
 * du bas de l'écran) : formulaire envoyé à
 * `/api/adhesion` avec un jeton Turnstile, qui transmet la demande au bureau par
 * email. Rien n'est stocké sur le site.
 * Montée une fois par `(app)/layout.tsx` et `(landing)/layout.tsx`, ouverte par
 * l'événement `open-adhesion` (`AdhesionBouton` de /nous-aider et /about, lien
 * du pied de page). Même grammaire que `SignalerProbleme`.
 *
 * Les trois cases reprennent ce que le bureau exige (D-230) : l'engagement
 * envers les statuts, la déclaration d'indépendance de l'article 2.1 du
 * règlement intérieur, et le consentement explicite, la réponse pouvant
 * révéler une fonction politique (article 9 du RGPD). Décocher l'indépendance
 * fait apparaître un champ « Précisez » : le bureau ne refuse pas sans savoir.
 */

import { useEffect, useRef, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, Loader2, Send } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { useTurnstile } from "@/hooks/useTurnstile"
import { ASSOCIATION } from "@/lib/association"
import { Button } from "@/components/ui/button"
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import TiroirFormulaire from "@/components/TiroirFormulaire"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type Etat = "saisie" | "envoi" | "succes" | "erreur"

const LIEN = "underline underline-offset-2"

/** Case native, alignée sur la première ligne de son libellé. */
function Case({ id, coche, onChange, children }: { id: string; coche: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <input
        type="checkbox"
        id={id}
        checked={coche}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0, accentColor: "var(--primary)", cursor: "pointer" }}
      />
      <label htmlFor={id} className="text-sm leading-snug cursor-pointer">
        {children}
      </label>
    </div>
  )
}

export default function AdhesionDialog() {
  const t = useTranslations("adhesion")
  const tErrors = useTranslations("errors")
  const locale = useLocale()

  const [ouvert, setOuvert] = useState(false)
  const [etat, setEtat] = useState<Etat>("saisie")
  const [nom, setNom] = useState("")
  const [email, setEmail] = useState("")
  const [contribution, setContribution] = useState("")
  const [statuts, setStatuts] = useState(false)
  const [independant, setIndependant] = useState(false)
  const [precision, setPrecision] = useState("")
  const [consentement, setConsentement] = useState(false)
  const [messageErreur, setMessageErreur] = useState("")
  // Remise à zéro différée de la fermeture : annulée si le tiroir rouvre avant
  // qu'elle parte, sinon elle viderait le formulaire sous les yeux du visiteur.
  const minuterieRaz = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { setContainer, token, reset } = useTurnstile({
    sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    enabled: ouvert,
  })

  useEffect(() => {
    const ouvrir = () => {
      if (minuterieRaz.current) clearTimeout(minuterieRaz.current)
      setOuvert(true)
    }
    window.addEventListener("open-adhesion", ouvrir)
    return () => window.removeEventListener("open-adhesion", ouvrir)
  }, [])

  // Un code inconnu (route plus récente que la page) retombe sur le message
  // générique plutôt que de faire lever next-intl.
  const traduireErreur = (code: unknown): string =>
    typeof code === "string" && tErrors.has(code) ? tErrors(code) : t("erreurGenerique")

  const complet =
    nom.trim() !== "" &&
    email.trim() !== "" &&
    statuts &&
    (independant || precision.trim() !== "") &&
    consentement

  async function envoyer(e: React.FormEvent) {
    e.preventDefault()
    if (!complet) return
    if (!token) {
      setMessageErreur(tErrors("turnstilePending"))
      setEtat("erreur")
      return
    }
    setEtat("envoi")
    try {
      const res = await fetch("/api/adhesion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nom,
          email,
          contribution,
          statuts,
          independant,
          precision: independant ? "" : precision,
          consentement,
          locale,
          turnstileToken: token,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessageErreur(traduireErreur(data.error))
        setEtat("erreur")
        reset()
        return
      }
      setEtat("succes")
    } catch {
      setMessageErreur(t("erreurGenerique"))
      setEtat("erreur")
      reset()
    }
  }

  function changerOuverture(v: boolean) {
    setOuvert(v)
    if (minuterieRaz.current) clearTimeout(minuterieRaz.current)
    if (!v) {
      // Après l'animation de fermeture, pour ne pas vider le tiroir sous les yeux.
      minuterieRaz.current = setTimeout(() => {
        setEtat("saisie")
        setNom("")
        setEmail("")
        setContribution("")
        setStatuts(false)
        setIndependant(false)
        setPrecision("")
        setConsentement(false)
        setMessageErreur("")
      }, 300)
    }
  }

  return (
    <TiroirFormulaire ouvert={ouvert} onOpenChange={changerOuverture}>
        {etat !== "succes" ? (
          <>
            <SheetHeader className="mb-4 pr-8">
              <SheetTitle className="text-lg">{t("titre")}</SheetTitle>
              <SheetDescription>{t("intro")}</SheetDescription>
            </SheetHeader>

            <form onSubmit={envoyer} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="adhesion-nom">{t("nom")}</Label>
                <Input id="adhesion-nom" value={nom} onChange={(e) => setNom(e.target.value)} maxLength={120} autoComplete="name" required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="adhesion-email">{t("email")}</Label>
                <Input id="adhesion-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="adhesion-contribution">
                  {t("contribution")}{" "}
                  <span className="text-muted-foreground font-normal">{t("facultatif")}</span>
                </Label>
                <Textarea
                  id="adhesion-contribution"
                  value={contribution}
                  onChange={(e) => setContribution(e.target.value)}
                  placeholder={t("contributionPlaceholder")}
                  maxLength={1000}
                  rows={3}
                />
              </div>

              <div className="space-y-3 pt-1">
                <Case id="adhesion-statuts" coche={statuts} onChange={setStatuts}>
                  {t.rich("statuts", {
                    lien: (chunks) => (
                      <a href={ASSOCIATION.statuts} target="_blank" rel="noopener noreferrer" className={LIEN}>{chunks}</a>
                    ),
                  })}
                </Case>
                <Case id="adhesion-independant" coche={independant} onChange={setIndependant}>
                  {t("independant")}
                </Case>
                {!independant && (
                  <div className="space-y-2 pl-6">
                    <Label htmlFor="adhesion-precision" className="text-muted-foreground font-normal">{t("precision")}</Label>
                    <Textarea
                      id="adhesion-precision"
                      value={precision}
                      onChange={(e) => setPrecision(e.target.value)}
                      maxLength={500}
                      rows={2}
                    />
                  </div>
                )}
                <Case id="adhesion-consentement" coche={consentement} onChange={setConsentement}>
                  {t.rich("consentement", {
                    lien: (chunks) => (
                      <Link href="/confidentialite" target="_blank" className={LIEN}>{chunks}</Link>
                    ),
                  })}
                </Case>
              </div>

              {etat === "erreur" && <p role="alert" className="text-sm text-destructive">{messageErreur}</p>}

              <div ref={setContainer} />

              <div className="flex justify-end">
                <Button type="submit" disabled={!complet || etat === "envoi"} className="w-full sm:w-auto">
                  {etat === "envoi" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("envoi")}
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      {t("envoyer")}
                    </>
                  )}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="rounded-full bg-[#27AE60]/10 p-3 dark:bg-[#27AE60]/20">
              <CheckCircle2 className="h-6 w-6 text-[#27AE60] dark:text-[#2ECC71]" />
            </div>
            <div>
              <SheetTitle className="text-lg">{t("succesTitre")}</SheetTitle>
              <p className="mt-1 text-sm text-muted-foreground">{t("succesDetail")}</p>
            </div>
          </div>
        )}
    </TiroirFormulaire>
  )
}

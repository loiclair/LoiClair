"use client"

/**
 * Tiroir « Signaler » (`TiroirFormulaire`, qui remonte du bas de l'écran) :
 * menu à trois choix, puis formulaire problème ou idée,
 * envoyé à `/api/signaler` avec un jeton Turnstile. L'adresse de la page ouverte
 * n'est pas jointe : seul le champ facultatif « Page concernée » la donne, car le
 * ticket est public et l'adresse peut porter une recherche après le `#`.
 * Monté une fois par `(app)/layout.tsx`, ouvert par l'événement `open-signaler`
 * (`FooterOuvreTiroir`, `SignalerButton`, `SignalerLigne` de /nous-aider).
 */

import { useEffect, useState } from "react"
import { useTurnstile } from "@/hooks/useTurnstile"
import {
  Loader2,
  ExternalLink,
  Send,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  ArrowLeft,
  Mail,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import TiroirFormulaire from "@/components/TiroirFormulaire"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

type Category = "probleme" | "idee"
type FormState = "idle" | "submitting" | "success" | "error"

export default function SignalerProbleme() {
  const t = useTranslations("signaler")
  const tErrors = useTranslations("errors")

  // Les routes `/api/*` rendent un code, pas une phrase : un code inconnu (route
  // plus récente que cette page) retombe sur le message générique plutôt que de
  // faire lever next-intl.
  const messageErreur = (code: unknown): string =>
    typeof code === "string" && tErrors.has(code) ? tErrors(code) : t("errorGeneric")
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<Category | null>(null)
  const [formState, setFormState] = useState<FormState>("idle")
  const [type, setType] = useState("")
  const [description, setDescription] = useState("")
  const [pageConcernee, setPageConcernee] = useState("")
  const [email, setEmail] = useState("")
  const [issueUrl, setIssueUrl] = useState("")
  const [errorMessage, setErrorMessage] = useState("")

  const { setContainer: setTurnstileContainer, token: turnstileToken, reset: resetTurnstile } = useTurnstile({
    sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    enabled: open,
  })

  // L'événement peut porter la catégorie et le type à présélectionner, ce qui
  // saute l'écran de choix quand l'appelant sait déjà ce que le visiteur vient
  // signaler (le bouton du journal des corrections ouvre « donnée incorrecte »).
  // Sans `detail`, le tiroir s'ouvre sur le menu comme avant.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ category?: Category; type?: string }>).detail
      if (detail?.category) setCategory(detail.category)
      if (detail?.type) setType(detail.type)
      setOpen(true)
    }
    window.addEventListener("open-signaler", handler)
    return () => window.removeEventListener("open-signaler", handler)
  }, [])

  const TYPES_PROBLEME = [
    { value: "donnee-incorrecte", label: t("typeIncorrectData") },
    { value: "affichage", label: t("typeDisplay") },
    { value: "lien-casse", label: t("typeBrokenLink") },
    { value: "ia", label: t("typeAI") },
    { value: "autre-probleme", label: t("typeOtherProblem") },
  ]

  const TYPES_IDEE = [
    { value: "nouvelle-fonctionnalite", label: t("typeNewFeature") },
    { value: "amelioration", label: t("typeImprovement") },
    { value: "autre-idee", label: t("typeOtherIdea") },
  ]

  const CATEGORY_CONFIG = {
    probleme: {
      title: t("problemTitle"),
      description: t("problemDesc"),
      typeLabel: t("problemTypeLabel"),
      typePlaceholder: t("typePlaceholder"),
      descriptionPlaceholder: t("problemDescPlaceholder"),
      types: TYPES_PROBLEME,
      successMessage: t("problemSuccess"),
      successDetail: t("problemSuccessDetail"),
      githubLabel: t("problemGithubLabel"),
    },
    idee: {
      title: t("ideaTitle"),
      description: t("ideaDesc"),
      typeLabel: t("ideaTypeLabel"),
      typePlaceholder: t("typePlaceholder"),
      descriptionPlaceholder: t("ideaDescPlaceholder"),
      types: TYPES_IDEE,
      successMessage: t("ideaSuccess"),
      successDetail: t("ideaSuccessDetail"),
      githubLabel: t("ideaGithubLabel"),
    },
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!category) return

    if (!turnstileToken) {
      setErrorMessage(tErrors("turnstilePending"))
      setFormState("error")
      return
    }

    setFormState("submitting")

    try {
      const res = await fetch("/api/signaler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          type,
          description,
          email: email || undefined,
          pageConcernee: pageConcernee || undefined,
          turnstileToken,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setErrorMessage(messageErreur(data.error))
        setFormState("error")
        resetTurnstile()
        return
      }

      setIssueUrl(data.issueUrl)
      setFormState("success")
    } catch {
      setErrorMessage(t("errorServer"))
      setFormState("error")
      resetTurnstile()
    }
  }

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (!isOpen) {
      setTimeout(() => {
        setCategory(null)
        setFormState("idle")
        setType("")
        setDescription("")
        setPageConcernee("")
        setEmail("")
        setIssueUrl("")
        setErrorMessage("")
      }, 300)
    }
  }

  function handleBack() {
    setCategory(null)
    setType("")
    setDescription("")
    setPageConcernee("")
    setFormState("idle")
    setErrorMessage("")
  }

  const config = category ? CATEGORY_CONFIG[category] : null

  return (
    <>
      <TiroirFormulaire ouvert={open} onOpenChange={handleOpenChange}>
          {/* Étape 1 : choix de la catégorie */}
          {!category && formState !== "success" && (
            <>
              <SheetHeader className="mb-4 pr-8">
                <SheetTitle className="text-lg">{t("chooseTitle")}</SheetTitle>
                <SheetDescription>
                  {t("chooseDesc")}
                </SheetDescription>
              </SheetHeader>
              <div className="grid gap-3 py-4">
                <button
                  onClick={() => setCategory("probleme")}
                  className="flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted cursor-pointer"
                >
                  <div className="rounded-full bg-destructive/10 p-2">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                  </div>
                  <div>
                    <p className="font-medium">{t("reportProblem")}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("reportProblemDesc")}
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => setCategory("idee")}
                  className="flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted cursor-pointer"
                >
                  <div className="rounded-full bg-primary/10 p-2">
                    <Lightbulb className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{t("suggestIdea")}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("suggestIdeaDesc")}
                    </p>
                  </div>
                </button>
                {/* `target="_blank"` comme tous les liens vers contact@loiclair.fr,
                    pour qu'ils se comportent pareil. */}
                <a
                  href="mailto:contact@loiclair.fr"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted cursor-pointer no-underline"
                >
                  <div className="rounded-full bg-muted p-2">
                    <Mail className="h-5 w-5 text-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">{t("contactTeam")}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("contactTeamDesc")}
                    </p>
                  </div>
                </a>
              </div>
            </>
          )}

          {/* Étape 2 : formulaire */}
          {category && formState !== "success" && config && (
            <>
              <SheetHeader className="mb-4 pr-8">
                <SheetTitle className="flex items-center gap-2 text-lg">
                  <button
                    onClick={handleBack}
                    className="rounded-md p-1 hover:bg-muted transition-colors cursor-pointer"
                    aria-label={t("back")}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  {config.title}
                </SheetTitle>
                <SheetDescription>
                  {config.description}
                </SheetDescription>
              </SheetHeader>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="type-select">{config.typeLabel}</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger id="type-select" className="w-full">
                      <SelectValue placeholder={config.typePlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {config.types.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* La page fautive n'est pas toujours celle d'où l'on signale :
                    depuis le journal des corrections ou le pied de page, l'URL
                    envoyée automatiquement ne dit pas où regarder. Champ libre
                    et facultatif, réservé aux problèmes (une idée ne porte pas
                    sur une page précise). */}
                {category === "probleme" && (
                  <div className="space-y-2">
                    <Label htmlFor="page-concernee">
                      {t("pageLabel")}{" "}
                      <span className="text-muted-foreground font-normal">{t("emailOptional")}</span>
                    </Label>
                    <Input
                      id="page-concernee"
                      placeholder={t("pagePlaceholder")}
                      value={pageConcernee}
                      onChange={(e) => setPageConcernee(e.target.value)}
                      maxLength={300}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="description">{t("descriptionLabel")}</Label>
                  <Textarea
                    id="description"
                    placeholder={config.descriptionPlaceholder}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={1000}
                    rows={4}
                    required
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    {description.length}/1000
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">
                    {t("emailLabel")}{" "}
                    <span className="text-muted-foreground font-normal">
                      {t("emailOptional")}
                    </span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder={t("emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  {/* Promesse tenue par /api/signaler : l'email ne va jamais dans l'issue. */}
                  <p className="text-xs text-muted-foreground">
                    {t("emailPrivacyNote")}
                  </p>
                </div>

                {formState === "error" && (
                  <p className="text-sm text-destructive">{errorMessage}</p>
                )}

                <div ref={setTurnstileContainer} />

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={
                      formState === "submitting" ||
                      !type ||
                      !description.trim()
                    }
                    className="w-full sm:w-auto"
                  >
                    {formState === "submitting" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("sending")}
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        {t("send")}
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </>
          )}

          {/* Étape 3 : confirmation */}
          {formState === "success" && config && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="rounded-full bg-[#27AE60]/10 p-3 dark:bg-[#27AE60]/20">
                <CheckCircle2 className="h-6 w-6 text-[#27AE60] dark:text-[#2ECC71]" />
              </div>
              <div>
                <p className="font-medium">{config.successMessage}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {config.successDetail}
                </p>
              </div>
              <a
                href={issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                {config.githubLabel}
              </a>
            </div>
          )}
      </TiroirFormulaire>
    </>
  )
}

"use client";

// Frise du parcours d'un texte dans l'en-tête de la page d'un vote : une seule ligne du
// dépôt à la promulgation, où seul le vote est en couleur et en gras. Reprend les formes de
// la frise de la fiche d'un texte (`Timeline.tsx`), mais en gris.
//
// Composant client pour le seul calage au doigt : les étapes sont déjà dans le HTML serveur.
// Appelé par `Scrutins/[uid]/page.tsx`, qui lui donne des noms déjà traduits.

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

export interface EtapeFrise {
  code: string;
  /** Forme courte (« Sénat 1ʳᵉ »), ou nom complet pour l'étape du vote. */
  nom: string;
  done: boolean;
  vote: boolean;
}

// Au-delà, le parcours se resserre pour tenir sans défiler à 1440 px.
const SEUIL_LONG = 8;

const GRIS = "var(--bandeau-trait-fort)";

// Seules les valeurs qui changent avec la largeur passent par une feuille : un `style={{}}`
// ne connaît pas les media queries. Des propriétés CSS simples, lues ensuite en ligne, et non
// des classes Tailwind (règle Safari du projet).
const FEUILLE = `
.frise-vote { --trait: 36px; --trait-marge: 8px; --texte: 14px; --point-marge: 7px; --vote-point: 14px; --vote-avant: 6px; --vote-apres: 12px; scrollbar-width: none; }
.frise-vote::-webkit-scrollbar { display: none; }
@media (max-width: 640px) { .frise-vote { --trait: 5px; --trait-marge: 5px; --texte: 12px; --vote-point: 12px; --vote-avant: 4px; --vote-apres: 8px; } }
.frise-vote[data-long] { --trait: 4px; --trait-marge: 3px; --texte: 12px; --point-marge: 5px; --vote-avant: 4px; --vote-apres: 8px; }
`;

export default function FriseVote({ etapes, statut, ceVote, libelle }: {
  etapes: EtapeFrise[];
  /** Statut du vote : turquoise s'il est adopté, rouge s'il est rejeté, neutre sinon. */
  statut: string | null;
  ceVote: string;
  libelle: string;
}) {
  const rail = useRef<HTMLOListElement>(null);
  const [resteGauche, setResteGauche] = useState(false);
  const [resteDroite, setResteDroite] = useState(false);

  useEffect(() => {
    const r = rail.current;
    if (!r) return;
    const mesurer = () => {
      setResteGauche(r.scrollLeft > 1);
      setResteDroite(r.scrollLeft + r.clientWidth < r.scrollWidth - 1);
    };
    // La ligne reste calée à gauche tant que le nom du vote se lit entier, et ne se centre sur
    // lui que sinon. En `+=` : les positions lues sont celles de l'écran, donc après le
    // défilement déjà fait, par exemple un doigt plus rapide que le chargement des polices.
    const caler = () => {
      const vote = r.querySelector("[aria-current]");
      const nom = vote?.querySelector("[data-nom]");
      if (vote && nom && r.scrollWidth > r.clientWidth + 1) {
        const c = r.getBoundingClientRect();
        const g = vote.getBoundingClientRect();
        const l = nom.getBoundingClientRect();
        if (l.right > c.right) r.scrollLeft += (g.left - c.left) - (c.width - (l.right - g.left)) / 2;
      }
    };
    let actif = true;
    let polices = false;
    // Après le chargement des polices, qui changent la largeur des noms.
    document.fonts.ready.then(() => {
      if (!actif) return;
      polices = true;
      caler();
      mesurer();
    });
    r.addEventListener("scroll", mesurer, { passive: true });
    // Passer du paysage au portrait peut couper le nom du vote : il se recale.
    const observateur = new ResizeObserver(() => {
      if (polices) caler();
      mesurer();
    });
    observateur.observe(r);
    return () => {
      actif = false;
      r.removeEventListener("scroll", mesurer);
      observateur.disconnect();
    };
  }, []);

  const couleur = statut === "Adopté" ? "var(--primary)" : statut === "Rejeté" ? "var(--bandeau-contre)" : "var(--bandeau-texte)";
  const couleurTexte = statut === "Adopté"
    ? "color-mix(in oklab, var(--primary), var(--bandeau-accent-texte))"
    : couleur;

  // Un fondu seulement du côté où il reste à voir : à gauche au repos, il rognerait le premier
  // point, aligné sur la marge du titre.
  const fondu = resteGauche && resteDroite
    ? "linear-gradient(90deg, transparent 0, #000 10px, #000 calc(100% - 10px), transparent 100%)"
    : resteGauche
      ? "linear-gradient(90deg, transparent 0, #000 10px)"
      : resteDroite
        ? "linear-gradient(270deg, transparent 0, #000 10px)"
        : undefined;

  return (
    <>
      <style>{FEUILLE}</style>
      <ol
        ref={rail}
        className="frise-vote"
        aria-label={libelle}
        data-long={etapes.length > SEUIL_LONG ? "" : undefined}
        // Atteignable au clavier seulement quand il y a de quoi défiler.
        tabIndex={resteGauche || resteDroite ? 0 : undefined}
        style={{
          display: "flex",
          margin: 0,
          padding: "5px 0",
          listStyle: "none",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          maskImage: fondu,
          WebkitMaskImage: fondu,
        }}
      >
        {etapes.map((e, i) => {
          const suivante = etapes[i + 1];
          const coche = e.code === "PROM" && e.done;
          const point = e.vote
            ? { width: "var(--vote-point)", height: "var(--vote-point)", background: couleur, border: `2px solid ${couleur}`, marginLeft: "var(--vote-avant)", marginRight: "var(--vote-apres)" }
            : coche
              ? { width: "14px", height: "14px", background: GRIS, marginRight: "var(--point-marge)" }
              // Fond ou bord, jamais les deux : le gris est translucide, et le bord posé sur le
              // fond dessinerait un anneau plus sombre que le centre.
              : { width: "10px", height: "10px", ...(e.done ? { background: GRIS } : { border: `2px solid ${GRIS}` }), marginRight: "var(--point-marge)" };
          return (
            <li
              key={e.code}
              aria-current={e.vote ? "step" : undefined}
              style={{ display: "flex", alignItems: "center", flex: "0 1 auto", whiteSpace: "nowrap" }}
            >
              <span aria-hidden="true" style={{ position: "relative", flex: "none", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", ...point }}>
                {coche && <Check style={{ width: "10px", height: "10px", color: "var(--bandeau)" }} strokeWidth={3} />}
                {e.vote && <span style={{ position: "absolute", inset: "-5px", borderRadius: "50%", border: `2px solid ${couleur}`, opacity: 0.5 }} />}
              </span>
              {e.vote && (
                <span style={{ fontSize: "var(--texte)", lineHeight: "20px", fontWeight: 600, color: couleurTexte, marginRight: "4px" }}>
                  {ceVote}
                </span>
              )}
              <span
                data-nom=""
                style={{
                  fontSize: "var(--texte)",
                  lineHeight: "20px",
                  fontWeight: e.vote ? 600 : 400,
                  color: e.vote ? "var(--bandeau-texte)" : e.done ? "var(--bandeau-texte-doux)" : "var(--bandeau-texte-pale)",
                }}
              >
                {e.nom}
              </span>
              {suivante && (
                <span
                  aria-hidden="true"
                  style={{
                    flex: "none",
                    width: "var(--trait)",
                    marginLeft: "var(--trait-marge)",
                    marginRight: "var(--trait-marge)",
                    height: 0,
                    borderTop: `2px ${suivante.done ? "solid" : "dashed"} ${GRIS}`,
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

import { HeroSearch } from "./HeroSearch"

/**
 * Premier écran de la landing : la présentation à gauche et la recherche à droite
 * (`HeroSearch`). Appelé par `(landing)/page.tsx`, qui pose dessous la carte avant /
 * après (`LoiEnClair`).
 */
export function Hero() {
  return (
    <section>
      <div
        className="max-w-[90rem] mx-auto px-10 lg:px-20"
        style={{
          // En haut, 5,5rem au moins : sur mobile, le menu fixe (78 px) déborde de 22 px
          // sur la marge que `layout.tsx` lui réserve (3,5rem), et le titre y collait.
          paddingTop: "clamp(5.5rem, 9vw, 8.5rem)",
          // En bas, peu : la section suivante pose sa propre marge haute.
          paddingBottom: "clamp(1rem, 2vw, 1.5rem)",
        }}
      >
        <HeroSearch />
      </div>
    </section>
  )
}

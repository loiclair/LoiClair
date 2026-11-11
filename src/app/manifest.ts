import type { MetadataRoute } from "next"

// Manifeste servi à `/manifest.webmanifest` : nom et icônes que reprend un
// téléphone quand on ajoute LoiClair à l'écran d'accueil. Un seul fichier pour
// les deux langues, d'où l'absence de description : elle ne se traduirait pas.
// Les icônes sont pleines bord à bord, sans arrondi, car le système les découpe
// lui-même ; `theme_color` est le teal du fond de l'icône.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LoiClair",
    short_name: "LoiClair",
    start_url: "/",
    display: "browser",
    background_color: "#ffffff",
    theme_color: "#00787d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  }
}

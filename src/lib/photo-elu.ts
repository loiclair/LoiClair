// Portrait officiel d'un élu : l'URL se dérive des identifiants déjà présents
// dans `acteurs`, sans colonne supplémentaire ni appel réseau au rendu.
//
// Pourquoi un lien et jamais une copie : les mentions légales de l'Assemblée
// (« les graphismes, photographies et ressources multimédias ne peuvent être
// reproduits sans accord préalable ») et celles du Sénat (les photographies
// relèvent du droit d'auteur, à la différence des travaux parlementaires)
// soumettent la reproduction à autorisation, mais autorisent le lien. Le
// fichier reste donc chez eux et c'est le navigateur du visiteur qui va le
// chercher. Conséquence à ne pas défaire : pas de `next/image` sur ces
// portraits, l'optimiseur téléchargerait le fichier sur notre serveur et le
// re-servirait depuis loiclair.fr, ce qui est précisément une reproduction.

/** Législature dont l'Assemblée publie les portraits. Elle ne garde en ligne
 *  que la législature en cours : vérifié le 2026-09-05, les chemins /13/ à
 *  /16/ renvoient 404 pour des députés qui y ont pourtant siégé. */
const LEGISLATURE_PHOTOS_AN = 17

export type SourcePhoto = 'assemblee' | 'senat'

export type PhotoElu = {
  url: string
  source: SourcePhoto
  /** Fiche officielle de l'élu. La fiche s'en sert pour rendre le crédit de la
   *  bande meta cliquable ; les vignettes de liste l'ignorent. */
  href: string | null
}

/**
 * Rend l'URL du portrait officiel, ou `null` quand aucune des deux chambres
 * n'en publie (ministres issus de la société civile, notamment).
 *
 * Une URL rendue ne garantit pas une image : deux sénateurs entrés récemment
 * n'ont pas encore de portrait en ligne. C'est au composant de retomber sur les
 * initiales.
 */
export function photoElu(acteur: {
  uid: string
  url_profil_officiel: string | null
}): PhotoElu | null {
  const profil = acteur.url_profil_officiel

  // Sénat : le nom du fichier est celui de la fiche, à deux remplacements près.
  // On ne le reconstruit pas depuis le nom et le matricule, parce que la règle
  // de translittération casse sur les noms composés (« Blatrix Contat » devient
  // `blatrix_contat`, « Apourceau-Poly » devient `apourceau_poly`).
  if (profil?.includes('senat.fr/senateur/')) {
    return {
      url: profil.replace('/senateur/', '/senimg/').replace('.html', '_carre.jpg'),
      source: 'senat',
      href: profil,
    }
  }

  // Assemblée : le nom du fichier est l'uid privé de son préfixe `PA`.
  if (acteur.uid.startsWith('PA')) {
    return {
      url: `https://www.assemblee-nationale.fr/dyn/static/tribun/${LEGISLATURE_PHOTOS_AN}/photos/carre/${acteur.uid.slice(2)}.jpg`,
      source: 'assemblee',
      href: profil,
    }
  }

  return null
}

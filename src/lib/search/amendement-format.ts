// src/lib/search/amendement-format.ts
// Format texte de `/api/search-index/amendements/textes`, partagé par le serveur qui
// l'écrit (`amendement-textes.ts`) et le navigateur qui le lit (`amendement-index.ts`).
// À part des deux : le premier lit la base, et le second ne doit pas l'embarquer.
//
// Le corps : la version, un saut de ligne, puis une ligne par amendement, rangées par
// uid, séparées par `SEP_LIGNE`, chacune uid, dispositif, résumé français et résumé
// anglais séparés par `SEP_CHAMP`.

/** Séparateurs ASCII d'enregistrement et d'unité, retirés des textes avant l'envoi : ils
 *  ne peuvent pas apparaître dans un champ. */
export const SEP_LIGNE = '\u001e';
export const SEP_CHAMP = '\u001f';

/** Une ligne du format : `[uid, dispositif, résumé français, résumé anglais]`, chaîne
 *  vide pour ce qui manque. */
export function decouperLigne(ligne: string): [string, string, string, string] {
  const [uid = '', dispositif = '', fr = '', en = ''] = ligne.split(SEP_CHAMP);
  return [uid, dispositif, fr, en];
}

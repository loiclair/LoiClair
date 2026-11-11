// src/app/api/search-index/dossiers/route.ts
// Endpoint statique qui renvoie la liste de tous les dossiers législatifs pour la
// recherche, le filtrage et le tri 100 % client-side. Les données évoluent 1x/jour
// (cron nocturne) → invalidée par `/api/revalidate` à la fin du run de nuit, la
// minuterie de 24 h ne servant que de filet.
// Les résumés de recherche n'y sont pas : ils pèsent 70 % de l'index et partent par
// `/api/search-index/dossiers/resumes`, que le client charge après avoir affiché la
// liste. Seule leur version est ici, pour qu'il sache s'il doit les retélécharger.
// Même chose pour ce que chaque texte change (`/api/search-index/dossiers/impacts`).

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { initiateurAffiche } from '@/lib/origine-gouvernementale';
import { empreinte, resumesPayload } from '@/lib/search/dossier-resumes';
import { lireVersionImpacts } from '@/lib/search/dossier-impacts';

export const revalidate = 86400;

type DossierRow = {
  uid: string;
  titre: string | null;
  titre_en: string | null;
  search_summary: string | null;
  themes: string[] | null;
  procedure_libelle: string | null;
  date_depot: string | null;
  statut_final: string | null;
  initiateur_groupe_libelle: string | null;
  textes_associes_refs: string[] | null;
  initiateur_acteur_ref: {
    prenom?: string | null;
    nom?: string | null;
    groupe?: { libelle?: string | null } | null;
  } | null;
};

/** Une ligne de la vue `dossiers_liste_meta` (migration 2026-08-30_vue_liste_dossiers.sql). */
type MetaRow = {
  uid: string;
  derniere_activite: string | null;
  dernier_acte_code: string | null;
  num_notice: string | null;
  chambre: string | null;
  has_texte: boolean | null;
};

export async function GET() {
  // Les trois lectures lèvent sur une panne, d'où le try/catch commun.
  let rows: DossierRow[];
  let metaRows: MetaRow[];
  let impactsVersion: string;
  try {
    // Les trois lectures sont indépendantes : lancées ensemble, la régénération
    // n'attend que la plus lente.
    [rows, metaRows, impactsVersion] = await Promise.all([
      // `initiateur_acteur_ref` remplace l'uid de l'initiateur par l'objet de l'élu
      // (`null` sans initiateur connu), son groupe actuel imbriqué : la forme que lit
      // `initiateurAffiche`.
      sql<DossierRow[]>`
        select d.uid, d.titre, d.titre_en, d.search_summary, d.themes, d.procedure_libelle, d.date_depot,
          d.statut_final, d.initiateur_groupe_libelle, d.textes_associes_refs,
          (select jsonb_build_object(
            'prenom', a.prenom, 'nom', a.nom,
            'groupe', (select jsonb_build_object('libelle', o.libelle) from organes o where o.uid = a.groupe)
          ) from acteurs a where a.uid = d.initiateur_acteur_ref) as initiateur_acteur_ref
        from dossiers_legislatifs d
        -- hors_liste : dossiers comptés dans le score mais absents des listes (migration 2026-10-29_dossiers_hors_liste.sql).
        -- Même filtre que lireResumes, qui calcule la version sur les mêmes lignes.
        where d.hors_liste = false
        order by d.uid`,
      // Numéro de dépôt, dernière activité parlementaire et présence d'un texte : les
      // trois viennent de `dossiers_liste_meta`, qui les agrège côté Postgres.
      sql<MetaRow[]>`
        select uid, derniere_activite, dernier_acte_code, num_notice, chambre, has_texte
        from dossiers_liste_meta
        order by uid`,
      // L'empreinte des impacts, calculée par Postgres : la même que sert la route des
      // impacts, sans relire ses 3,3 Mo.
      lireVersionImpacts(),
    ]);
  } catch (e) {
    console.error('[search-index/dossiers]', e);
    // Relancée, jamais rendue en réponse 500 : Next met en cache ISR toute réponse rendue,
    // statut compris, et une coupure passagère de la base pendant la revalidation casserait
    // la recherche des nouveaux visiteurs pendant 24 h. Sur une régénération par la
    // minuterie, une exception garde l'ancien index.
    // Après le marquage de `/api/revalidate`, Next ne relit plus cette copie : la route
    // rend 500 tant que la base ne répond pas.
    throw new Error('[search-index/dossiers] lecture des dossiers impossible');
  }

  const meta = new Map(metaRows.map((m) => [m.uid, m]));

  const dossiers = rows.map((d) => {
    const { nom, groupe } = initiateurAffiche(d);
    const m = meta.get(d.uid);
    return {
      uid: d.uid,
      titre: d.titre,
      // Traduction du titre par l'IA (`traduire_titres.py`), affichée sur /en et cherchée
      // dans les deux langues : en /en, taper le titre officiel français trouve toujours.
      titre_en: d.titre_en ?? null,
      themes: d.themes ?? null,
      procedure_libelle: d.procedure_libelle ?? null,
      date_depot: d.date_depot ?? null,
      statut_final: d.statut_final ?? null,
      initiateur_nom: nom,
      initiateur_groupe: groupe,
      has_texte: m?.has_texte ?? false,
      numero: m?.num_notice ?? null,
      chambre: m?.chambre ?? null,
      derniere_activite: m?.derniere_activite ?? null,
      dernier_acte_code: m?.dernier_acte_code ?? null,
    };
  });

  // La version pilote le cache IndexedDB du client, qui reconstruit son index
  // depuis le cache quand elle n'a pas bougé. Elle valait `max(updated_at)` :
  // or aucun script d'import n'écrit cette colonne et aucun trigger ne
  // l'entretient, elle ne changeait donc qu'à l'insertion d'un dossier neuf.
  // Un résumé IA régénéré, un statut modifié, une activité nouvelle n'atteignaient
  // jamais un visiteur déjà venu. L'empreinte du payload, elle, change exactement
  // quand le payload change, y compris quand un champ y est ajouté : c'est ce qui
  // dispense d'un numéro de schéma tenu à la main. Le coût est un hachage du
  // payload, payé une seule fois par régénération, donc une fois par jour.
  const version = empreinte(dossiers);
  // Calculée sur les mêmes lignes que la route des résumés, triées pareil par uid.
  // Les deux routes se régénèrent à des moments différents : un écart passager fait
  // seulement retélécharger les résumés jusqu'à la régénération suivante.
  const resumesVersion = resumesPayload(rows).version;

  const res = NextResponse.json({ version, resumesVersion, impactsVersion, dossiers });
  res.headers.set(
    'Cache-Control',
    'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800'
  );
  return res;
}

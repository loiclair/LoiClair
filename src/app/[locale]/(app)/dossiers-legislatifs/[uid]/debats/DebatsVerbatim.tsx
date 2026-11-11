'use client';

// Verbatim des débats d'un dossier, regroupé par séance puis par article ou amendement.
// Rendu par la page d'une séance (`[seance]/page.tsx`), qui lui passe les interventions
// déjà lues. Un fragment `#elu-<uid>`, posé par la fiche d'un élu, restreint l'affichage
// aux interventions de cet élu (voir `seance-slug.ts`).

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import PageHero from '@/components/PageHero';
import { titreDossier, titreTraduit } from '@/lib/titre-dossier';
import { AIBadgeTitre } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements';
import { eluDuFragment } from './seance-slug';

function abonnerFragment(rappel: () => void) {
  window.addEventListener('hashchange', rappel);
  return () => window.removeEventListener('hashchange', rappel);
}

interface Dossier {
  uid: string;
  titre: string | null;
  titre_en: string | null;
  statut_final: string | null;
  lien_an: string | null;
  lien_senat: string | null;
}

interface Intervention {
  id: number;
  ordre: number;
  point_titre: string | null;
  article: string | null;
  amendement: string | null;
  texte: string;
  stime: number | null;
  orateur_nom: string | null;
  orateur_qualite: string | null;
  role_debat: string | null;
  acteur_uid: string | null;
  seance: {
    uid: string;
    chambre: 'AN' | 'SEN';
    date_seance: string;
    titre: string | null;
    url_source: string | null;
    legislature: number | null;
  } | null;
  acteur: {
    uid: string;
    nom: string | null;
    prenom: string | null;
    groupe: { libelle_abrege: string | null; couleur_associee: string | null } | null;
  } | null;
}

interface Props {
  dossier: Dossier;
  interventions: Intervention[];
  /** Date de la séance, renseignée quand le composant ne rend qu'une seule séance :
   *  le fil d'Ariane gagne alors un cran, et « Débats » redevient un lien vers l'index. */
  seanceLabel?: string;
}

export default function DebatsVerbatim({ dossier, interventions, seanceLabel }: Props) {
  const t = useTranslations('resumeIA');
  const locale = useLocale();
  const dateLocale = locale === 'en' ? 'en-GB' : 'fr-FR';

  // Le fragment n'existe que dans le navigateur : le rendu serveur montre la séance
  // entière, et le filtre s'applique à l'hydratation.
  const fragment = useSyncExternalStore(abonnerFragment, () => window.location.hash, () => '');
  const eluDemande = eluDuFragment(fragment);
  const interventionsElu = useMemo(
    () => (eluDemande ? interventions.filter((iv) => iv.acteur_uid === eluDemande) : []),
    [interventions, eluDemande],
  );
  // Un élu absent de la séance (lien périmé, fragment tapé à la main) laisse la séance
  // entière plutôt qu'une page vide.
  const filtreElu = interventionsElu.length > 0;
  const visibles = filtreElu ? interventionsElu : interventions;
  const premiereElu = interventionsElu[0];
  const nomElu = premiereElu ? nomIntervenant(premiereElu) ?? '' : '';

  // `replaceState` ne déclenche pas `hashchange` : l'événement est émis à la main pour
  // que `useSyncExternalStore` relise le fragment. `history.state` est repassé tel quel,
  // le routeur de Next y range son propre état.
  const voirTouteSeance = () => {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  // Regroupe par séance, puis par "point" (article / amendement / point_titre)
  const seances = useMemo(() => {
    const bySeance = new Map<string, { seance: Intervention['seance']; groups: Map<string, Intervention[]> }>();
    for (const iv of visibles) {
      if (!iv.seance) continue;
      if (!bySeance.has(iv.seance.uid)) {
        bySeance.set(iv.seance.uid, { seance: iv.seance, groups: new Map() });
      }
      const entry = bySeance.get(iv.seance.uid)!;
      const groupKey = iv.amendement || iv.article || iv.point_titre || '—';
      if (!entry.groups.has(groupKey)) entry.groups.set(groupKey, []);
      entry.groups.get(groupKey)!.push(iv);
    }
    return Array.from(bySeance.values()).sort(
      (a, b) => (a.seance?.date_seance ?? '').localeCompare(b.seance?.date_seance ?? ''),
    );
  }, [visibles]);

  const [openSeances, setOpenSeances] = useState<Set<string>>(
    () => new Set(seances.map((s) => s.seance?.uid ?? '').filter(Boolean)),
  );

  const toggle = (uid: string) => {
    setOpenSeances((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const breadcrumb = [
    { label: t('debatsBreadcrumbTextes'), href: '/dossiers-legislatifs' },
    {
      label: titreDossier(dossier, locale) || `dossier ${dossier.uid}`,
      href: `/dossiers-legislatifs/${dossier.uid}/resume-ia`,
      ...(titreTraduit(dossier, locale) ? { badge: <AIBadgeTitre surBandeau /> } : {}),
    },
    { label: t('debatsBreadcrumbDebats'), ...(seanceLabel ? { href: `/dossiers-legislatifs/${dossier.uid}/debats` } : {}) },
    ...(seanceLabel ? [{ label: seanceLabel }] : []),
  ];

  if (interventions.length === 0) {
    return (
      <>
        <PageHero
          breadcrumb={breadcrumb}
          title={t('debatsTitle')}
          subtitle={dossier.uid}
        />
        <div style={{ maxWidth: '800px', margin: '2rem auto', padding: '0 1rem' }}>
          <p style={{ color: 'var(--muted-foreground)' }}>
            {t('noDebatesYet')}
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHero
        breadcrumb={breadcrumb}
        title={t('debatsTitle')}
        subtitle={dossier.uid}
      />
      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>
      <p style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
        {t('debatsVerbatimIntro')}
        {/* Une seule séance est rendue quand `seanceLabel` est fourni : l'invitation à
            choisir n'aurait alors rien à désigner. */}
        {!seanceLabel && ` ${t('debatsVerbatimDeplier')}`}
      </p>

      {filtreElu && (
        <p style={{ fontSize: '0.875rem', lineHeight: 1.5, margin: '0 0 1.5rem' }}>
          {t('debatsFiltreElu', { nom: nomElu })}{' '}
          <button
            type="button"
            onClick={voirTouteSeance}
            className="hover:underline"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--primary)', font: 'inherit' }}
          >
            {t('debatsVoirTouteSeance')}
          </button>
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {seances.map(({ seance, groups }) => {
          if (!seance) return null;
          const isOpen = openSeances.has(seance.uid);
          const [y, m, d] = seance.date_seance.split('-').map(Number);
          const dateStr = new Date(y, m - 1, d).toLocaleDateString(dateLocale, {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          });
          const chambreLabel = seance.chambre === 'AN' ? t('assemblee') : t('senat');
          const chambreColor = seance.chambre === 'AN' ? '#2563eb' : '#059669';
          const interventionsCount = Array.from(groups.values()).reduce((a, b) => a + b.length, 0);

          return (
            <section
              key={seance.uid}
              style={{ border: '1px solid var(--border)', borderRadius: '0.5rem', overflow: 'hidden' }}
            >
              <button
                onClick={() => toggle(seance.uid)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.875rem 1rem',
                  background: 'var(--muted)',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--foreground)',
                }}
                aria-expanded={isOpen}
              >
                {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                <span
                  style={{
                    padding: '0.15rem 0.5rem',
                    borderRadius: '0.25rem',
                    background: chambreColor + '20',
                    color: chambreColor,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                  }}
                >
                  {chambreLabel}
                </span>
                <span style={{ fontSize: '0.9375rem', fontWeight: 600 }}>{dateStr}</span>
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
                  {t('debatsInterventionCount', { count: interventionsCount })}
                </span>
              </button>

              {isOpen && (
                <div style={{ padding: '1rem 1.25rem', background: 'var(--background)' }}>
                  {seance.url_source && (
                    <a
                      href={seance.url_source}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        fontSize: '0.75rem',
                        color: 'var(--muted-foreground)',
                        textDecoration: 'none',
                        marginBottom: '1rem',
                      }}
                      className="hover:underline"
                    >
                      {t('debatsCompteRenduOfficiel')}
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  )}

                  {Array.from(groups.entries()).map(([key, ivs]) => (
                    <div key={key} style={{ marginBottom: '1.5rem' }}>
                      {key !== '—' && (
                        <h3
                          style={{
                            fontSize: '0.8125rem',
                            fontWeight: 600,
                            color: 'var(--muted-foreground)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.03em',
                            margin: '0 0 0.5rem',
                          }}
                        >
                          {key}
                        </h3>
                      )}
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {ivs.map((iv) => (
                          <InterventionItem key={iv.id} iv={iv} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      </div>
    </>
  );
}

// Nom affiché d'un orateur : celui de la fiche d'élu quand l'intervention y est
// rattachée, sinon le nom lu dans le compte rendu. Partagé par la ligne d'intervention
// et le bandeau du filtre par élu, pour qu'ils nomment la même personne de la même façon.
// Une fiche sans prénom ni nom retombe sur le nom du compte rendu, puis sur le libellé
// par défaut de l'appelant, au lieu d'afficher un nom vide.
function nomIntervenant(iv: Intervention): string | null {
  return iv.acteur
    ? `${iv.acteur.prenom ?? ''} ${iv.acteur.nom ?? ''}`.trim() || iv.orateur_nom
    : iv.orateur_nom;
}

// Une prise de parole du compte rendu : nom (lié à la fiche d'élu quand elle existe),
// groupe, qualité, puis le texte. Une didascalie n'affiche que son texte, en italique. Appelé par la liste d'une séance ci-dessus.
function InterventionItem({ iv }: { iv: Intervention }) {
  const t = useTranslations('resumeIA');
  const nomComplet = nomIntervenant(iv) ?? t('debatsIntervenantInconnu');
  const groupe = iv.acteur?.groupe?.libelle_abrege;
  const groupColor = iv.acteur?.groupe?.couleur_associee ?? '#6b7280';
  const isDidascalie = iv.orateur_qualite === 'didascalie';

  if (isDidascalie) {
    return (
      <li style={{ fontSize: '0.875rem', fontStyle: 'italic', color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
        {iv.texte}
      </li>
    );
  }

  return (
    <li>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
        {iv.acteur?.uid ? (
          <Link
            href={`/les-elus/${iv.acteur.uid}`}
            prefetch={false}
            style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--foreground)', textDecoration: 'none' }}
            className="hover:underline"
          >
            {nomComplet}
          </Link>
        ) : (
          <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{nomComplet}</span>
        )}
        {groupe && (
          <span
            style={{
              fontSize: '0.6875rem',
              padding: '0.1rem 0.35rem',
              borderRadius: '0.25rem',
              background: groupColor + '20',
              color: groupColor,
              fontWeight: 500,
            }}
          >
            {groupe}
          </span>
        )}
        {iv.orateur_qualite && (
          <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', fontStyle: 'italic' }}>
            {iv.orateur_qualite}
          </span>
        )}
      </div>
      <p style={{ fontSize: '0.9375rem', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{iv.texte}</p>
    </li>
  );
}

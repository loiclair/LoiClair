'use client';

// Champ de recherche de /les-elus : la saisie s'écrit dans le hash (`#q=`), que lit
// `ElusResultsClient`. Champ vide et actif, il déroule les élus `popularElus`.

import { useEffect, useState, useRef, useCallback } from 'react';
import { X, Search, MapPin } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
// Le routeur de next-intl, pas celui de Next : il préfixe la locale courante, là où
// celui de Next envoyait `/les-elus` sans locale, et donc vers la langue par défaut.
import { Link, useRouter } from '@/i18n/navigation';
import { useHashQuery } from '@/lib/search/use-hash-query';
import { openTrouverMonDeputeModal } from '@/components/TrouverMonDeputeModal';
import PhotoEluVignette from '@/components/PhotoEluVignette';

interface PopularElu {
  uid: string;
  prenom: string | null;
  nom: string | null;
  civ: string | null;
  url_profil_officiel: string | null;
  /** Mandat déjà traduit par l'appelant (« Sénateur », « Député », jamais
   *  accordé en genre), vide pour un ancien élu. Affiché à côté du nom parce
   *  que l'autorisation du Sénat sur les portraits impose de les montrer
   *  « à côté du nom et du mandat ». */
  role: string;
}

type Props = {
  placeholder?: string;
  popularElus?: PopularElu[];
};

export default function ElusSearchInput({ placeholder, popularElus }: Props) {
  const t = useTranslations('common');
  const tElus = useTranslations('elus');
  const [hashQuery, setHashQuery] = useHashQuery();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Sync hash → input (external navigation: back button, direct URL)
  // Skip when focused to avoid overwriting in-progress typing (e.g. trailing spaces lost via trim)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- sync de la valeur affichée avec le hash externe quand le champ n'est pas focus
  useEffect(() => { if (!focused) setValue(hashQuery); }, [hashQuery, focused]);

  // Migration douce : si un ancien lien ?q=… arrive, on copie vers #q=… et on le retire.
  useEffect(() => {
    const legacyQ = searchParams.get('q');
    if (legacyQ) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('q');
      const qs = params.toString();
      const url = `/les-elus${qs ? `?${qs}` : ''}#q=${encodeURIComponent(legacyQ)}`;
      router.replace(url, { scroll: false });
    }
  }, [searchParams, router]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setHashQuery(next.trim());
    }, 150);
  }, [setHashQuery]);

  const handleClear = useCallback(() => {
    setValue('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setHashQuery('');
  }, [setHashQuery]);

  const showDropdown = focused && !value && (popularElus?.length ?? 0) > 0;
  const cpMatch = /^\d{5}$/.test(value.trim()) ? value.trim() : null;

  return (
    <div style={{ position: 'relative', maxWidth: '640px', margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'var(--color-card)',
          borderRadius: '9999px',
          overflow: 'hidden',
          border: focused ? '1px solid var(--primary)' : '1px solid var(--border)',
          boxShadow: focused ? '0 6px 24px -4px rgb(6 182 212 / 0.25)' : '0 4px 16px -2px rgb(0 0 0 / 0.10)',
          transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
        }}
      >
        <Search style={{ width: 18, height: 18, flexShrink: 0, marginLeft: '1rem', color: 'var(--muted-foreground)' }} />
        <input
          type="text"
          placeholder={placeholder ?? t('searchPlaceholder')}
          value={value}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          className="w-full text-foreground focus:outline-none"
          style={{ border: 'none', backgroundColor: 'transparent', padding: '1rem 1.5rem 1rem 0.75rem', fontSize: '1rem', flex: 1 }}
        />
        {value && (
          <button
            onClick={handleClear}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t('clearSearch')}
            style={{ padding: 6, display: 'flex', alignItems: 'center', marginRight: 8 }}
          >
            <X style={{ width: 18, height: 18 }} />
          </button>
        )}
      </div>

      {cpMatch && (
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); openTrouverMonDeputeModal({ initialCp: cpMatch, initialTab: 'cp' }); }}
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            right: 0,
            backgroundColor: 'var(--popover)',
            borderRadius: '0.875rem',
            boxShadow: '0 4px 24px -4px rgb(0 0 0 / 0.12)',
            padding: '0.75rem 1rem',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            gap: '0.625rem',
            cursor: 'pointer',
            border: 'none',
            textAlign: 'left',
            color: 'var(--foreground)',
            width: '100%',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 9999, backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}>
            <MapPin size={15} />
          </span>
          <span style={{ fontSize: 14 }}>
            {tElus('cpInlineSuggestion')}{' '}
            <strong>{cpMatch}</strong>
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--muted-foreground)' }}>→</span>
        </button>
      )}

      {showDropdown && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          left: 0,
          right: 0,
          backgroundColor: 'var(--popover)',
          borderRadius: '1rem',
          boxShadow: '0 4px 24px -4px rgb(0 0 0 / 0.12)',
          padding: '0.75rem',
          zIndex: 50,
        }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem', padding: '0 0.5rem' }}>
            {tElus('popularTitle')}
          </p>
          {popularElus!.map((elu) => {
            const civPrefix = elu.civ === 'Mme' ? 'Mme ' : elu.civ === 'M.' ? 'M. ' : '';
            return (
              <Link
                key={elu.uid}
                href={`/les-elus/${elu.uid}`}
                prefetch={false}
                className="hover:bg-muted"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.625rem',
                  padding: '0.5rem',
                  borderRadius: '0.5rem',
                  color: 'var(--foreground)',
                  textDecoration: 'none',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                }}
              >
                <PhotoEluVignette acteur={elu} taille={28} />
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {civPrefix}{elu.prenom} {elu.nom}
                </span>
                {elu.role && (
                  <span style={{ marginLeft: 'auto', paddingLeft: '0.5rem', fontSize: 12, fontWeight: 400, color: 'var(--muted-foreground)', flexShrink: 0 }}>
                    {elu.role}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

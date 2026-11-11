'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { X, Search, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useHashQuery } from '@/lib/search/use-hash-query';
import { AIBadgeTitre } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements';

interface PopularDossier {
  uid: string;
  titre: string;
  /** Vrai quand `titre` est la traduction de l'IA (sur /en) : l'intitulé du menu porte le badge. */
  titreTraduit?: boolean;
}

// Champ de recherche de /dossiers-legislatifs, repris par « Ce qui me concerne » :
// il écrit la requête dans le hash (`#q=`) et laisse la page filtrer. `placeholder`
// remplace le texte d'aide de la page Textes, qui parle de titre et d'auteur, `icon`
// la loupe et `clearLabel` le nom du bouton qui vide le champ : « Ce qui me concerne »
// ne cherche pas, elle filtre sa liste.
export default function DossiersSearchInput({ popularDossiers = [], placeholder, icon: Icone = Search, clearLabel }: { popularDossiers?: PopularDossier[]; placeholder?: string; icon?: LucideIcon; clearLabel?: string }) {
  const t = useTranslations('common');
  const tDossiers = useTranslations('dossiers');
  const [hashQuery, setHashQuery] = useHashQuery();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Skip when focused to avoid overwriting in-progress typing (e.g. trailing spaces lost via trim)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- sync de la valeur affichée avec le hash externe quand le champ n'est pas focus
  useEffect(() => { if (!focused) setValue(hashQuery); }, [hashQuery, focused]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setHashQuery(next.trim()), 200);
  }, [setHashQuery]);

  const handleClear = useCallback(() => {
    setValue('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setHashQuery('');
  }, [setHashQuery]);

  const showDropdown = focused && !value && popularDossiers.length > 0;

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
        <Icone style={{ width: 18, height: 18, flexShrink: 0, marginLeft: '1rem', color: 'var(--muted-foreground)' }} />
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
            aria-label={clearLabel ?? t('clearSearch')}
            style={{ padding: 6, display: 'flex', alignItems: 'center', marginRight: 8 }}
          >
            <X style={{ width: 18, height: 18 }} />
          </button>
        )}
      </div>

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
            {tDossiers('popularTitle')}
            {popularDossiers.some((d) => d.titreTraduit) && <span style={{ marginLeft: '6px', textTransform: 'none', letterSpacing: 0 }}><AIBadgeTitre pluriel /></span>}
          </p>
          {popularDossiers.map((d) => (
            <Link
              key={d.uid}
              href={`/dossiers-legislatifs/${d.uid}/resume-ia`}
              prefetch={false}
              className="hover:bg-muted"
              style={{
                display: 'block',
                padding: '0.625rem 0.5rem',
                borderRadius: '0.5rem',
                color: 'var(--foreground)',
                textDecoration: 'none',
                fontSize: '0.875rem',
                fontWeight: 500,
              }}
            >
              {d.titre}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useCarteDepartements } from '@/hooks/useCarteDepartements';

// Carte de France des départements colorée par valeur (échelle log), avec infobulle au
// survol. Lue par /Facts/representativite/geographie. Le tracé vient de
// `useCarteDepartements` (chargé depuis `public/`, pas en prop : voir ce hook) ; la
// place de la carte est réservée jusqu'à son arrivée.

type Props = {
  data: Record<string, number | undefined>;
  deptNames: Record<string, string>;
  title: string;
  description: string;
  note: string;
  valueLabel: string;
  /** Valeur minimale de la plage (pour l'échelle log). */
  minValue: number;
  /** Valeur maximale de la plage (pour l'échelle log). */
  maxValue: number;
  /** Locale pour toLocaleString (ex. "fr", "en"). */
  locale: string;
  colorFrom?: string;
  colorTo?: string;
  colorUnknown?: string;
  /** Label du côté clair de la légende (ex. "Sur-représenté"). */
  legendLabelMin?: string;
  /** Label du côté foncé de la légende (ex. "Sous-représenté"). */
  legendLabelMax?: string;
};

type Tooltip = {
  x: number;
  y: number;
  name: string;
  code: string;
  value: number | undefined;
};

const isDeptCode = (c: string) => /^(\d{1,3}|2A|2B)$/.test(c);

export function FranceChoropleth({
  data,
  deptNames,
  title,
  description,
  note,
  valueLabel,
  minValue,
  maxValue,
  locale,
  colorFrom = '#e2e8f0',
  colorTo = '#0f172a',
  colorUnknown = '#f1f5f9',
  legendLabelMin,
  legendLabelMax,
}: Props) {
  const logMin = useMemo(() => Math.log(Math.max(minValue, 1)), [minValue]);
  const logMax = useMemo(() => Math.log(Math.max(maxValue, 2)), [maxValue]);

  const colorScale = useCallback(
    (v: number | undefined): string => {
      if (v === undefined || v <= 0) return colorFrom;
      const t = (Math.log(v) - logMin) / Math.max(logMax - logMin, 0.0001);
      return lerpHex(colorFrom, colorTo, t);
    },
    [logMin, logMax, colorFrom, colorTo]
  );

  const formatValue = useCallback(
    (v: number) => v.toLocaleString(locale),
    [locale]
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const svgMarkup = useCarteDepartements();

  // Bake fills, layout, and styles directly into the SVG string.
  // Nothing layout-related is left to useEffect: the SVG always has the
  // correct size/position from the moment it enters the DOM, so tooltip
  // re-renders cannot cause a position jump or resize flash.
  const cleanedSvg = useMemo(() => {
    if (!svgMarkup) return null;
    let s = svgMarkup
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      // Remove native <title> to prevent the browser tooltip overlapping our custom one.
      .replace(/<title>[\s\S]*?<\/title>/gi, '');

    // Normalise SVG root element: remove existing width/height attributes,
    // then inject responsive layout attributes.
    s = s
      .replace(/(<svg\b[^>]*?)\s+width="[^"]*"/i, '$1')
      .replace(/(<svg\b[^>]*?)\s+height="[^"]*"/i, '$1')
      .replace(
        /<svg\b/i,
        '<svg width="100%" style="height:auto;max-width:640px;display:block;margin:0 auto"'
      );

    // Inject fill + interaction styles on every id="dXX" element.
    s = s.replace(
      /id="d([0-9]{1,3}|2A|2B)"/g,
      (_match, code) => {
        const v = data[code];
        const fill = v === undefined ? colorUnknown : colorScale(v);
        return `id="d${code}" fill="${fill}" style="stroke:#fff;stroke-width:0.5;cursor:pointer;transition:opacity 0.15s"`;
      }
    );

    return s;
  }, [svgMarkup, data, colorScale, colorUnknown]);

  // Child <path> elements inside SVG groups may carry their own fill attribute
  // that overrides the parent group fill. Reset them to inherit so the group
  // fill (set above in the string) is applied correctly.
  // This effect has no layout side-effects, so re-running it on cleanedSvg
  // change is safe — no jump will occur.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    root.querySelectorAll<SVGElement>('[id^="d"]').forEach((el) => {
      const code = (el.getAttribute('id') || '').slice(1);
      if (!isDeptCode(code)) return;
      el.querySelectorAll<SVGElement>('path').forEach((child) => {
        child.setAttribute('fill', 'inherit');
        child.style.stroke = '#ffffff';
        child.style.strokeWidth = '0.5';
      });
    });
  }, [cleanedSvg]);

  const pickTarget = (e: React.MouseEvent<HTMLDivElement>) => {
    let node: Element | null = e.target as Element;
    while (node && node !== containerRef.current) {
      const id = node.getAttribute?.('id') || '';
      if (id.startsWith('d') && isDeptCode(id.slice(1))) {
        return { el: node as SVGElement, code: id.slice(1) };
      }
      node = node.parentElement;
    }
    return null;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const hit = pickTarget(e);
    if (!hit) {
      if (tooltip) setTooltip(null);
      return;
    }
    const rect = containerRef.current!.getBoundingClientRect();
    const name = deptNames[hit.code] || hit.el.getAttribute('title') || hit.code;
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      name,
      code: hit.code,
      value: data[hit.code],
    });
  };

  const handleMouseLeave = () => setTooltip(null);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1" style={{ position: 'relative' }}>
        <div
          ref={containerRef}
          // Tant que le tracé n'est pas là, la place qu'il prendra est réservée
          // (largeur plafonnée à 640 px, proportions de son viewBox).
          style={cleanedSvg ? { width: '100%' } : { width: '100%', maxWidth: '640px', margin: '0 auto', aspectRatio: '385 / 447' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          dangerouslySetInnerHTML={{ __html: cleanedSvg ?? '' }}
        />
        {(legendLabelMin || legendLabelMax) && (
          <div
            style={{
              maxWidth: '640px',
              margin: '0.625rem auto 0',
              padding: '0 0.25rem',
            }}
          >
            <div
              style={{
                height: '8px',
                borderRadius: '4px',
                background: `linear-gradient(to right, ${colorFrom}, ${colorTo})`,
              }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '4px',
              }}
            >
              {legendLabelMin && (
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                  {legendLabelMin}
                </span>
              )}
              {legendLabelMax && (
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                  {legendLabelMax}
                </span>
              )}
            </div>
          </div>
        )}
        {tooltip && (
          <div
            style={{
              position: 'absolute',
              left: tooltip.x + 12,
              top: tooltip.y + 12,
              pointerEvents: 'none',
              background: '#0f172a',
              color: '#fff',
              padding: '0.375rem 0.625rem',
              borderRadius: '0.375rem',
              fontSize: '0.75rem',
              lineHeight: 1.35,
              boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
              whiteSpace: 'nowrap',
              zIndex: 10,
            }}
          >
            <div style={{ fontWeight: 600 }}>{tooltip.name}</div>
            <div style={{ opacity: 0.85 }}>
              {tooltip.value === undefined
                ? '—'
                : `${formatValue(tooltip.value)} ${valueLabel}`}
            </div>
          </div>
        )}
      </CardContent>
      {note && (
        <CardFooter className="text-xs text-muted-foreground leading-relaxed">
          {note}
        </CardFooter>
      )}
    </Card>
  );
}

// Interpolation linéaire entre deux couleurs hex (#rrggbb).
export function lerpHex(a: string, b: string, t: number): string {
  const clamp = Math.max(0, Math.min(1, t));
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 0xff;
  const ag = (pa >> 8) & 0xff;
  const ab = pa & 0xff;
  const br = (pb >> 16) & 0xff;
  const bg = (pb >> 8) & 0xff;
  const bb = pb & 0xff;
  const r = Math.round(ar + (br - ar) * clamp);
  const g = Math.round(ag + (bg - ag) * clamp);
  const bl = Math.round(ab + (bb - ab) * clamp);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}

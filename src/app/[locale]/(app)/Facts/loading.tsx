'use client';

// Squelette de chargement de tout `/Facts` : Next l'applique au hub et à chaque page
// de fait qui n'a pas son propre `loading.tsx`. Le hub a sa propre mise en page, une
// page de fait suit le gabarit commun (la réponse, héros de chiffres, « À comprendre »,
// « En chiffres ») : sans l'aiguillage sur le chemin, les pages de fait affichaient la
// grille du hub. Aucune largeur maximale ici, comme les pages elles-mêmes : la largeur
// vient d'`AppShell`, sinon le squelette paraît plus étroit que le contenu qui le remplace.
import { Skeleton } from '@/components/ui/skeleton';
import { usePathname } from '@/i18n/navigation';

export default function FactsLoading() {
  const pathname = usePathname();
  return pathname === '/Facts' ? <HubSkeleton /> : <FactSkeleton />;
}

function HubSkeleton() {
  return (
    <div style={{ paddingTop: '2rem' }}>
      {/* Titre */}
      <Skeleton className="h-7 w-48 mb-2" />
      <Skeleton className="h-4 w-80 mb-8" />

      {/* Grille de cartes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border p-5 space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>

      {/* Lien dashboard */}
      <Skeleton className="h-4 w-56" />
    </div>
  );
}

function FactSkeleton() {
  return (
    <div className="py-12 space-y-8">
      <Skeleton className="h-8 w-3/4 max-w-xl" />
      <Skeleton className="h-5 w-24 mb-2" />
      <Skeleton className="h-6 w-full max-w-2xl" />
      <Skeleton className="h-6 w-4/5 max-w-xl mb-8" />

      {/* Hero card */}
      <Skeleton className="h-48 w-full rounded-xl mb-8" />

      {/* Accordion */}
      <Skeleton className="h-5 w-32 mb-3" />
      <Skeleton className="h-40 w-full rounded-lg mb-8" />

      {/* En chiffres */}
      <Skeleton className="h-5 w-28 mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl md:col-span-2" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl md:col-span-2" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}

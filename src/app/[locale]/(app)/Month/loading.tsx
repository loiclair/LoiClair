import { Skeleton } from '@/components/ui/skeleton';

export default function MonthLoading() {
  return (
    <div style={{ padding: "1.5rem" }}>
      {/* Titre + sous-titre */}
      <div className="mb-6">
        <Skeleton className="h-6 w-40 mb-2" />
        <Skeleton className="h-4 w-24" />
      </div>

      {/* Filtres pills */}
      <div className="flex gap-2 mb-8 flex-wrap">
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
      </div>

      {/* Cartes événements */}
      <div className="space-y-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-lg shrink-0 mt-1" />
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <div className="flex items-center gap-4 pt-1">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="h-4 w-4 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

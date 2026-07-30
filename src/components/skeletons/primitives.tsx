import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';

// Building blocks reused by the per-page skeletons in this folder. Keep
// these generic (no page-specific spacing/columns) - page skeletons compose
// them inside their own grid so the loading state roughly matches the real
// layout instead of a single centered spinner.

export function StatTileSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-4">
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-20" />
        </div>
        <Skeleton className="h-5 w-5 rounded-sm" />
      </CardContent>
    </Card>
  );
}

export function StatTileGridSkeleton({ count = 4, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={`grid grid-cols-2 gap-4 md:grid-cols-4 ${className}`}>
      {Array.from({ length: count }).map((_, i) => <StatTileSkeleton key={i} />)}
    </div>
  );
}

export function CardTileSkeleton() {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <Skeleton className="h-3 w-10" />
        </div>
        <Skeleton className="mb-2 h-3 w-16" />
        <Skeleton className="h-6 w-24" />
      </CardContent>
    </Card>
  );
}

export function CardGridSkeleton({ count = 4, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
      {Array.from({ length: count }).map((_, i) => <CardTileSkeleton key={i} />)}
    </div>
  );
}

export function ProgressCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="mt-2 flex justify-between">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

export function ProgressCardGridSkeleton({ count = 3, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${className}`}>
      {Array.from({ length: count }).map((_, i) => <ProgressCardSkeleton key={i} />)}
    </div>
  );
}

export function ListRowSkeleton({ withBadge = true }: { withBadge?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5">
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      {withBadge && <Skeleton className="h-4 w-16 shrink-0 rounded-full" />}
      <Skeleton className="h-4 w-20 shrink-0" />
    </div>
  );
}

export function ListSkeleton({ count = 5, withBadge = true, className = '' }: { count?: number; withBadge?: boolean; className?: string }) {
  return (
    <div className={`space-y-1 ${className}`}>
      {Array.from({ length: count }).map((_, i) => <ListRowSkeleton key={i} withBadge={withBadge} />)}
    </div>
  );
}

export function PanelSkeleton({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="space-y-3 p-4 sm:p-6">
        <Skeleton className="h-4 w-1/3" />
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-3" style={{ width: `${85 - i * 12}%` }} />
        ))}
      </CardContent>
    </Card>
  );
}

export function ChartPanelSkeleton({ className = '' }: { className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="p-4 sm:p-6">
        <Skeleton className="mb-4 h-4 w-1/3" />
        <Skeleton className="h-56 w-full rounded-lg" />
      </CardContent>
    </Card>
  );
}

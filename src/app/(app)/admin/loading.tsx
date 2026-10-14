import { Skeleton } from '@/components/ui/skeleton'

export default function AdminLoading() {
  return (
    <div className="space-y-6 pb-8">
      <div className="srf-console srf-console-edge p-5">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="mt-3 h-7 w-64" />
        <Skeleton className="mt-3 h-4 w-96" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="srf-proof p-4"><Skeleton className="h-8 w-16" /><Skeleton className="mt-2 h-3 w-12" /></div>
        <div className="srf-proof p-4"><Skeleton className="h-8 w-16" /><Skeleton className="mt-2 h-3 w-12" /></div>
        <div className="srf-proof p-4"><Skeleton className="h-8 w-16" /><Skeleton className="mt-2 h-3 w-12" /></div>
      </div>
      <div className="srf-console p-5"><Skeleton className="h-40 w-full" /></div>
    </div>
  );
}

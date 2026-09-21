import { Skeleton } from '@/components/ui';

/** Route-level skeleton: the layout appears instantly, content streams in. */
const Loading = () => (
  <div className="container-page py-8">
    <Skeleton className="h-6 w-56" />
    <Skeleton className="mt-6 h-10 w-80" />
    <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index}>
          <Skeleton className="aspect-[4/3] w-full" />
          <Skeleton className="mt-3 h-4 w-3/4" />
          <Skeleton className="mt-2 h-4 w-1/2" />
        </div>
      ))}
    </div>
  </div>
);

export default Loading;

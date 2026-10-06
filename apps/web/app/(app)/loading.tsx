export default function AppLoading() {
  return (
    <div className="flex flex-col gap-5 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <div className="h-6 w-48 bg-dim-200 rounded-[8px]" />
          <div className="h-3.5 w-64 bg-dim-100 rounded-[6px]" />
        </div>
        <div className="h-9 w-32 bg-dim-200 rounded-[10px]" />
      </div>

      {/* KPI cards skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08)] p-5">
            <div className="w-9 h-9 bg-dim-100 rounded-[10px] mb-3" />
            <div className="h-7 w-16 bg-dim-200 rounded-[6px] mb-2" />
            <div className="h-3 w-24 bg-dim-100 rounded-[6px] mb-1" />
            <div className="h-3 w-20 bg-dim-100 rounded-[6px]" />
          </div>
        ))}
      </div>

      {/* Main content skeleton */}
      <div className="bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08)] overflow-hidden">
        <div className="px-5 py-4 border-b border-dim-100 flex items-center justify-between">
          <div className="h-4 w-36 bg-dim-200 rounded-[6px]" />
          <div className="h-4 w-20 bg-dim-100 rounded-[6px]" />
        </div>
        <div className="p-5 flex flex-col gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-2 border-b border-dim-50 last:border-0">
              <div className="w-7 h-7 bg-dim-100 rounded-full shrink-0" />
              <div className="h-3 bg-dim-100 rounded-[6px]" style={{ width: `${55 + (i * 7) % 35}%` }} />
              <div className="h-3 w-16 bg-dim-100 rounded-[6px] ml-auto shrink-0" />
              <div className="h-5 w-20 bg-dim-100 rounded-full shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

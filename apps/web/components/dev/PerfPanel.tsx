"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { usePerfStore } from "../../lib/perf-store";
import type { ApiCall } from "../../lib/perf-store";

/* ── Fetch interceptor + route tracker lives here ────────── */
function usePerfBootstrap() {
  const pathname = usePathname();
  const startRoute = usePerfStore((s) => s.startRoute);
  const recordFetch = usePerfStore((s) => s.recordFetch);
  const didMount = useRef(false);
  const routeStart = useRef(performance.now());

  // Route transition timer
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      startRoute(pathname);
      return;
    }
    startRoute(pathname);
    routeStart.current = performance.now();
  }, [pathname, startRoute]);

  // Fetch interceptor — installed once
  useEffect(() => {
    if (typeof window === "undefined") return;
    const original = window.fetch;

    window.fetch = async function (input, init) {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.href
          : (input as Request).url;

      const method =
        (init?.method as string | undefined)?.toUpperCase() ??
        (input instanceof Request ? input.method : "GET");

      const t0 = performance.now();
      let res: Response | undefined;
      try {
        res = await original.call(this, input, init);
      } catch (err) {
        // Record the failed fetch so the perf panel shows it, then propagate
        recordFetch({
          url,
          method,
          durationMs: Math.round(performance.now() - t0),
          status: 0,
          sqlCount: 0,
          sqlMs: 0,
          requestId: "",
        });
        throw err;
      }
      const durationMs = Math.round(performance.now() - t0);

      const sqlCount = parseInt(res.headers.get("x-query-count") ?? "0", 10);
      const sqlMs    = parseInt(res.headers.get("x-query-time") ?? "0", 10);
      const requestId = res.headers.get("x-request-id") ?? "";

      recordFetch({
        url,
        method,
        durationMs,
        status: res.status,
        sqlCount,
        sqlMs,
        requestId,
      });

      return res;
    };

    return () => {
      window.fetch = original;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/* ── Vitals display helpers ───────────────────────────────── */
const VITAL_GOOD: Record<string, number> = { LCP: 2500, FID: 100, CLS: 0.1, FCP: 1800, TTFB: 800, INP: 200 };

function ratingDot(name: string, value: number) {
  const threshold = VITAL_GOOD[name];
  if (!threshold) return "○";
  return value <= threshold ? "✓" : value <= threshold * 2 ? "△" : "✗";
}

function vitalColor(name: string, value: number): string {
  const threshold = VITAL_GOOD[name];
  if (!threshold) return "text-dim-400";
  if (value <= threshold) return "text-emerald-400";
  if (value <= threshold * 2) return "text-amber-400";
  return "text-red-400";
}

/* ── Row components ───────────────────────────────────────── */
function MetricRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[10px] text-slate-400">{label}</span>
      <span className={`font-mono text-[11px] font-semibold ${warn ? "text-amber-400" : "text-slate-100"}`}>
        {value}
      </span>
    </div>
  );
}

function CallRow({ call }: { call: ApiCall }) {
  const short = call.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 48);
  return (
    <div className={`flex items-center gap-1.5 py-0.5 ${call.duplicate ? "text-amber-400" : "text-slate-300"}`}>
      <span className="text-[9px] font-mono opacity-60 w-8 shrink-0">{call.method}</span>
      <span className="text-[10px] font-mono flex-1 truncate">{short}</span>
      <span className="text-[9px] font-mono opacity-60 shrink-0">{call.durationMs}ms</span>
      {call.sqlCount > 0 && (
        <span className="text-[9px] font-mono text-slate-500 shrink-0">({call.sqlCount}q)</span>
      )}
      {call.duplicate && <span className="text-[9px] text-amber-400 shrink-0">DUP</span>}
    </div>
  );
}

/* ── Panel ────────────────────────────────────────────────── */
export function PerfPanel() {
  const [open, setOpen] = useState(false);
  const current = usePerfStore((s) => s.current);
  usePerfBootstrap();

  if (process.env.NODE_ENV !== "development") return null;

  const duplicates = current?.apiCalls.filter((c) => c.duplicate).length ?? 0;
  const hasWarning = duplicates > 0 || (current?.transitionMs ?? 0) > 300;

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] font-mono select-none"
      style={{ userSelect: "none" }}
    >
      {open ? (
        /* ── Expanded panel ── */
        <div className="w-72 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden">
          {/* Header */}
          <button
            onClick={() => setOpen(false)}
            className="w-full flex items-center justify-between px-3 py-2 bg-slate-800 hover:bg-slate-750 border-b border-slate-700 cursor-pointer"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-brand-400 font-bold">⚡ PERF</span>
              <span className="text-[10px] text-slate-400 truncate max-w-[140px]">
                {current?.route ?? "—"}
              </span>
            </div>
            <span className="text-slate-500 text-[10px]">✕</span>
          </button>

          <div className="px-3 py-2 border-b border-slate-800">
            <MetricRow
              label="Route transition"
              value={`${current?.transitionMs ?? 0} ms`}
              warn={(current?.transitionMs ?? 0) > 300}
            />
            <MetricRow
              label="API calls"
              value={String(current?.apiCalls.length ?? 0)}
            />
            <MetricRow
              label="Duplicate calls"
              value={duplicates > 0 ? `⚠ ${duplicates}` : "0"}
              warn={duplicates > 0}
            />
            <MetricRow
              label="SQL queries"
              value={String(current?.sqlCount ?? 0)}
            />
            <MetricRow
              label="SQL total time"
              value={`${current?.sqlMs ?? 0} ms`}
              warn={(current?.sqlMs ?? 0) > 100}
            />
          </div>

          {/* Web Vitals */}
          {current && Object.keys(current.vitals).length > 0 && (
            <div className="px-3 py-2 border-b border-slate-800">
              {Object.entries(current.vitals).map(([name, { value }]) => (
                <div key={name} className="flex items-center justify-between py-0.5">
                  <span className="text-[10px] text-slate-400">{name}</span>
                  <span className={`font-mono text-[11px] font-semibold ${vitalColor(name, value)}`}>
                    {ratingDot(name, value)}{" "}
                    {name === "CLS" ? value.toFixed(3) : `${Math.round(value)} ms`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* API calls */}
          {current && current.apiCalls.length > 0 && (
            <div className="px-3 py-2 max-h-40 overflow-y-auto">
              <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-1">Calls this route</p>
              {current.apiCalls.map((call, i) => (
                <CallRow key={i} call={call} />
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="px-3 py-1.5 bg-slate-950 border-t border-slate-800">
            <span className="text-[9px] text-slate-600">
              ANALYZE=true pnpm --filter @cap/web build
            </span>
          </div>
        </div>
      ) : (
        /* ── Collapsed chip ── */
        <button
          onClick={() => setOpen(true)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] font-bold shadow-lg border cursor-pointer transition-colors ${
            hasWarning
              ? "bg-amber-900/80 border-amber-700 text-amber-300 hover:bg-amber-900"
              : "bg-slate-900/90 border-slate-700 text-slate-300 hover:bg-slate-800"
          }`}
        >
          <span>⚡</span>
          <span>{current?.transitionMs ?? 0}ms</span>
          {duplicates > 0 && (
            <span className="bg-amber-500 text-black text-[9px] font-bold px-1 rounded-full">
              ⚠{duplicates}
            </span>
          )}
        </button>
      )}
    </div>
  );
}

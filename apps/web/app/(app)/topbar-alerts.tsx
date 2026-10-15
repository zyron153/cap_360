"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { Bell } from "lucide-react";
import { usePermissions } from "./hooks/use-permissions";

export type TopbarAlert = { key: string; href: string; text: string; tone: "amber" | "blue" };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url);
  return res.json();
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What reception needs to chase this week, from live data: unconfirmed appointments in the next
 * 7 days, and active health plans whose end date falls in the next 7 days. Admin and receptionist
 * only — they are the roles that confirm bookings and renew plans — and an alert with a count of 0
 * simply isn't there.
 */
export function useTopbarAlerts(): TopbarAlert[] {
  const { role, can, isLoading } = usePermissions();
  const works = !isLoading && (role === "admin" || role === "receptionist");
  const now = new Date();
  const from = format(now, "yyyy-MM-dd");
  const to = format(addDays(now, 7), "yyyy-MM-dd");

  const appts = useQuery({
    queryKey: ["topbar-alerts", "appointments", from],
    queryFn: () => fetchJson<{ status: string }[]>(`/api/appointments?${new URLSearchParams({ from, to })}`),
    enabled: works && can("appointments"),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const plans = useQuery({
    queryKey: ["topbar-alerts", "plans"],
    queryFn: () => fetchJson<{ active: boolean; endDate: string | null }[]>("/api/health-plans"),
    enabled: works && can("health_plans"),
    staleTime: 300_000,
  });

  const pending = (appts.data ?? []).filter((a) => a.status === "pending").length;
  const ending = (plans.data ?? []).filter((p) => p.active && p.endDate && p.endDate.slice(0, 10) >= from && p.endDate.slice(0, 10) <= to).length;

  return [
    ...(pending > 0 ? [{ key: "pending", href: "/appointments", tone: "amber" as const, text: `${plural(pending, "marcação por confirmar", "marcações por confirmar")} (próximos 7 dias)` }] : []),
    ...(ending > 0 ? [{ key: "plans", href: "/health-plans", tone: "blue" as const, text: `${plural(ending, "plano termina", "planos terminam")} nos próximos 7 dias` }] : []),
  ];
}

const TONE = {
  amber: "bg-amber-50 text-amber-700 border-amber-200/80 hover:bg-amber-100",
  blue: "bg-blue-50 text-blue-700 border-blue-200/80 hover:bg-blue-100",
} as const;

/** The alerts as chips — only where there is room (the topbar also holds the clock and the search). */
export function AlertChips({ alerts }: { alerts: TopbarAlert[] }) {
  if (!alerts.length) return null;
  return (
    <div className="hidden 2xl:flex items-center gap-3">
      {alerts.map((a) => (
        <Link key={a.key} href={a.href} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[11px] font-medium border transition-colors ${TONE[a.tone]}`}>
          {a.text}
        </Link>
      ))}
    </div>
  );
}

/** The bell lists the same alerts at every width, and only shows its dot when there is something to see. */
export function AlertsBell({ alerts }: { alerts: TopbarAlert[] }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={alerts.length ? `Alertas (${alerts.length})` : "Alertas"}
        aria-expanded={open}
        className="w-9 h-9 rounded-md flex items-center justify-center text-dim-500 hover:bg-dim-100 hover:text-dim-700 transition-colors relative"
      >
        <Bell className="w-4 h-4" />
        {alerts.length > 0 && <span className="w-[7px] h-[7px] bg-red-500 rounded-full border-2 border-white absolute top-1.5 right-1.5" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 max-w-[calc(100vw-2rem)] z-30 bg-white rounded-[12px] border border-dim-200 shadow-[0_8px_24px_rgba(0,0,0,.12)] overflow-hidden">
          {alerts.length === 0 ? (
            <p className="text-[12px] text-dim-500 px-4 py-4">Sem alertas.</p>
          ) : (
            alerts.map((a) => (
              <Link key={a.key} href={a.href} className="block px-4 py-3 text-[12px] text-dim-800 hover:bg-dim-50 border-b border-dim-100 last:border-0 transition-colors">
                {a.text}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

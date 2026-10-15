"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { PerfPanel } from "../../components/dev/PerfPanel";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * The page frame. From `lg` the sidebar is a fixed 240px column; below that it is an off-canvas
 * drawer opened from the topbar's menu button — a fixed sidebar left ~150px of content on a phone
 * (and a squeezed form on a portrait tablet).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setNavOpen(false), [pathname]); // close after navigating

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNavOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className="flex h-screen overflow-hidden bg-dim-100">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      {navOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setNavOpen(false)} aria-hidden />}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Topbar onMenu={() => setNavOpen(true)} menuOpen={navOpen} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
      {process.env.NODE_ENV === "development" && <PerfPanel />}
    </div>
  );
}

"use client";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { AlertChips, AlertsBell, useTopbarAlerts } from "./topbar-alerts";
import { TopbarSearch } from "./topbar-search";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard":    "Dashboard",
  "/appointments": "Agendamentos",
  "/patients":     "Pacientes",
  "/billing":      "Financeiro",
  "/health-plans": "Planos de Saúde",
  "/whatsapp":     "WhatsApp Hub",
  "/exams":        "Exames & Resultados",
  "/records":      "Registos Clínicos",
  "/staff":        "Equipa & Turnos",
  "/visits":       "Visitas Domiciliárias",
  "/analytics":    "Analytics",
  "/settings":       "Configurações",
  "/access":         "Gestão de Acesso",
  "/parametrizacoes":"Parametrizações",
};

const DAYS   = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function Topbar({ onMenu, menuOpen }: { onMenu: () => void; menuOpen: boolean }) {
  const pathname = usePathname();
  const baseRoute = "/" + (pathname.split("/").filter(Boolean)[0] ?? "dashboard");
  const title = PAGE_TITLES[pathname] ?? PAGE_TITLES[baseRoute] ?? "Dashboard";
  const alerts = useTopbarAlerts();

  const [clock, setClock] = useState("");

  useEffect(() => {
    function tick() {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      setClock(`${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()} · ${hh}:${mm}`);
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="h-[60px] bg-white border-b border-dim-200 flex items-center px-4 lg:px-6 gap-3 lg:gap-4 shrink-0 shadow-[0_1px_2px_rgba(0,0,0,.05)]">
      {/* Opens the sidebar drawer — below lg the sidebar isn't a column any more */}
      <button
        type="button"
        onClick={onMenu}
        aria-label="Abrir menu"
        aria-expanded={menuOpen}
        aria-controls="app-sidebar"
        className="lg:hidden -ml-1 w-10 h-10 rounded-md flex items-center justify-center text-dim-600 hover:bg-dim-100 transition-colors shrink-0"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="font-display text-[17px] font-semibold text-dim-900 flex-1 min-w-0 truncate">{title}</div>

      {/* Live alerts as chips — only where there is room; the bell lists them at every width */}
      <AlertChips alerts={alerts} />

      {/* Live clock */}
      <span className="hidden md:inline text-[12px] text-dim-500 font-mono whitespace-nowrap">{clock}</span>

      <TopbarSearch />

      <AlertsBell alerts={alerts} />
    </header>
  );
}

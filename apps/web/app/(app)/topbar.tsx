"use client";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Bell, Search } from "lucide-react";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard":    "Dashboard",
  "/appointments": "Agendamentos",
  "/patients":     "Pacientes",
  "/billing":      "Faturação",
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

export function Topbar() {
  const pathname = usePathname();
  const baseRoute = "/" + (pathname.split("/").filter(Boolean)[0] ?? "dashboard");
  const title = PAGE_TITLES[pathname] ?? PAGE_TITLES[baseRoute] ?? "Dashboard";

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
    <header className="h-[60px] bg-white border-b border-dim-200 flex items-center px-6 gap-4 shrink-0 shadow-[0_1px_2px_rgba(0,0,0,.05)]">
      <div className="font-display text-[17px] font-semibold text-dim-900 flex-1">{title}</div>

      {/* Alert chips */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[11px] font-medium bg-amber-50 text-amber-600 border border-amber-200/80">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1L11 10H1L6 1Z" stroke="currentColor" strokeWidth="1.3" fill="none"/>
            <path d="M6 5V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <circle cx="6" cy="8.5" r=".5" fill="currentColor"/>
          </svg>
          3 sem-resposta aguardam confirmação
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[11px] font-medium bg-blue-50 text-blue-600 border border-blue-200/80">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M6 5.5V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <circle cx="6" cy="4" r=".5" fill="currentColor"/>
          </svg>
          2 planos renovam esta semana
        </div>
      </div>

      {/* Live clock */}
      <span className="text-[12px] text-dim-500 font-mono whitespace-nowrap">{clock}</span>

      {/* Search */}
      <div className="flex items-center gap-2 bg-dim-100 border border-dim-200 rounded-[10px] px-3 py-1.5 w-64 focus-within:border-brand-500 focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all">
        <Search className="w-3.5 h-3.5 text-dim-400 shrink-0" />
        <input
          type="text"
          placeholder="Pesquisar paciente, consulta…"
          className="border-none bg-transparent text-[13px] text-dim-800 w-full outline-none placeholder:text-dim-400 font-sans"
        />
      </div>

      {/* Notification bell */}
      <button className="w-9 h-9 rounded-md flex items-center justify-center text-dim-500 hover:bg-dim-100 hover:text-dim-700 transition-colors relative">
        <Bell className="w-4 h-4" />
        <span className="w-[7px] h-[7px] bg-red-500 rounded-full border-2 border-white absolute top-1.5 right-1.5" />
      </button>
    </header>
  );
}

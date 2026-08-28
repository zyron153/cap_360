"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Receipt, TrendingDown, TrendingUp, PieChart } from "lucide-react";
import { usePermissions } from "../hooks/use-permissions";
import { FaturasTab } from "./FaturasTab";
import { DespesasTab } from "./DespesasTab";
import { EntradasTab } from "./EntradasTab";
import { ResumoTab } from "./ResumoTab";

const TABS = [
  { key: "resumo",   label: "Overview", icon: PieChart     },
  { key: "entradas", label: "Entradas", icon: TrendingUp   },
  { key: "despesas", label: "Despesas", icon: TrendingDown },
  { key: "faturas",  label: "Faturas",  icon: Receipt      },
] as const;

type TabKey = typeof TABS[number]["key"];

export default function FinanceiroPage() {
  const { isLoading: permLoading, can } = usePermissions();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("resumo");

  useEffect(() => {
    if (!permLoading && !can("billing")) router.replace("/dashboard");
  }, [permLoading, can, router]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-[22px] font-bold text-dim-900">Financeiro</h1>
        <p className="text-[13px] text-dim-500 mt-0.5">Faturação, despesas, entradas e balanço da clínica</p>
      </div>

      <div className="flex gap-5 items-start">
        <nav className="w-48 shrink-0 flex flex-col gap-1">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2.5 w-full text-left px-3.5 py-2.5 rounded-[10px] text-[13px] font-medium transition-colors cursor-pointer ${
                  active ? "bg-brand-700 text-white shadow-[0_1px_2px_rgba(0,0,0,.08)]"
                         : "text-dim-600 hover:bg-dim-100 hover:text-dim-900"
                }`}
              >
                <Icon style={{ width: 15, height: 15 }} className={active ? "opacity-90" : "opacity-60"} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0">
          {activeTab === "faturas"  && <FaturasTab />}
          {activeTab === "despesas" && <DespesasTab />}
          {activeTab === "entradas" && <EntradasTab />}
          {activeTab === "resumo"   && <ResumoTab />}
        </div>
      </div>
    </div>
  );
}

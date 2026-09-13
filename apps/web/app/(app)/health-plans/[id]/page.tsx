"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { HealthPlanDetailBody } from "../HealthPlanDetailBody";

export default function HealthPlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <div className="max-w-3xl flex flex-col gap-5">
      <Link
        href="/health-plans"
        className="inline-flex items-center gap-1.5 text-[12px] text-dim-500 hover:text-dim-800 transition-colors font-medium"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Planos de Saúde
      </Link>
      <HealthPlanDetailBody id={id} />
    </div>
  );
}

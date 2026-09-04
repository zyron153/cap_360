"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, differenceInYears } from "date-fns";
import { pt } from "date-fns/locale";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  MessageSquare,
  Receipt,
  StickyNote,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  Plus,
} from "lucide-react";
import type { Patient, TimelineEvent } from "@cap/types";
import { ClinicalRecordsSection } from "./ClinicalRecordsSection";
import { usePermissions } from "../../hooks/use-permissions";

interface PatientScreenResponse {
  patient: Patient & { healthPlan?: { planNumber: string; product: { name: string } } | null };
  timeline: TimelineEvent[];
}

async function fetchPatientScreen(id: string): Promise<PatientScreenResponse> {
  const res = await fetch(`/api/bff/patient-screen/${id}`);
  if (!res.ok) throw new Error("Paciente não encontrado");
  return res.json();
}

const EVENT_MAP: Record<string, { icon: typeof CalendarDays; bg: string; color: string; line: string }> = {
  appointment:   { icon: CalendarDays,  bg: "bg-brand-50",    color: "text-brand-600",   line: "bg-brand-100"  },
  communication: { icon: MessageSquare, bg: "bg-violet-50",   color: "text-violet-600",  line: "bg-violet-100" },
  invoice:       { icon: Receipt,       bg: "bg-amber-50",    color: "text-amber-600",   line: "bg-amber-100"  },
  note:          { icon: StickyNote,    bg: "bg-dim-100",     color: "text-dim-500",     line: "bg-dim-100"    },
};

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

export default function PatientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading } = useQuery({
    queryKey: ["patient-screen", id],
    queryFn: () => fetchPatientScreen(id),
    staleTime: 60_000,
  });
  const { me, isAdmin } = usePermissions();
  // Matches the API's own @Roles("admin", "doctor") gate on every clinical-records route — showing
  // this to a role that would just get a 403 back isn't useful.
  const canSeeClinicalRecords = isAdmin || me?.role === "doctor";

  const patient = data?.patient;
  const timeline = data?.timeline;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5 animate-pulse">
        <div className="w-24 h-3 bg-dim-100 rounded" />
        <div className="grid grid-cols-3 gap-5">
          <div className="col-span-1 bg-dim-100 rounded-[16px] h-72" />
          <div className="col-span-2 bg-dim-100 rounded-[16px] h-72" />
        </div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="py-16 text-center">
        <p className="text-[13px] font-medium text-red-600">Paciente não encontrado.</p>
      </div>
    );
  }

  const age = differenceInYears(new Date(), new Date(patient.dateOfBirth));
  const genderLabels: Record<string, string> = { male: "Masculino", female: "Feminino", other: "Outro" };

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/patients"
        className="inline-flex items-center gap-1.5 text-[12px] text-dim-500 hover:text-dim-800 transition-colors font-medium"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Pacientes
      </Link>

      <div className="grid grid-cols-3 gap-5 items-start">
        {/* Profile card */}
        <div className="col-span-1 flex flex-col gap-4">
          <div className={CARD}>
            {/* Avatar header */}
            <div className="bg-gradient-to-br from-brand-50 via-brand-100/60 to-brand-100 px-6 py-8 text-center border-b border-brand-100">
              <div className="w-16 h-16 rounded-[20px] bg-brand-700 flex items-center justify-center text-white text-[22px] font-bold mx-auto shadow-[0_4px_12px_rgba(15,145,145,.3)]">
                {patient.fullName?.[0]?.toUpperCase()}
              </div>
              <h2 className="mt-3 font-display font-bold text-dim-900 text-[17px] leading-tight">{patient.fullName}</h2>
              <p className="text-[12px] text-dim-500 mt-0.5">{age} anos · {genderLabels[patient.gender] ?? patient.gender}</p>
              {patient.healthPlan ? (
                <span className="inline-block mt-2 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                  {patient.healthPlan.product.name}
                </span>
              ) : patient.healthPlanId ? (
                <span className="inline-block mt-2 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                  Plano Ativo
                </span>
              ) : null}
            </div>

            {/* Details */}
            <div className="px-5 py-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Phone className="w-3.5 h-3.5 text-dim-400 shrink-0" />
                <span className="text-[13px] text-dim-700 font-mono">{patient.phone}</span>
              </div>
              {patient.email && (
                <div className="flex items-center gap-3">
                  <Mail className="w-3.5 h-3.5 text-dim-400 shrink-0" />
                  <span className="text-[12px] text-dim-700 truncate">{patient.email}</span>
                </div>
              )}
              {patient.address && (
                <div className="flex items-center gap-3">
                  <MapPin className="w-3.5 h-3.5 text-dim-400 shrink-0" />
                  <span className="text-[12px] text-dim-700">{patient.address}</span>
                </div>
              )}
              {patient.nif && (
                <div className="flex items-center gap-3">
                  <CreditCard className="w-3.5 h-3.5 text-dim-400 shrink-0" />
                  <span className="text-[12px] text-dim-600 font-mono">NIF: {patient.nif}</span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <CalendarDays className="w-3.5 h-3.5 text-dim-400 shrink-0" />
                <span className="text-[12px] text-dim-600">
                  {format(new Date(patient.dateOfBirth), "d 'de' MMMM yyyy", { locale: pt })}
                </span>
              </div>
            </div>

            {/* Action */}
            <div className="px-5 pb-5 flex flex-col gap-2">
              <Link
                href={`/appointments/new?patientId=${patient.id}`}
                className="flex items-center justify-center gap-2 w-full bg-brand-700 hover:bg-brand-800 text-white text-[13px] font-semibold px-4 py-2.5 rounded-[10px] transition-colors shadow-[0_1px_2px_rgba(0,0,0,.08)]"
              >
                <Plus className="w-4 h-4" />
                Marcar Consulta
              </Link>
              <Link
                href={`/patients/${patient.id}/edit`}
                className="flex items-center justify-center gap-2 w-full border border-dim-200 hover:border-dim-300 hover:bg-dim-50 text-dim-700 text-[13px] font-semibold px-4 py-2.5 rounded-[10px] transition-colors"
              >
                Editar dados
              </Link>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className={`col-span-2 ${CARD}`}>
          <div className="px-6 py-4 border-b border-dim-100 flex items-center justify-between">
            <h3 className="font-display font-semibold text-[15px] text-dim-900">Histórico</h3>
            <span className="font-mono text-[11px] text-dim-400">{timeline?.length ?? 0} eventos</span>
          </div>

          <div className="px-6 py-5">
            {!timeline || timeline.length === 0 ? (
              <div className="py-10 text-center">
                <div className="w-10 h-10 bg-dim-100 rounded-[12px] flex items-center justify-center mx-auto mb-3">
                  <CalendarDays className="w-5 h-5 text-dim-400" />
                </div>
                <p className="text-[13px] text-dim-500">Sem histórico disponível</p>
              </div>
            ) : (
              <div className="flex flex-col gap-0">
                {timeline.map((event, index) => {
                  const map = EVENT_MAP[event.type] ?? EVENT_MAP.note;
                  const Icon = map.icon;
                  const isLast = index === timeline.length - 1;
                  return (
                    <div key={event.id} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className={`p-2 rounded-[10px] ${map.bg} shrink-0`}>
                          <Icon className={`w-3.5 h-3.5 ${map.color}`} />
                        </div>
                        {!isLast && (
                          <div className={`w-px flex-1 ${map.line} mt-1 mb-1 min-h-[1.5rem]`} />
                        )}
                      </div>
                      <div className="pb-4">
                        <p className="text-[13px] font-semibold text-dim-900 leading-tight">{event.title}</p>
                        {event.description && (
                          <p className="text-[12px] text-dim-500 mt-0.5">{event.description}</p>
                        )}
                        <p className="font-mono text-[10px] text-dim-400 mt-1">
                          {format(new Date(event.date), "d MMM yyyy, HH:mm", { locale: pt })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {canSeeClinicalRecords && <ClinicalRecordsSection patientId={id} />}
    </div>
  );
}

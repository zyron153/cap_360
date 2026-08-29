"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import Link from "next/link";
import { ArrowLeft, CalendarPlus, Clock } from "lucide-react";
import { CreateAppointmentSchema, type CreateAppointmentDto, type TimeSlot } from "@cap/types";
import { useMessage } from "../../../../components/ui/message-handler";
import { validateScheduledAt, isWeekday } from "../../../../lib/validate-schedule";

async function fetchAvailability(serviceId: string, staffId: string, date: string): Promise<TimeSlot[]> {
  const params = new URLSearchParams({ serviceId, staffId, date });
  const res = await fetch(`/api/appointments/availability?${params}`);
  if (!res.ok) return [];
  return res.json();
}

async function createAppointment(data: CreateAppointmentDto) {
  const res = await fetch("/api/appointments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message ?? "Erro ao criar marcação");
  }
  return res.json();
}

function Field({ label, required, error, children }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-dim-700 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-[11px] text-red-600 mt-1.5">{error}</p>}
    </div>
  );
}

const inputCls =
  "w-full border border-dim-200 rounded-[10px] px-3.5 py-2.5 text-[13px] text-dim-900 placeholder:text-dim-400 bg-white focus:outline-none focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(19,163,163,.12)] transition-all shadow-[0_1px_2px_rgba(0,0,0,.05)] hover:border-dim-300 font-sans";

const CARD = "bg-white rounded-[16px] border border-dim-200 shadow-[0_1px_4px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.03)] overflow-hidden";

export default function NewAppointmentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillPatientId = searchParams.get("patientId") ?? "";

  const { addMessage } = useMessage();
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [selectedStaff, setSelectedStaff] = useState("");
  const [selectedService, setSelectedService] = useState("");
  const [selectedSlot, setSelectedSlot] = useState("");
  // One key per page visit — stable across retries of the same submit (double-click, a client
  // timeout retry); navigating away on success and back in gets a fresh mount and a fresh key.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const { data: slots } = useQuery({
    queryKey: ["availability", selectedService, selectedStaff, selectedDate],
    queryFn: () => fetchAvailability(selectedService, selectedStaff, selectedDate),
    enabled: !!(selectedService && selectedStaff && selectedDate),
  });

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<CreateAppointmentDto>({
    resolver: zodResolver(CreateAppointmentSchema),
    defaultValues: { patientId: prefillPatientId, source: "web" },
  });

  const mutation = useMutation({
    mutationFn: createAppointment,
    onSuccess: () => {
      addMessage("Success", "Marcação confirmada com sucesso!");
      router.push("/appointments");
    },
    onError: (err: Error) => {
      addMessage("Error", err.message);
    },
  });

  function handleDateChange(dateStr: string) {
    if (!isWeekday(dateStr)) {
      addMessage("Warning", "Agendamentos apenas de segunda a sábado. Domingo não está disponível.");
      return;
    }
    setSelectedDate(dateStr);
    setSelectedSlot("");
  }

  function onSubmit(data: CreateAppointmentDto) {
    const scheduleError = validateScheduledAt(data.scheduledAt);
    if (scheduleError) {
      addMessage("Error", scheduleError);
      return;
    }
    mutation.mutate({ ...data, idempotencyKey });
  }

  const availableSlots = slots?.filter((s) => s.available) ?? [];

  return (
    <div className="max-w-xl flex flex-col gap-5">
      <Link
        href="/appointments"
        className="inline-flex items-center gap-1.5 text-[12px] text-dim-500 hover:text-dim-800 transition-colors font-medium"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Marcações
      </Link>

      <div className="flex items-center gap-3.5">
        <div className="w-10 h-10 bg-brand-100 rounded-[12px] flex items-center justify-center shrink-0">
          <CalendarPlus className="w-5 h-5 text-brand-700" />
        </div>
        <div>
          <h1 className="font-display text-[22px] font-bold text-dim-900">Nova Marcação</h1>
          <p className="text-[13px] text-dim-500">Agende uma nova consulta</p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className={CARD}
      >
        <div className="px-6 py-4 border-b border-dim-100">
          <h2 className="font-display text-[14px] font-semibold text-dim-900">Dados da Consulta</h2>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          <Field label="ID do Paciente" required error={errors.patientId?.message}>
            <input
              {...register("patientId")}
              placeholder="UUID do paciente"
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="ID do Médico" required>
              <input
                {...register("staffId")}
                placeholder="UUID"
                onChange={(e) => { register("staffId").onChange(e); setSelectedStaff(e.target.value); }}
                className={inputCls}
              />
            </Field>
            <Field label="ID do Serviço" required>
              <input
                {...register("serviceId")}
                placeholder="UUID"
                onChange={(e) => { register("serviceId").onChange(e); setSelectedService(e.target.value); }}
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Data" required>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className={inputCls}
            />
          </Field>

          {availableSlots.length > 0 && (
            <div>
              <label className="block text-[12px] font-semibold text-dim-700 mb-2">
                Horário Disponível <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-4 gap-2">
                {availableSlots.map((slot) => {
                  const isSelected = selectedSlot === slot.start;
                  return (
                    <button
                      key={slot.start}
                      type="button"
                      onClick={() => {
                        setSelectedSlot(slot.start);
                        setValue("scheduledAt", slot.start, { shouldValidate: true });
                      }}
                      className={`flex items-center justify-center gap-1.5 border rounded-[10px] py-2 text-[12px] font-semibold transition-all cursor-pointer ${
                        isSelected
                          ? "bg-brand-700 border-brand-700 text-white shadow-[0_1px_4px_rgba(15,145,145,.3)]"
                          : "border-dim-200 text-dim-700 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700"
                      }`}
                    >
                      <Clock className="w-3 h-3" />
                      {format(new Date(slot.start), "HH:mm")}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <Field label="Notas">
            <textarea
              {...register("notes")}
              rows={2}
              placeholder="Observações adicionais…"
              className={inputCls}
            />
          </Field>
        </div>

        <div className="px-6 py-4 border-t border-dim-100 bg-dim-50/60 rounded-b-[16px] flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="bg-brand-700 hover:bg-brand-800 text-white font-semibold px-5 py-2.5 rounded-[10px] text-[13px] disabled:opacity-60 transition-colors shadow-[0_1px_2px_rgba(0,0,0,.08)] cursor-pointer"
            >
              {mutation.isPending ? "A guardar…" : "Confirmar Marcação"}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="border border-dim-200 bg-white hover:bg-dim-50 text-dim-700 font-medium px-5 py-2.5 rounded-[10px] text-[13px] transition-colors cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

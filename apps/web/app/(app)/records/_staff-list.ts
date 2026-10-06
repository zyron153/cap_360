"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "./_note-shared";

export type StaffOption = { id: string; fullName: string; role: string };

/**
 * The active staff (GET /staff — open to admin, doctor, nurse and receptionist), for naming people: the clinician
 * a referral is addressed to, the author behind a note in the access report. One key, so the pages share the cache.
 */
export function useStaffList(enabled: boolean) {
  return useQuery({
    queryKey: ["staff", "list"],
    queryFn: () => fetchJson<StaffOption[]>("/api/staff"),
    staleTime: 300_000,
    enabled,
  });
}

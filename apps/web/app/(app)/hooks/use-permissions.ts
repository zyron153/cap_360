import { useQuery } from "@tanstack/react-query";
import {
  defaultPerms,
  type AccessControl, type PageKey, type RolePerms,
} from "../../../lib/access-control";

type StaffMe = { id: string; fullName: string; role: string; email: string };

function getPreviewRole(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("cms:preview-role");
}

export function usePermissions() {
  const { data: me, isLoading: meLoading } = useQuery<StaffMe>({
    queryKey: ["staff-me"],
    queryFn: () => fetch("/api/staff/me").then(r => r.json()),
    staleTime: 300_000,
  });

  const { data: settings, isLoading: settingsLoading } = useQuery<Record<string, unknown>>({
    queryKey: ["settings-all"],
    queryFn: () => fetch("/api/settings").then(r => r.json()),
    staleTime: 60_000,
  });

  const previewRole = getPreviewRole();
  const role = previewRole ?? me?.role ?? "admin";
  const isAdmin = role === "admin";
  const ac = settings?.access_control as AccessControl | undefined;
  const perms: RolePerms = isAdmin ? defaultPerms("admin") : (ac?.[role] ?? defaultPerms(role));
  const isLoading = meLoading || settingsLoading;

  return {
    isLoading,
    role,
    me,
    can: (page: PageKey): boolean => isAdmin || (perms[page]?.view ?? false),
    canDo: (page: PageKey, action: "create" | "edit" | "delete"): boolean =>
      isAdmin || (perms[page]?.[action] ?? false),
  };
}

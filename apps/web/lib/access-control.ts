// Shared access-control constants — used by usePermissions hook, sidebar, and settings AccessTab

export const ACCESS_PAGE_KEYS = [
  "dashboard", "appointments", "patients", "health_plans", "exams",
  "billing", "records", "staff", "visits", "analytics", "settings", "params",
] as const;

export type PageKey = typeof ACCESS_PAGE_KEYS[number];
export type PagePerms = { view: boolean; create: boolean; edit: boolean; delete: boolean };
export type RolePerms = Record<PageKey, PagePerms>;
export type AccessControl = Record<string, RolePerms>;

const FULL: PagePerms = { view: true,  create: true,  edit: true,  delete: true  };
const NONE: PagePerms = { view: false, create: false, edit: false, delete: false };

function make(blocked: PageKey[]): RolePerms {
  return Object.fromEntries(
    ACCESS_PAGE_KEYS.map(k => [k, blocked.includes(k) ? NONE : FULL])
  ) as RolePerms;
}

export function defaultPerms(role: string): RolePerms {
  switch (role) {
    case "admin":        return make([]);
    case "doctor":       return make(["billing", "staff", "settings", "params"]);
    case "nurse":        return make(["health_plans", "billing", "staff", "settings", "params"]);
    case "receptionist": return make(["exams", "records", "staff", "visits", "analytics", "settings", "params"]);
    case "lab_tech":     return make(["appointments", "health_plans", "billing", "records", "staff", "visits", "analytics", "settings", "params"]);
    default:             return make([...ACCESS_PAGE_KEYS]);
  }
}

// Maps sidebar href → ACCESS_PAGE_KEYS key for visibility filtering
export const HREF_TO_PAGE: Record<string, PageKey> = {
  "/dashboard":      "dashboard",
  "/appointments":   "appointments",
  "/patients":       "patients",
  "/health-plans":   "health_plans",
  "/exams":          "exams",
  "/billing":        "billing",
  "/records":        "records",
  "/staff":          "staff",
  "/visits":         "visits",
  "/analytics":      "analytics",
  "/settings":       "settings",
  "/access":         "settings",   // access management requires settings permission
  "/parametrizacoes":"params",
};

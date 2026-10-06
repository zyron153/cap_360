/** `metadata.diff.after.basis` of the audit_log row for a read that returned another author's notes under the
 * "patient in treatment today" exception (M7 §3.1). Written by ClinicalRecordsService, filtered on by the admin's
 * cross-author access log — one constant so the mark and the report can't drift apart. */
export const CROSS_AUTHOR_READ_BASIS = "patient in treatment today";

/** Roles an internal referral may be addressed to: the ones that can open the clinical module at all (the
 * controllers are `@Roles("admin", "doctor")`). A nurse or receptionist as target could neither see nor act on it. */
export const REFERRAL_TARGET_ROLES = ["doctor", "admin"] as const;

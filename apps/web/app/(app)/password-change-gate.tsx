"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

/** Sends a user who still has an admin-issued temporary password to /change-password, wherever
 * they land inside the app (a bookmark, a typed URL, the back button). The API enforces the same
 * rule on its own — SessionAuthGuard answers 403 PASSWORD_CHANGE_REQUIRED to everything but the
 * change-password route — this just spares them a screen full of failed requests. Renders nothing.
 *
 * Shares the ["staff-me"] query (and its cache) with usePermissions. */
export function PasswordChangeGate() {
  const router = useRouter();
  const { data: me } = useQuery<{ mustChangePassword?: boolean }>({
    queryKey: ["staff-me"],
    queryFn: () => fetch("/api/staff/me").then((r) => r.json()),
    staleTime: 300_000,
  });

  const mustChange = me?.mustChangePassword === true;
  useEffect(() => {
    if (mustChange) router.replace("/change-password");
  }, [mustChange, router]);

  return null;
}

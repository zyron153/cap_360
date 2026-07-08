"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { usePermissions } from "../hooks/use-permissions";

// ponytail: skip SSR — page is auth-gated, needs no SEO, and has an SSR-suspension quirk
const AccessPageContent = dynamic(() => import("./AccessPageContent"), { ssr: false });

export default function AccessPage() {
  const { isLoading, can } = usePermissions();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !can("settings")) router.replace("/dashboard");
  }, [isLoading, can, router]);

  if (isLoading || !can("settings")) return null;
  return <AccessPageContent />;
}

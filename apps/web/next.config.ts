import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@cap/types",
    "@fullcalendar/core",
    "@fullcalendar/react",
    "@fullcalendar/daygrid",
    "@fullcalendar/timegrid",
    "@fullcalendar/interaction",
  ],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001"}/v1/:path*`,
      },
    ];
  },
};

export default withSentryConfig(
  withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" })(nextConfig),
  // Only uploads source maps if org/project/authToken are configured later — a no-op build-time
  // wrapper otherwise. silent avoids CLI log noise while that's unconfigured.
  { silent: true }
);

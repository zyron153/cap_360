import type { Config } from "tailwindcss";
import sharedPreset from "@cap/config/tailwind";

const config: Config = {
  presets: [sharedPreset],
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:    ["var(--font-work-sans)", '"Work Sans"', "system-ui", "sans-serif"],
        display: ["var(--font-bricolage)", '"Bricolage Grotesque"', "system-ui", "sans-serif"],
        mono:    ["var(--font-ibm-mono)", '"IBM Plex Mono"', "Cascadia Code", "monospace"],
      },
      colors: {
        /* CSS-variable semantic tokens */
        border:     "hsl(var(--border))",
        input:      "hsl(var(--input))",
        ring:       "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT:    "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT:    "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT:    "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        card: {
          DEFAULT:    "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        /* Dark sidebar palette */
        dim: {
          50:  "#F8FAFB",
          100: "#F1F2F8",
          200: "#E8E8F0",
          300: "#D1D1E0",
          400: "#B0B0C4",
          500: "#8E8EA8",
          600: "#6B6B8A",
          700: "#4A4A6A",
          800: "#2D2D44",
          900: "#1A1A2E",
          950: "#0D1117",
        },
      },
    },
  },
};

export default config;

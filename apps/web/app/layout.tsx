import type { Metadata } from "next";
import { Bricolage_Grotesque, Work_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { WebVitals } from "./web-vitals";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const workSans = Work_Sans({
  subsets: ["latin"],
  variable: "--font-work-sans",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CAP 360",
  description: "Sistema de gestão da CAP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt" className={`${bricolage.variable} ${workSans.variable} ${ibmPlexMono.variable}`}>
      <body>
        <Providers>
          <WebVitals />
          {children}
        </Providers>
      </body>
    </html>
  );
}

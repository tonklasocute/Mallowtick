import type { Metadata, Viewport } from "next";
import { Mitr, Nunito } from "next/font/google";
import type { ReactNode } from "react";

import "@/styles/globals.css";

import { BottomNav } from "@/components/layout/bottom-nav";
import { ServiceWorkerRegistrar } from "@/components/layout/service-worker-registrar";
import { SideNav } from "@/components/layout/side-nav";
import { BRAND } from "@/lib/brand";

import { Providers } from "./providers";

// Self-hosted at build time, so they also work offline. Nunito has no Thai glyphs;
// Thai text falls back to Mitr (see --font-sans in globals.css).
const nunito = Nunito({ subsets: ["latin"], variable: "--ff-nunito", display: "swap" });
const mitr = Mitr({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--ff-mitr",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description: BRAND.description,
  applicationName: BRAND.name,
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "default" },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: BRAND.themeColor,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className={`${nunito.variable} ${mitr.variable}`}>
      <body>
        <Providers>
          <SideNav />
          <div className="min-h-dvh lg:pl-(--sidebar-width)">{children}</div>
          <BottomNav />
        </Providers>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARCHIVE RIOT // MOONWITNESS MEMORY",
  description: "The chaotic intelligence vault. Local-first AI archive and knowledge extraction.",
  applicationName: "MoonWitness Memory",
};

export const viewport: Viewport = {
  themeColor: "#090a09",
  colorScheme: "dark light",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script
          id="archive-riot-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: 'try { const saved = localStorage.getItem("mw-memory-theme"); document.documentElement.dataset.theme = saved === "light" ? "light" : "dark"; } catch { document.documentElement.dataset.theme = "dark"; }',
          }}
        />
        {children}
      </body>
    </html>
  );
}

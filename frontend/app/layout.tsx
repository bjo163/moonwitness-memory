import type { Metadata, Viewport } from "next";
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
      <body>{children}</body>
    </html>
  );
}

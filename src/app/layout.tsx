import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppShell } from "@/components/nav/AppShell";
import { DeployBanner } from "@/components/nav/DeployBanner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hyked — Trails, Maps & Adventure",
  description:
    "Your unified outdoor operating system for trail discovery, maps, and adventure planning.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full font-sans text-[var(--foreground)] antialiased">
        <div hidden dangerouslySetInnerHTML={{ __html: "<!-- THESIS: Fieldbook makes finding a trail, preparing a pack and recording an outing one task. OWN-WORLD: mineral #f6f7f4, evergreen #173f35 navigation, Inter, ruled lists, green actions, 8px controls. STORY: real trail sections lead to personal routes and gear, then recording. FIRST VIEWPORT: 240px rail; 48px workspace inset; trail search, source rows and planning sidebar. FORM: approved-fieldbook-figma; comp-led Operate. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance -->" }} />
        <AppShell notice={<DeployBanner />}>{children}</AppShell>
      </body>
    </html>
  );
}

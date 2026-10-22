import type { Metadata } from "next";
import { DM_Sans, Playfair_Display, JetBrains_Mono } from "next/font/google";
import Image from "next/image";
import mountainNight from "@/assets/mountain-night.jpg";
import { AppShell } from "@/components/nav/AppShell";
import "./globals.css";

const bodyFont = DM_Sans({
  variable: "--font-inter",
  subsets: ["latin"],
});
const displayFont = Playfair_Display({ variable: "--font-playfair", subsets: ["latin"] });
const dataFont = JetBrains_Mono({ variable: "--font-data", subsets: ["latin"] });

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
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable} ${dataFont.variable} h-full`}>
      <body className="min-h-full font-sans text-[var(--foreground)] antialiased">
        <Image src={mountainNight} alt="" aria-hidden="true" className="mountain-backdrop" priority sizes="100vw" />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

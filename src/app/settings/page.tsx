import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/SettingsView";

export const metadata: Metadata = {
  title: "Settings & appearance — Hyked",
  description:
    "Customize theme, accent colors, typography, units and 3D VFR/IFR aeronautical map defaults.",
};

export default function SettingsPage() {
  return <SettingsView />;
}

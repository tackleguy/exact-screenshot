"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { NavBar } from "./NavBar";
import { BottomNav } from "./BottomNav";
import { AccountSync } from "./AccountSync";
import { AccessibilityAudit } from "@/components/dev/AccessibilityAudit";
import { RecordingPill } from "@/components/gps/RecordingPill";

export function AppShell({ children, notice }: { children: ReactNode; notice?: ReactNode }) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const recording = pathname.startsWith("/record/live");
  const standalone = recording || pathname.startsWith("/login") || pathname.startsWith("/signup");
  const fullMap = pathname === "/explore/trails";

  return (
    <div
      className={`app-shell${sidebarCollapsed ? " app-shell--collapsed" : ""}${standalone ? " app-shell--standalone" : ""}${recording ? " app-shell--recording" : ""}${fullMap ? " app-shell--map" : ""}`}
    >
      <AccountSync />
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {!standalone && (
        <NavBar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} />
      )}
      <div className="app-content">
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        {!standalone && !fullMap && notice}
        {process.env.NODE_ENV === "development" && <AccessibilityAudit />}
      </div>
      <RecordingPill />
      {!standalone && <BottomNav />}
    </div>
  );
}

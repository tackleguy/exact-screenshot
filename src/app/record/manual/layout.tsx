import type { Metadata } from "next";

export const metadata: Metadata = { title: "Log an activity — HikeSync", description: "Enter a hike, run, ride or ski day without GPS." };

export default function ManualLogLayout({ children }: { children: React.ReactNode }) {
  return children;
}

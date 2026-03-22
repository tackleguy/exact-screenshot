import type { ReactNode } from 'react';
import { MountainBackground } from '@/components/layout/MountainBackground';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <MountainBackground />
      <div className="relative z-10 w-full max-w-md animate-fade-up">
        <div className="bg-ridge/60 backdrop-blur-xl border border-border/40 rounded-2xl p-8 shadow-2xl">
          <h1 className="font-display text-3xl font-bold text-center mb-1 tracking-tight">TrailPack</h1>
          <p className="text-granite text-sm text-center mb-8">Gear management for ultralight backpackers</p>
          {children}
        </div>
      </div>
    </div>
  );
}

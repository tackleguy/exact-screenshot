import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = { title: "Sign in — HikeSync" };

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-md items-center px-4 py-12">
      <div className="surface-card w-full p-8">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] bg-accent text-xl font-bold text-forest">
          ⛰
        </div>
        <h1 className="font-display text-2xl font-semibold text-cream">Welcome back</h1>
        <p className="mb-6 mt-1 text-sm text-mist">
          Sign in to record GPS tracks and track your adventures.
        </p>
        <LoginForm />
      </div>
    </div>
  );
}

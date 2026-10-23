import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/SignupForm";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { nextFromLocation } from "@/lib/account/auth";
import { NavIcon } from "@/components/nav/NavIcon";

export const metadata: Metadata = { title: "Create an account — Hyked" };

export default function SignupPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-md items-center px-4 py-12">
      <div className="surface-card w-full p-8">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] bg-accent text-white">
          <NavIcon name="mountain" />
        </div>
        <h1 className="font-display text-2xl font-semibold text-cream">Join Hyked</h1>
        <p className="mb-6 mt-1 text-sm text-mist">
          Save trails, record GPS tracks and get trails for the way you get outside.
        </p>
        <GoogleButton next={() => nextFromLocation("/explore/trails")} label="Sign up with Google" />
        <p className="my-4 flex items-center gap-3 text-xs uppercase tracking-wide text-mist" aria-hidden="true"><span className="h-px flex-1 bg-[var(--border)]" />or with email<span className="h-px flex-1 bg-[var(--border)]" /></p>
        <SignupForm />
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { TRAIL_SECTIONS, type TrailSectionKey } from "@/lib/trail-catalog/activity";
import { storeSection } from "@/lib/preferred-section";
import { SectionIcon } from "@/components/explore/SectionIcon";

const inputClass =
  "w-full rounded-[var(--radius-lg)] border border-[var(--control-border)] bg-surface-muted px-3 py-2.5 text-base text-cream placeholder:text-mist focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-4";

export function SignupForm() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [section, setSection] = useState<TrailSectionKey>("foot");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    storeSection(section);

    const supabase = createClient();
    if (!supabase) {
      setError("Sign-in is unavailable right now. You can still explore trails and plan trips as a guest; your plans are saved on this device.");
      setLoading(false);
      return;
    }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName, last_name: lastName, preferred_section: section },
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/map");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="firstName" className="mb-1 block text-sm font-medium text-sage">
            First name
          </label>
          <input
            id="firstName"
            autoComplete="given-name"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="lastName" className="mb-1 block text-sm font-medium text-sage">
            Last name
          </label>
          <input
            id="lastName"
            autoComplete="family-name"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-sage">
          Email
        </label>
        <input
          id="email"
          autoComplete="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-sage">
          Password
        </label>
        <input
          id="password"
          autoComplete="new-password"
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </div>
      <fieldset className="section-picker">
        <legend className="mb-1 block text-sm font-medium text-sage">What do you mostly do on trails?</legend>
        <p className="mb-3 text-sm text-mist">Hyked opens the map and search on this. You can switch any time.</p>
        <div className="section-picker-grid">
          {TRAIL_SECTIONS.map((s) => (
            <label key={s.key} className="section-option">
              <input type="radio" name="section" value={s.key} checked={section === s.key} onChange={() => setSection(s.key)} />
              <SectionIcon section={s.key} />
              <span className="section-option-label">{s.label}</span>
              <span className="section-option-blurb">{s.blurb}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
        {loading ? "Creating account..." : "Create account"}
      </button>
      <p className="text-center text-sm text-mist">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}

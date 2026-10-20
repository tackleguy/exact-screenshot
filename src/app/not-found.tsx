import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Page not found — HikeSync", robots: { index: false } };

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-6 py-24 text-center">
      <p className="text-sm font-medium text-emerald-700">404</p>
      <h1 className="mt-2 text-3xl font-bold text-stone-900">We couldn’t find that page.</h1>
      <p className="mt-4 text-stone-600">
        The link may be old, or the trail may have been merged into another record. Search the catalog to find it.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/explore/trails" className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800">
          Explore trails
        </Link>
        <Link href="/plan" className="rounded-xl border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-800 hover:bg-stone-50">
          Plan a trip
        </Link>
      </div>
    </div>
  );
}

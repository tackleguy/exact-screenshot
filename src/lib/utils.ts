import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Difficulty } from "@/lib/types";

/** Joins class names and lets later Tailwind classes win over earlier ones (the shadcn/ui helper). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function difficultyColor(difficulty: Difficulty | string) {
  return clsx({
    "bg-emerald-100 text-emerald-800": difficulty === "easy",
    "bg-amber-100 text-amber-800": difficulty === "moderate",
    "bg-rose-100 text-rose-800": difficulty === "hard",
    "bg-stone-800 text-stone-100": difficulty === "expert",
  });
}

export function formatRating(rating: number) {
  return rating > 0 ? rating.toFixed(1) : "New";
}

export function formatLocation(state: string, country: string) {
  return `${state}, ${country}`;
}

export function stars(rating: number) {
  return "★".repeat(Math.round(rating)) + "☆".repeat(5 - Math.round(rating));
}

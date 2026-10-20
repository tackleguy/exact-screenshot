/** Town service categories, shared by the server (towns.ts) and the browser (no Node imports here). */
export const SERVICE_LABELS = {
  grocery: "Groceries",
  outfitter: "Outdoor gear",
  post: "Post office",
  lodging: "Lodging",
  campground: "Campground",
  laundry: "Laundry",
  fuel: "Fuel station",
  food: "Restaurants & cafés",
  pharmacy: "Pharmacy",
  medical: "Medical care",
  money: "ATM or bank",
  library: "Library (Wi-Fi)",
} as const;
export type ServiceKey = keyof typeof SERVICE_LABELS;

export interface TownServices {
  counts: Partial<Record<ServiceKey, number>>;
  /** Up to three named places per service. */
  places: Partial<Record<ServiceKey, { name: string; latitude: number; longitude: number }[]>>;
  radiusKm: number;
}

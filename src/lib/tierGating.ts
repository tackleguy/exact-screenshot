export type SubscriptionTier = 'base_camp' | 'summit' | 'thru_hiker';

export const TIER_LIMITS = {
  base_camp: {
    label: 'Base Camp',
    packingListsPerMonth: 0,
    aiShoppingListsPerMonth: 0,
    canDownload: false,
    canUseGearLocker: false,
    canUseShoppingList: false,
    canUsePackingLists: false,
    fullWeightCharts: false,
    canUnitToggle: false,
  },
  summit: {
    label: 'Summit',
    packingListsPerMonth: 5,
    aiShoppingListsPerMonth: 3,
    canDownload: false,
    canUseGearLocker: true,
    canUseShoppingList: true,
    canUsePackingLists: true,
    fullWeightCharts: true,
    canUnitToggle: true,
  },
  thru_hiker: {
    label: 'Thru-Hiker',
    packingListsPerMonth: Infinity,
    aiShoppingListsPerMonth: Infinity,
    canDownload: true,
    canUseGearLocker: true,
    canUseShoppingList: true,
    canUsePackingLists: true,
    fullWeightCharts: true,
    canUnitToggle: true,
  },
} as const;

export function getTierLimits(tier: string | undefined) {
  return TIER_LIMITS[(tier as SubscriptionTier) || 'base_camp'];
}

export function getUpgradeTier(currentTier: string | undefined): { name: string; id: SubscriptionTier } {
  const tier = (currentTier || 'base_camp') as SubscriptionTier;
  if (tier === 'base_camp') return { name: 'Summit', id: 'summit' };
  return { name: 'Thru-Hiker', id: 'thru_hiker' };
}

/** Returns the start of the current billing month (1st of current month) */
export function getCurrentMonthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

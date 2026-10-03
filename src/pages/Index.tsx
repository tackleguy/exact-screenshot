import { useState } from 'react';
import { type TabId, type WeightUnit } from '@/lib/data';
import { MountainBackground } from '@/components/layout/MountainBackground';
import { AppHeader } from '@/components/layout/AppHeader';
import { GearLocker } from '@/components/gear/GearLocker';
import { WeightAnalysis } from '@/components/weight/WeightAnalysis';
import { PackingList } from '@/components/packing/PackingList';
import { ShoppingList } from '@/components/shopping/ShoppingList';
import { TrailDatabase } from '@/components/trails/TrailDatabase';
import { UpgradePrompt } from '@/components/shared/UpgradePrompt';
import { useGear } from '@/hooks/useGear';
import { useShoppingItems } from '@/hooks/useShoppingItems';
import { useAuth } from '@/contexts/AuthContext';
import { getTierLimits } from '@/lib/tierGating';

const Index = () => {
  const [activeTab, setActiveTab] = useState<TabId>('gear');
  const [unit, setUnit] = useState<WeightUnit>('oz');
  const { gear, loading: gearLoading, addGear, editGear, deleteGear } = useGear();
  const { items: shopItems, loading: shopLoading, addItem: addShop, toggleItem: toggleShop, deleteItem: deleteShop } = useShoppingItems();
  const { profile } = useAuth();
  const limits = getTierLimits(profile?.tier);

  if (gearLoading || shopLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-moss border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <MountainBackground />
      <div className="relative z-10">
        <AppHeader activeTab={activeTab} onTabChange={setActiveTab} />
        <main className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
          {activeTab === 'gear' && (
            limits.canUseGearLocker
              ? <GearLocker gear={gear} unit={unit} onUnitChange={setUnit} onAdd={addGear} onEdit={editGear} onDelete={deleteGear} />
              : <UpgradePrompt feature="Gear Locker" requiredTier="Summit" message="Manage your gear inventory, track weights, and organize your kit. Upgrade to Summit to unlock the Gear Locker." />
          )}
          {activeTab === 'weight' && (
            limits.fullWeightCharts
              ? <WeightAnalysis gear={gear} unit={unit} />
              : <UpgradePrompt feature="Weight Analysis" requiredTier="Summit" message="Visualize your pack weight with detailed charts and breakdowns. Upgrade to Summit to unlock full Weight Analysis." />
          )}
          {activeTab === 'packing' && (
            limits.canUsePackingLists
              ? <PackingList gear={gear} unit={unit} />
              : <UpgradePrompt feature="Packing Lists" requiredTier="Summit" message="Build trip-specific checklists from your gear locker. Upgrade to Summit to create packing lists." />
          )}
          {activeTab === 'shopping' && (
            limits.canUseShoppingList
              ? <ShoppingList items={shopItems} onToggle={toggleShop} onDelete={deleteShop} onAdd={addShop} />
              : <UpgradePrompt feature="Shopping List" requiredTier="Summit" message="Track gear you need to buy with prices and priorities. Upgrade to Summit to unlock the Shopping List." />
          )}
          {activeTab === 'trails' && <TrailDatabase />}
        </main>
      </div>
    </div>
  );
};

export default Index;

import { useState } from 'react';
import { type TabId, type WeightUnit } from '@/lib/data';
import { MountainBackground } from '@/components/layout/MountainBackground';
import { AppHeader } from '@/components/layout/AppHeader';
import { GearLocker } from '@/components/gear/GearLocker';
import { WeightAnalysis } from '@/components/weight/WeightAnalysis';
import { PackingList } from '@/components/packing/PackingList';
import { ShoppingList } from '@/components/shopping/ShoppingList';
import { TrailDatabase } from '@/components/trails/TrailDatabase';
import { useGear } from '@/hooks/useGear';
import { useShoppingItems } from '@/hooks/useShoppingItems';

const Index = () => {
  const [activeTab, setActiveTab] = useState<TabId>('gear');
  const [unit, setUnit] = useState<WeightUnit>('oz');
  const { gear, loading: gearLoading, addGear, editGear, deleteGear } = useGear();
  const { items: shopItems, loading: shopLoading, addItem: addShop, toggleItem: toggleShop, deleteItem: deleteShop } = useShoppingItems();

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
          {activeTab === 'gear' && <GearLocker gear={gear} unit={unit} onUnitChange={setUnit} onAdd={addGear} onEdit={editGear} onDelete={deleteGear} />}
          {activeTab === 'weight' && <WeightAnalysis gear={gear} unit={unit} />}
          {activeTab === 'packing' && <PackingList gear={gear} unit={unit} />}
          {activeTab === 'shopping' && <ShoppingList items={shopItems} onToggle={toggleShop} onDelete={deleteShop} onAdd={addShop} />}
          {activeTab === 'trails' && <TrailDatabase />}
        </main>
      </div>
    </div>
  );
};

export default Index;

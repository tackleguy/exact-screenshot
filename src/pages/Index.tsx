import { useState } from 'react';
import { type TabId, type WeightUnit, type GearItem, type ShopItem, INITIAL_GEAR, INITIAL_SHOP } from '@/lib/data';
import { MountainBackground } from '@/components/layout/MountainBackground';
import { AppHeader } from '@/components/layout/AppHeader';
import { GearLocker } from '@/components/gear/GearLocker';
import { WeightAnalysis } from '@/components/weight/WeightAnalysis';
import { PackingList } from '@/components/packing/PackingList';
import { ShoppingList } from '@/components/shopping/ShoppingList';
import { TrailDatabase } from '@/components/trails/TrailDatabase';

let nextId = 100;

const Index = () => {
  const [activeTab, setActiveTab] = useState<TabId>('gear');
  const [unit, setUnit] = useState<WeightUnit>('oz');
  const [gear, setGear] = useState<GearItem[]>(INITIAL_GEAR);
  const [shopItems, setShopItems] = useState<ShopItem[]>(INITIAL_SHOP);

  const addGear = (item: Omit<GearItem, 'id'>) => setGear(prev => [...prev, { ...item, id: String(++nextId) }]);
  const editGear = (id: string, item: Omit<GearItem, 'id'>) => setGear(prev => prev.map(g => g.id === id ? { ...item, id } : g));
  const deleteGear = (id: string) => setGear(prev => prev.filter(g => g.id !== id));

  const toggleShop = (id: string) => setShopItems(prev => prev.map(s => s.id === id ? { ...s, purchased: !s.purchased } : s));
  const deleteShop = (id: string) => setShopItems(prev => prev.filter(s => s.id !== id));
  const addShop = (item: Omit<ShopItem, 'id'>) => setShopItems(prev => [...prev, { ...item, id: String(++nextId) }]);

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

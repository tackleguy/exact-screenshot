export type GearCategory = 'Shelter' | 'Sleep System' | 'Cooking' | 'Clothing' | 'Electronics' | 'Hygiene' | 'Navigation' | 'Misc';
export type GearType = 'Base' | 'Worn' | 'Consumable';
export type WeightUnit = 'oz' | 'g' | 'lb';
export type TabId = 'gear' | 'packing' | 'weight' | 'shopping' | 'trails';

export interface GearItem {
  id: string;
  name: string;
  category: GearCategory;
  qty: number;
  weight: number; // always oz
  price: number;
  type: GearType;
  link: string;
}

export interface ShopItem {
  id: string;
  name: string;
  price: number;
  store: string;
  priority: 'High' | 'Medium' | 'Low';
  purchased: boolean;
}

export interface Trail {
  name: string;
  location: string;
  distance: number;
  elevation: number;
  days: string;
  difficulty: 'easy' | 'moderate' | 'hard' | 'expert';
  tags: string[];
  season: string;
}

export const CATEGORY_COLORS: Record<GearCategory, string> = {
  'Shelter': '#5a9c6a',
  'Sleep System': '#4a8cd4',
  'Cooking': '#d4914e',
  'Clothing': '#9b6bb5',
  'Electronics': '#c0504d',
  'Hygiene': '#55b5a6',
  'Navigation': '#d4c14e',
  'Misc': '#8b9daf',
};

export const CATEGORY_ORDER: GearCategory[] = ['Shelter', 'Sleep System', 'Cooking', 'Clothing', 'Electronics', 'Hygiene', 'Navigation', 'Misc'];

let _id = 0;
const uid = () => String(++_id);

export const INITIAL_GEAR: GearItem[] = [
  { id: uid(), name: 'Zpacks Duplex Tent', category: 'Shelter', qty: 1, weight: 19.4, price: 669, type: 'Base', link: '' },
  { id: uid(), name: 'Zpacks Groundsheet', category: 'Shelter', qty: 1, weight: 3.2, price: 45, type: 'Base', link: '' },
  { id: uid(), name: 'Enlightened Equipment Enigma 20°', category: 'Sleep System', qty: 1, weight: 25.6, price: 340, type: 'Base', link: '' },
  { id: uid(), name: 'Nemo Tensor Insulated Pad', category: 'Sleep System', qty: 1, weight: 15.0, price: 170, type: 'Base', link: '' },
  { id: uid(), name: 'Sea to Summit Inflatable Pillow', category: 'Sleep System', qty: 1, weight: 2.5, price: 45, type: 'Base', link: '' },
  { id: uid(), name: 'BRS-3000T Stove', category: 'Cooking', qty: 1, weight: 0.9, price: 20, type: 'Base', link: '' },
  { id: uid(), name: 'TOAKS 750ml Titanium Pot', category: 'Cooking', qty: 1, weight: 3.3, price: 30, type: 'Base', link: '' },
  { id: uid(), name: 'Long-handle Spoon (Ti)', category: 'Cooking', qty: 1, weight: 0.6, price: 15, type: 'Base', link: '' },
  { id: uid(), name: 'Sawyer Squeeze Filter', category: 'Cooking', qty: 1, weight: 3.0, price: 35, type: 'Base', link: '' },
  { id: uid(), name: 'CNOC Vecto 2L Dirty Bag', category: 'Cooking', qty: 1, weight: 2.4, price: 16, type: 'Base', link: '' },
  { id: uid(), name: 'Fuel Canister (8oz)', category: 'Cooking', qty: 1, weight: 14.5, price: 8, type: 'Consumable', link: '' },
  { id: uid(), name: 'Rain Jacket (Frogg Toggs)', category: 'Clothing', qty: 1, weight: 5.5, price: 20, type: 'Worn', link: '' },
  { id: uid(), name: 'Merino Wool Base Layer', category: 'Clothing', qty: 1, weight: 6.8, price: 85, type: 'Worn', link: '' },
  { id: uid(), name: 'Hiking Pants', category: 'Clothing', qty: 1, weight: 8.2, price: 70, type: 'Worn', link: '' },
  { id: uid(), name: 'Down Puffy Jacket', category: 'Clothing', qty: 1, weight: 10.5, price: 200, type: 'Base', link: '' },
  { id: uid(), name: 'Extra Socks (2 pairs)', category: 'Clothing', qty: 2, weight: 2.1, price: 18, type: 'Base', link: '' },
  { id: uid(), name: 'Buff / Neck Gaiter', category: 'Clothing', qty: 1, weight: 1.2, price: 20, type: 'Worn', link: '' },
  { id: uid(), name: 'Anker 10000mAh Power Bank', category: 'Electronics', qty: 1, weight: 6.5, price: 26, type: 'Base', link: '' },
  { id: uid(), name: 'Headlamp (Nitecore NU25)', category: 'Electronics', qty: 1, weight: 1.0, price: 36, type: 'Base', link: '' },
  { id: uid(), name: 'USB-C Cable', category: 'Electronics', qty: 1, weight: 0.7, price: 8, type: 'Base', link: '' },
  { id: uid(), name: 'Mini First Aid Kit', category: 'Hygiene', qty: 1, weight: 3.0, price: 15, type: 'Base', link: '' },
  { id: uid(), name: 'Trowel (Deuce #2)', category: 'Hygiene', qty: 1, weight: 0.6, price: 25, type: 'Base', link: '' },
  { id: uid(), name: 'Sunscreen (travel)', category: 'Hygiene', qty: 1, weight: 2.0, price: 10, type: 'Consumable', link: '' },
  { id: uid(), name: 'Toothbrush + Paste', category: 'Hygiene', qty: 1, weight: 1.2, price: 5, type: 'Base', link: '' },
  { id: uid(), name: 'Garmin inReach Mini 2', category: 'Navigation', qty: 1, weight: 3.5, price: 400, type: 'Base', link: '' },
  { id: uid(), name: 'Compass (Suunto A-10)', category: 'Navigation', qty: 1, weight: 1.1, price: 30, type: 'Base', link: '' },
  { id: uid(), name: 'Trekking Poles (pair)', category: 'Misc', qty: 1, weight: 16.0, price: 130, type: 'Worn', link: '' },
  { id: uid(), name: 'Pack (ULA Circuit)', category: 'Misc', qty: 1, weight: 39.0, price: 265, type: 'Base', link: '' },
  { id: uid(), name: 'Stuff Sacks (set)', category: 'Misc', qty: 1, weight: 2.0, price: 12, type: 'Base', link: '' },
];

export const INITIAL_SHOP: ShopItem[] = [
  { id: uid(), name: 'Bear Canister (BV500)', price: 80, store: 'REI', priority: 'High', purchased: false },
  { id: uid(), name: 'Microspikes', price: 40, store: 'Amazon', priority: 'Medium', purchased: false },
  { id: uid(), name: 'Sitpad (1/8" foam)', price: 8, store: 'Gossamer Gear', priority: 'Low', purchased: false },
  { id: uid(), name: 'Smartwater Bottles (2)', price: 4, store: 'Walmart', priority: 'High', purchased: false },
];

export const TRAILS: Trail[] = [
  { name: 'John Muir Trail', location: 'California, USA', distance: 211, elevation: 47000, days: '14-21', difficulty: 'hard', tags: ['Sierra Nevada', 'Permits Required', 'Bear Canisters'], season: 'Jul-Sep' },
  { name: 'Appalachian Trail', location: 'Georgia to Maine, USA', distance: 2190, elevation: 464500, days: '150-180', difficulty: 'expert', tags: ['Thru-hike', 'Shelters', 'White Blaze'], season: 'Mar-Oct' },
  { name: 'Tour du Mont Blanc', location: 'France / Italy / Switzerland', distance: 105, elevation: 32800, days: '7-11', difficulty: 'moderate', tags: ['Alps', 'Hut System', 'No Permit'], season: 'Jun-Sep' },
  { name: 'Wonderland Trail', location: 'Washington, USA', distance: 93, elevation: 22000, days: '7-10', difficulty: 'hard', tags: ['Mt. Rainier', 'Permits Required', 'Alpine'], season: 'Jul-Sep' },
  { name: 'West Coast Trail', location: 'British Columbia, Canada', distance: 47, elevation: 5500, days: '5-7', difficulty: 'hard', tags: ['Coastal', 'Ladders', 'Tide Tables'], season: 'May-Sep' },
  { name: 'Kungsleden', location: 'Swedish Lapland', distance: 270, elevation: 16000, days: '15-20', difficulty: 'moderate', tags: ['Arctic', 'Hut System', 'Midnight Sun'], season: 'Jun-Sep' },
  { name: 'Torres del Paine W Trek', location: 'Patagonia, Chile', distance: 50, elevation: 10000, days: '4-5', difficulty: 'moderate', tags: ['Patagonia', 'Wind', 'Refugios'], season: 'Oct-Mar' },
  { name: 'Laugavegur Trail', location: 'Iceland', distance: 34, elevation: 4600, days: '2-4', difficulty: 'moderate', tags: ['Volcanic', 'Hot Springs', 'River Crossings'], season: 'Jun-Aug' },
  { name: 'Pacific Crest Trail', location: 'CA / OR / WA, USA', distance: 2650, elevation: 490000, days: '150-180', difficulty: 'expert', tags: ['Thru-hike', 'Desert to Alpine', 'PCT Permit'], season: 'Apr-Oct' },
  { name: 'Haute Route', location: 'Chamonix to Zermatt', distance: 112, elevation: 39000, days: '10-14', difficulty: 'hard', tags: ['Alps', 'High Passes', 'Glacier Views'], season: 'Jul-Sep' },
  { name: 'Lost Coast Trail', location: 'California, USA', distance: 25, elevation: 3200, days: '3-4', difficulty: 'moderate', tags: ['Coastal', 'Tide Dependent', 'Bear Canisters'], season: 'May-Oct' },
  { name: 'Grand Canyon Rim-to-Rim', location: 'Arizona, USA', distance: 21, elevation: 10600, days: '2-3', difficulty: 'hard', tags: ['Desert', 'Permits Required', 'Water Carry'], season: 'Mar-May, Sep-Nov' },
  { name: 'Annapurna Circuit', location: 'Nepal', distance: 128, elevation: 17800, days: '12-18', difficulty: 'hard', tags: ['Himalayas', 'Tea Houses', 'Thorong La Pass'], season: 'Oct-Nov' },
  { name: 'Inca Trail', location: 'Peru', distance: 26, elevation: 8200, days: '4', difficulty: 'moderate', tags: ['Machu Picchu', 'Permits Required', 'Altitude'], season: 'Apr-Oct' },
  { name: 'Milford Track', location: 'New Zealand', distance: 33, elevation: 4900, days: '4', difficulty: 'moderate', tags: ['Fiordland', 'Great Walk', 'Huts'], season: 'Oct-Apr' },
  { name: 'GR20', location: 'Corsica, France', distance: 112, elevation: 32000, days: '16', difficulty: 'expert', tags: ['Technical', "Europe's Hardest", 'Rock Scrambling'], season: 'Jun-Oct' },
  { name: 'Overland Track', location: 'Tasmania, Australia', distance: 40, elevation: 4600, days: '5-6', difficulty: 'moderate', tags: ['World Heritage', 'Huts', 'Rainforest'], season: 'Oct-May' },
  { name: 'Dolomites Alta Via 1', location: 'Italy', distance: 75, elevation: 20000, days: '8-12', difficulty: 'hard', tags: ['Rifugios', 'Via Ferrata', 'Dolomites'], season: 'Jul-Sep' },
  { name: 'Kilimanjaro Machame Route', location: 'Tanzania', distance: 37, elevation: 13200, days: '6-7', difficulty: 'hard', tags: ['Summit Attempt', 'Altitude', 'Porters'], season: 'Jan-Mar, Jun-Oct' },
  { name: 'Camino de Santiago Francés', location: 'Spain', distance: 500, elevation: 40000, days: '30-35', difficulty: 'moderate', tags: ['Pilgrimage', 'Albergues', 'Cultural'], season: 'Apr-Oct' },
  { name: 'Mount Olympus E4', location: 'Greece', distance: 28, elevation: 9500, days: '2-3', difficulty: 'hard', tags: ['Mythology', 'Alpine', 'Refuge'], season: 'Jun-Oct' },
  { name: 'Lycian Way', location: 'Turkey', distance: 335, elevation: 42000, days: '25-30', difficulty: 'moderate', tags: ['Coastal', 'Ancient Ruins', 'Mediterranean'], season: 'Feb-May, Sep-Nov' },
  { name: 'Snowman Trek', location: 'Bhutan', distance: 186, elevation: 50000, days: '24-28', difficulty: 'expert', tags: ['Remote', 'Permits Required', 'High Altitude'], season: 'Sep-Oct' },
  { name: 'Zion Narrows Top-Down', location: 'Utah, USA', distance: 16, elevation: 1500, days: '1-2', difficulty: 'moderate', tags: ['Slot Canyon', 'Water Hiking', 'Permits'], season: 'Jun-Oct' },
  { name: 'Kalalau Trail', location: 'Hawaii, USA', distance: 22, elevation: 6200, days: '2', difficulty: 'hard', tags: ['Na Pali Coast', 'Permits Required', 'Tropical'], season: 'Year-round' },
  { name: 'Drakensberg Grand Traverse', location: 'South Africa', distance: 140, elevation: 30000, days: '10-14', difficulty: 'expert', tags: ['Remote', 'No Trail', 'Navigation Required'], season: 'Mar-May' },
  { name: 'The Enchantments Thru-Hike', location: 'Washington, USA', distance: 18, elevation: 4500, days: '1-2', difficulty: 'hard', tags: ['Alpine Lakes', 'Permits Lottery', 'Goats'], season: 'Jun-Oct' },
  { name: 'Huemul Circuit', location: 'Patagonia, Argentina', distance: 40, elevation: 11500, days: '3-4', difficulty: 'expert', tags: ['Glacier Crossings', 'Tyroleans', 'Remote'], season: 'Nov-Mar' },
  { name: "King's Peak via Henry's Fork", location: 'Utah, USA', distance: 27, elevation: 4400, days: '2-3', difficulty: 'moderate', tags: ['Highpoint', 'Uintas', 'Alpine Meadows'], season: 'Jul-Sep' },
  { name: 'Teton Crest Trail', location: 'Wyoming, USA', distance: 40, elevation: 8000, days: '3-5', difficulty: 'hard', tags: ['Grand Teton', 'Alpine', 'Wildflowers'], season: 'Jul-Sep' },
  { name: 'Wind River High Route', location: 'Wyoming, USA', distance: 80, elevation: 22000, days: '7-10', difficulty: 'expert', tags: ['Off-Trail', 'Glacier', 'Remote'], season: 'Jul-Sep' },
];

export function convertWeight(oz: number, unit: WeightUnit): string {
  if (unit === 'g') return (oz * 28.3495).toFixed(0);
  if (unit === 'lb') return (oz / 16).toFixed(2);
  return oz.toFixed(1);
}

export function calcStats(gear: GearItem[]) {
  let totalWeight = 0, baseWeight = 0, wornWeight = 0, consumableWeight = 0, totalCost = 0, totalItems = 0;
  gear.forEach(g => {
    const w = g.weight * g.qty;
    totalWeight += w;
    totalItems += g.qty;
    totalCost += g.price * g.qty;
    if (g.type === 'Base') baseWeight += w;
    else if (g.type === 'Worn') wornWeight += w;
    else consumableWeight += w;
  });
  return { totalWeight, baseWeight, wornWeight, consumableWeight, totalCost, totalItems };
}

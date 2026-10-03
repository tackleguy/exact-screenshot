import { useState, useEffect, useMemo } from 'react';
import { type GearItem, type WeightUnit, CATEGORY_ORDER, CATEGORY_COLORS, convertWeight, calcStats, TRAILS } from '@/lib/data';
import { usePackingLists, type PackingListItem } from '@/hooks/usePackingLists';
import { useCommunity } from '@/hooks/useCommunity';
import { useAuth } from '@/contexts/AuthContext';
import { downloadCSV, downloadPDF } from '@/lib/downloads';
import { getTierLimits, getCurrentMonthStart } from '@/lib/tierGating';
import { Check, Plus, Trash2, Share2, Download, FileText, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  gear: GearItem[];
  unit: WeightUnit;
}

export function PackingList({ gear, unit }: Props) {
  const { user, profile } = useAuth();
  const { lists, createList, deleteList, getListItems, addItemToList, removeItemFromList, togglePacked, addAllGearToList } = usePackingLists();
  const { createPost } = useCommunity();
  const limits = getTierLimits(profile?.tier);

  const monthStart = getCurrentMonthStart();
  const listsCreatedThisMonth = lists.filter(l => l.created_at >= monthStart).length;
  const canCreateList = listsCreatedThisMonth < limits.packingListsPerMonth;

  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [listItems, setListItems] = useState<PackingListItem[]>([]);
  const [newListName, setNewListName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [shareTitle, setShareTitle] = useState('');
  const [shareDesc, setShareDesc] = useState('');
  const [shareTripType, setShareTripType] = useState('Overnight');
  const [shareTrail, setShareTrail] = useState('');
  const [showAddGear, setShowAddGear] = useState(false);

  useEffect(() => {
    if (lists.length > 0 && !selectedListId) setSelectedListId(lists[0].id);
  }, [lists, selectedListId]);

  useEffect(() => {
    if (selectedListId) {
      getListItems(selectedListId).then(setListItems);
    } else {
      setListItems([]);
    }
  }, [selectedListId]);

  const selectedList = lists.find(l => l.id === selectedListId);
  const gearInList = useMemo(() => {
    const ids = new Set(listItems.map(li => li.gear_item_id));
    return gear.filter(g => ids.has(g.id));
  }, [gear, listItems]);

  const packedMap = useMemo(() => {
    const m: Record<string, { itemId: string; packed: boolean }> = {};
    listItems.forEach(li => { m[li.gear_item_id] = { itemId: li.id, packed: li.packed }; });
    return m;
  }, [listItems]);

  const stats = useMemo(() => calcStats(gearInList), [gearInList]);
  const grouped: Record<string, GearItem[]> = {};
  gearInList.forEach(g => { if (!grouped[g.category]) grouped[g.category] = []; grouped[g.category].push(g); });

  const handleCreateList = async () => {
    if (!newListName.trim()) return;
    if (!canCreateList) {
      toast.error(`You've reached your ${limits.packingListsPerMonth} packing lists limit this month. Upgrade to Thru-Hiker for unlimited lists.`);
      return;
    }
    const list = await createList(newListName.trim());
    if (list) { setSelectedListId(list.id); setNewListName(''); setShowCreate(false); }
  };

  const handleToggle = async (gearId: string) => {
    const info = packedMap[gearId];
    if (!info) return;
    await togglePacked(info.itemId, !info.packed);
    setListItems(prev => prev.map(li => li.id === info.itemId ? { ...li, packed: !li.packed } : li));
  };

  const handleAddGear = async (gearId: string) => {
    if (!selectedListId) return;
    await addItemToList(selectedListId, gearId);
    const items = await getListItems(selectedListId);
    setListItems(items);
    toast.success('Item added to list');
  };

  const handleRemoveGear = async (gearId: string) => {
    const info = packedMap[gearId];
    if (!info) return;
    await removeItemFromList(info.itemId);
    setListItems(prev => prev.filter(li => li.id !== info.itemId));
  };

  const handleAddAllGear = async () => {
    if (!selectedListId) return;
    const existingIds = new Set(listItems.map(li => li.gear_item_id));
    const newIds = gear.filter(g => !existingIds.has(g.id)).map(g => g.id);
    if (newIds.length === 0) { toast.info('All gear already in list'); return; }
    await addAllGearToList(selectedListId, newIds);
    const items = await getListItems(selectedListId);
    setListItems(items);
    toast.success(`Added ${newIds.length} items`);
  };

  const handleShare = async () => {
    if (!shareTitle.trim()) return;
    await createPost({
      packing_list_id: selectedListId || undefined,
      title: shareTitle.trim(),
      description: shareDesc,
      trip_type: shareTripType,
      trail_name: shareTrail,
      gear_data: gearInList,
      base_weight_oz: stats.baseWeight,
      total_weight_oz: stats.totalWeight,
      item_count: stats.totalItems,
      total_cost: stats.totalCost,
    });
    toast.success('Published to Community!');
    setShowShare(false);
  };

  const handleDeleteList = async () => {
    if (!selectedListId) return;
    await deleteList(selectedListId);
    setSelectedListId(lists.length > 1 ? lists.find(l => l.id !== selectedListId)?.id || null : null);
    toast.success('List deleted');
  };

  const gearNotInList = gear.filter(g => !packedMap[g.id]);
  const packedCount = listItems.filter(li => li.packed).length;
  const totalInList = listItems.length;

  const inputClass = "w-full bg-background/60 border border-border/40 text-snow font-body text-[0.85rem] px-3 py-2.5 rounded-lg outline-none transition-colors focus:border-primary/50";

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <h2 className="text-[1.8rem] font-bold tracking-tight">Packing Lists</h2>
          <p className="text-[0.8rem] text-granite mt-1">Build trip-specific checklists from your gear locker</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <button onClick={() => { if (canCreateList) setShowCreate(true); else toast.error(`Limit reached (${limits.packingListsPerMonth}/mo). Upgrade to Thru-Hiker for unlimited.`); }}
            className={`px-4 py-2 rounded-lg text-[0.8rem] font-semibold transition-all active:scale-[0.97] ${canCreateList ? 'bg-gradient-to-br from-moss to-moss-glow text-primary-foreground shadow-[0_4px_15px_hsla(140,35%,38%,0.25)] hover:shadow-[0_6px_20px_hsla(140,35%,38%,0.4)] hover:-translate-y-px' : 'bg-secondary text-granite cursor-not-allowed'}`}>
            <Plus size={14} className="inline mr-1" /> New List
          </button>
          {limits.packingListsPerMonth !== Infinity && (
            <span className="text-[0.7rem] text-granite">{listsCreatedThisMonth}/{limits.packingListsPerMonth} this month</span>
          )}
        </div>
      </div>

      {/* List selector */}
      {lists.length > 0 && (
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {lists.map(list => (
            <button key={list.id} onClick={() => setSelectedListId(list.id)}
              className={`px-4 py-2 rounded-lg text-[0.8rem] font-medium whitespace-nowrap transition-all
                ${selectedListId === list.id ? 'bg-primary/15 text-snow border border-primary/30' : 'bg-card/70 text-granite border border-border/40 hover:text-snow'}`}>
              {list.name}
            </button>
          ))}
        </div>
      )}

      {lists.length === 0 && !showCreate && (
        <div className="text-center py-16 text-granite">
          <p className="text-lg mb-4">No packing lists yet</p>
          <button onClick={() => setShowCreate(true)} className="px-6 py-3 rounded-lg bg-primary text-primary-foreground font-semibold transition-all hover:bg-primary/90">
            Create Your First List
          </button>
        </div>
      )}

      {selectedList && (
        <>
          {/* Actions bar */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-[0.8rem] text-granite mr-2">
              {packedCount}/{totalInList} packed · {convertWeight(stats.baseWeight, unit)} {unit} base
            </span>
            <button onClick={() => setShowAddGear(true)} className="px-3 py-1.5 rounded-lg border border-border/40 bg-card/70 text-snow text-[0.75rem] font-semibold hover:border-border/60 active:scale-[0.97]">
              <Plus size={12} className="inline mr-1" /> Add Gear
            </button>
            <button onClick={handleAddAllGear} className="px-3 py-1.5 rounded-lg border border-border/40 bg-card/70 text-snow text-[0.75rem] font-semibold hover:border-border/60 active:scale-[0.97]">
              Add All Gear
            </button>
            <button onClick={() => { if (limits.canDownload) downloadPDF(gearInList, unit, selectedList.name, profile?.display_name || ''); else toast.error('PDF export is a Thru-Hiker feature. Upgrade to download.'); }}
              className={`px-3 py-1.5 rounded-lg border text-[0.75rem] font-semibold active:scale-[0.97] ${limits.canDownload ? 'border-border/40 bg-card/70 text-snow hover:border-border/60' : 'border-border/30 bg-card/40 text-granite/50 cursor-not-allowed'}`}>
              {limits.canDownload ? <FileText size={12} className="inline mr-1" /> : <Lock size={12} className="inline mr-1" />} PDF
            </button>
            <button onClick={() => { if (limits.canDownload) downloadCSV(gearInList, unit, selectedList.name); else toast.error('CSV export is a Thru-Hiker feature. Upgrade to download.'); }}
              className={`px-3 py-1.5 rounded-lg border text-[0.75rem] font-semibold active:scale-[0.97] ${limits.canDownload ? 'border-border/40 bg-card/70 text-snow hover:border-border/60' : 'border-border/30 bg-card/40 text-granite/50 cursor-not-allowed'}`}>
              {limits.canDownload ? <Download size={12} className="inline mr-1" /> : <Lock size={12} className="inline mr-1" />} CSV
            </button>
            <button onClick={() => { setShareTitle(selectedList.name); setShowShare(true); }}
              className="px-3 py-1.5 rounded-lg border border-moss/40 bg-moss/10 text-moss-glow text-[0.75rem] font-semibold hover:bg-moss/20 active:scale-[0.97]">
              <Share2 size={12} className="inline mr-1" /> Share to Community
            </button>
            <button onClick={handleDeleteList} className="ml-auto px-3 py-1.5 rounded-lg border border-danger/30 bg-danger/10 text-danger text-[0.75rem] font-semibold hover:bg-danger/20 active:scale-[0.97]">
              <Trash2 size={12} className="inline mr-1" /> Delete List
            </button>
          </div>

          {/* Gear items grouped by category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CATEGORY_ORDER.map(cat => {
              if (!grouped[cat]) return null;
              const items = grouped[cat];
              const catPacked = items.filter(g => packedMap[g.id]?.packed).length;
              return (
                <div key={cat} className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: CATEGORY_COLORS[cat] }} />
                    <h4 className="font-display text-[0.95rem] font-bold flex-1">{cat}</h4>
                    <span className="font-mono text-[0.7rem] text-granite">{catPacked}/{items.length}</span>
                  </div>
                  {items.map(g => (
                    <div key={g.id} className="flex items-center gap-2 py-1.5 text-[0.8rem] group">
                      <button onClick={() => handleToggle(g.id)}
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${packedMap[g.id]?.packed ? 'bg-moss-glow border-moss-glow' : 'border-granite'}`}>
                        {packedMap[g.id]?.packed && <Check size={10} className="text-primary-foreground" strokeWidth={3} />}
                      </button>
                      <span className={`flex-1 ${packedMap[g.id]?.packed ? 'line-through opacity-50' : ''}`}>
                        {g.name}{g.qty > 1 ? ` (×${g.qty})` : ''}
                      </span>
                      <span className="font-mono text-[0.7rem] text-granite">{convertWeight(g.weight * g.qty, unit)}</span>
                      <button onClick={() => handleRemoveGear(g.id)} className="opacity-0 group-hover:opacity-100 p-0.5 text-granite/50 hover:text-danger transition-all">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Create list modal */}
      {showCreate && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/85 backdrop-blur-lg" onClick={() => setShowCreate(false)}>
          <div className="bg-ridge border border-border/40 rounded-2xl p-8 w-[90%] max-w-[420px]" onClick={e => e.stopPropagation()}>
            <h3 className="text-[1.3rem] mb-4">Create Packing List</h3>
            <input className={inputClass} placeholder="e.g., JMT Thru-Hike 2026" value={newListName} onChange={e => setNewListName(e.target.value)} autoFocus />
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowCreate(false)} className="px-5 py-2.5 rounded-lg border border-border/40 bg-card/70 text-snow text-[0.8rem] font-semibold">Cancel</button>
              <button onClick={handleCreateList} className="px-5 py-2.5 rounded-lg bg-gradient-to-br from-moss to-moss-glow text-primary-foreground text-[0.8rem] font-semibold">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Add gear modal */}
      {showAddGear && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/85 backdrop-blur-lg" onClick={() => setShowAddGear(false)}>
          <div className="bg-ridge border border-border/40 rounded-2xl p-8 w-[90%] max-w-[520px] max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-[1.3rem] mb-4">Add Gear to List</h3>
            {gearNotInList.length === 0 ? (
              <p className="text-granite text-sm">All gear items are already in this list.</p>
            ) : (
              <div className="space-y-1">
                {gearNotInList.map(g => (
                  <div key={g.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-secondary/30 transition-colors">
                    <div>
                      <span className="text-[0.85rem]">{g.name}</span>
                      <span className="text-[0.7rem] text-granite ml-2">{g.category}</span>
                    </div>
                    <button onClick={() => handleAddGear(g.id)} className="px-3 py-1 rounded bg-primary/15 text-moss-glow text-[0.75rem] font-semibold hover:bg-primary/25">Add</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end mt-6">
              <button onClick={() => setShowAddGear(false)} className="px-5 py-2.5 rounded-lg border border-border/40 bg-card/70 text-snow text-[0.8rem] font-semibold">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Share to community modal */}
      {showShare && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/85 backdrop-blur-lg" onClick={() => setShowShare(false)}>
          <div className="bg-ridge border border-border/40 rounded-2xl p-8 w-[90%] max-w-[520px]" onClick={e => e.stopPropagation()}>
            <h3 className="text-[1.3rem] mb-4">Share to Community</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-[0.7rem] font-semibold text-granite uppercase tracking-[0.1em] mb-1">Title</label>
                <input className={inputClass} value={shareTitle} onChange={e => setShareTitle(e.target.value)} />
              </div>
              <div>
                <label className="block text-[0.7rem] font-semibold text-granite uppercase tracking-[0.1em] mb-1">Description</label>
                <textarea className={inputClass + ' min-h-[80px]'} value={shareDesc} onChange={e => setShareDesc(e.target.value)} placeholder="Tell others about this pack setup..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[0.7rem] font-semibold text-granite uppercase tracking-[0.1em] mb-1">Trip Type</label>
                  <select className={inputClass} value={shareTripType} onChange={e => setShareTripType(e.target.value)}>
                    {['Day Hike', 'Overnight', 'Thru-Hike', 'Winter', 'Ultralight Challenge'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[0.7rem] font-semibold text-granite uppercase tracking-[0.1em] mb-1">Trail</label>
                  <select className={inputClass} value={shareTrail} onChange={e => setShareTrail(e.target.value)}>
                    <option value="">None</option>
                    {TRAILS.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowShare(false)} className="px-5 py-2.5 rounded-lg border border-border/40 bg-card/70 text-snow text-[0.8rem] font-semibold">Cancel</button>
              <button onClick={handleShare} className="px-5 py-2.5 rounded-lg bg-gradient-to-br from-moss to-moss-glow text-primary-foreground text-[0.8rem] font-semibold">Publish</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

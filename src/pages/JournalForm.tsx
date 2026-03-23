import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MountainBackground } from '@/components/layout/MountainBackground';
import { AppHeader } from '@/components/layout/AppHeader';
import { useJournal, type JournalDay, type JournalPhoto } from '@/hooks/useJournal';
import { usePackingLists } from '@/hooks/usePackingLists';
import { TRAILS } from '@/lib/data';
import { ArrowLeft, Plus, Trash2, Upload, X, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

const WEATHER_OPTIONS = ['Sunny', 'Cloudy', 'Rain', 'Snow', 'Wind', 'Thunderstorms', 'Fog', 'Hail', 'Heat Wave', 'Perfect'];
const TRAIL_CONDITIONS = ['Excellent', 'Good', 'Fair', 'Poor', 'Dangerous'];
const WATER_SOURCES = ['Abundant', 'Adequate', 'Scarce', 'Carry All'];
const BUG_LEVELS = ['None', 'Mild', 'Moderate', 'Terrible'];
const SNOW_ICE = ['None', 'Patches', 'Significant', 'Microspikes Needed', 'Crampons Needed'];

const JournalForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { createEntry, updateEntry, getEntry, getDays, saveDays, getPhotos, uploadPhoto, deletePhoto } = useJournal();
  const { lists } = usePackingLists();
  const isEdit = !!id;

  const [tripName, setTripName] = useState('');
  const [trailName, setTrailName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [companions, setCompanions] = useState('');
  const [distanceMiles, setDistanceMiles] = useState('');
  const [elevGain, setElevGain] = useState('');
  const [elevLoss, setElevLoss] = useState('');
  const [highestPoint, setHighestPoint] = useState('');
  const [hikingTime, setHikingTime] = useState('');
  const [difficulty, setDifficulty] = useState(0);
  const [trailCondition, setTrailCondition] = useState('');
  const [avgDayTemp, setAvgDayTemp] = useState('');
  const [avgNightTemp, setAvgNightTemp] = useState('');
  const [weather, setWeather] = useState<string[]>([]);
  const [waterSources, setWaterSources] = useState('');
  const [bugLevel, setBugLevel] = useState('');
  const [snowIce, setSnowIce] = useState('');
  const [packingListId, setPackingListId] = useState('');
  const [gearNotes, setGearNotes] = useState('');
  const [tripNotes, setTripNotes] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [days, setDays] = useState<JournalDay[]>([]);
  const [photos, setPhotos] = useState<JournalPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ info: true, stats: true, climate: false, photos: false, gear: false, notes: false, days: false });

  useEffect(() => {
    if (isEdit && id) {
      getEntry(id).then(entry => {
        if (!entry) return;
        setTripName(entry.trip_name);
        setTrailName(entry.trail_name);
        setStartDate(entry.start_date || '');
        setEndDate(entry.end_date || '');
        setCompanions(entry.companions || '');
        setDistanceMiles(entry.distance_miles?.toString() || '');
        setElevGain(entry.elevation_gain_ft?.toString() || '');
        setElevLoss(entry.elevation_loss_ft?.toString() || '');
        setHighestPoint(entry.highest_point_ft?.toString() || '');
        setHikingTime(entry.hiking_time_hours?.toString() || '');
        setDifficulty(entry.difficulty_rating || 0);
        setTrailCondition(entry.trail_condition || '');
        setAvgDayTemp(entry.avg_day_temp_f?.toString() || '');
        setAvgNightTemp(entry.avg_night_temp_f?.toString() || '');
        setWeather(entry.weather_conditions || []);
        setWaterSources(entry.water_sources || '');
        setBugLevel(entry.bug_level || '');
        setSnowIce(entry.snow_ice || '');
        setPackingListId(entry.packing_list_id || '');
        setGearNotes(entry.gear_notes || '');
        setTripNotes(entry.trip_notes || '');
        setIsPublic(entry.is_public);
      });
      getDays(id).then(setDays);
      getPhotos(id).then(setPhotos);
    }
  }, [id]);

  const toggleSection = (s: string) => setExpandedSections(prev => ({ ...prev, [s]: !prev[s] }));
  const toggleWeather = (w: string) => setWeather(prev => prev.includes(w) ? prev.filter(x => x !== w) : [...prev, w]);

  const addDay = () => setDays(prev => [...prev, { day_number: prev.length + 1, miles: null, camp_location: null, notes: null }]);
  const removeDay = (idx: number) => setDays(prev => prev.filter((_, i) => i !== idx).map((d, i) => ({ ...d, day_number: i + 1 })));
  const updateDay = (idx: number, field: string, value: any) => setDays(prev => prev.map((d, i) => i === idx ? { ...d, [field]: value } : d));

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !id) return;
    setUploading(true);
    for (const file of Array.from(e.target.files)) {
      const photo = await uploadPhoto(id, file, '', photos.length);
      if (photo) setPhotos(prev => [...prev, photo]);
    }
    setUploading(false);
  };

  const handleSave = async () => {
    if (!tripName.trim()) { toast.error('Trip name is required'); return; }
    setSaving(true);

    const entry = {
      trip_name: tripName.trim(),
      trail_name: trailName,
      start_date: startDate || null,
      end_date: endDate || null,
      companions: companions || null,
      distance_miles: distanceMiles ? Number(distanceMiles) : null,
      elevation_gain_ft: elevGain ? Number(elevGain) : null,
      elevation_loss_ft: elevLoss ? Number(elevLoss) : null,
      highest_point_ft: highestPoint ? Number(highestPoint) : null,
      hiking_time_hours: hikingTime ? Number(hikingTime) : null,
      difficulty_rating: difficulty || null,
      trail_condition: trailCondition || null,
      avg_day_temp_f: avgDayTemp ? Number(avgDayTemp) : null,
      avg_night_temp_f: avgNightTemp ? Number(avgNightTemp) : null,
      weather_conditions: weather,
      water_sources: waterSources || null,
      bug_level: bugLevel || null,
      snow_ice: snowIce || null,
      packing_list_id: packingListId || null,
      gear_notes: gearNotes || null,
      trip_notes: tripNotes || null,
      is_public: isPublic,
      hero_photo_url: photos[0]?.photo_url || null,
    };

    let savedId = id;
    if (isEdit && id) {
      await updateEntry(id, entry);
    } else {
      const result = await createEntry(entry);
      if (result) savedId = result.id;
    }

    if (savedId && days.length > 0) await saveDays(savedId, days);

    setSaving(false);
    toast.success(isEdit ? 'Trip updated!' : 'Trip logged!');
    navigate('/journal');
  };

  const inputClass = "w-full bg-background/60 border border-border/40 text-snow font-body text-[0.85rem] px-3 py-2.5 rounded-lg outline-none transition-colors focus:border-primary/50";
  const labelClass = "block text-[0.7rem] font-semibold text-granite uppercase tracking-[0.1em] mb-1";

  const SectionHeader = ({ title, section }: { title: string; section: string }) => (
    <button onClick={() => toggleSection(section)} className="w-full flex items-center justify-between py-3 text-[1.1rem] font-bold border-b border-border/30 mb-4">
      {title}
      {expandedSections[section] ? <ChevronUp size={18} className="text-granite" /> : <ChevronDown size={18} className="text-granite" />}
    </button>
  );

  return (
    <div className="min-h-screen">
      <MountainBackground />
      <div className="relative z-10">
        <AppHeader />
        <main className="max-w-[800px] mx-auto px-6 lg:px-10 py-8 animate-fade-up">
          <button onClick={() => navigate('/journal')} className="flex items-center gap-1.5 text-granite hover:text-snow text-[0.85rem] mb-6 transition-colors">
            <ArrowLeft size={16} /> Back to Journal
          </button>

          <h2 className="text-[1.8rem] font-bold tracking-tight mb-8">{isEdit ? 'Edit Trip' : 'Log New Trip'}</h2>

          <div className="space-y-2">
            {/* Trip Info */}
            <SectionHeader title="Trip Info" section="info" />
            {expandedSections.info && (
              <div className="space-y-4 mb-6">
                <div><label className={labelClass}>Trip Name *</label><input className={inputClass} value={tripName} onChange={e => setTripName(e.target.value)} placeholder="e.g., JMT Southbound 2026" /></div>
                <div>
                  <label className={labelClass}>Trail</label>
                  <select className={inputClass} value={trailName} onChange={e => setTrailName(e.target.value)}>
                    <option value="">Select trail or leave blank</option>
                    <option value="Custom">Custom Trail</option>
                    {TRAILS.map(t => <option key={t.name} value={t.name}>{t.name} — {t.location}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={labelClass}>Start Date</label><input className={inputClass} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
                  <div><label className={labelClass}>End Date</label><input className={inputClass} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
                </div>
                <div><label className={labelClass}>Companions</label><input className={inputClass} value={companions} onChange={e => setCompanions(e.target.value)} placeholder="Comma-separated names" /></div>
              </div>
            )}

            {/* Trail Stats */}
            <SectionHeader title="Trail Stats" section="stats" />
            {expandedSections.stats && (
              <div className="space-y-4 mb-6">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={labelClass}>Distance (miles)</label><input className={inputClass} type="number" step="0.1" value={distanceMiles} onChange={e => setDistanceMiles(e.target.value)} /></div>
                  <div><label className={labelClass}>Elevation Gain (ft)</label><input className={inputClass} type="number" value={elevGain} onChange={e => setElevGain(e.target.value)} /></div>
                  <div><label className={labelClass}>Elevation Loss (ft)</label><input className={inputClass} type="number" value={elevLoss} onChange={e => setElevLoss(e.target.value)} /></div>
                  <div><label className={labelClass}>Highest Point (ft)</label><input className={inputClass} type="number" value={highestPoint} onChange={e => setHighestPoint(e.target.value)} /></div>
                  <div><label className={labelClass}>Hiking Time (hours)</label><input className={inputClass} type="number" step="0.5" value={hikingTime} onChange={e => setHikingTime(e.target.value)} /></div>
                  <div>
                    <label className={labelClass}>Trail Condition</label>
                    <select className={inputClass} value={trailCondition} onChange={e => setTrailCondition(e.target.value)}>
                      <option value="">Select</option>
                      {TRAIL_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Difficulty Rating</label>
                  <div className="flex gap-1 mt-1">
                    {[1,2,3,4,5].map(n => (
                      <button key={n} onClick={() => setDifficulty(n)} className="text-2xl transition-colors">
                        <Star size={24} fill={n <= difficulty ? 'hsl(var(--amber))' : 'transparent'} stroke={n <= difficulty ? 'hsl(var(--amber))' : 'hsl(var(--granite))'} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Climate */}
            <SectionHeader title="Climate & Conditions" section="climate" />
            {expandedSections.climate && (
              <div className="space-y-4 mb-6">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={labelClass}>Avg Daytime Temp (°F)</label><input className={inputClass} type="number" value={avgDayTemp} onChange={e => setAvgDayTemp(e.target.value)} /></div>
                  <div><label className={labelClass}>Avg Nighttime Temp (°F)</label><input className={inputClass} type="number" value={avgNightTemp} onChange={e => setAvgNightTemp(e.target.value)} /></div>
                </div>
                <div>
                  <label className={labelClass}>Weather Conditions</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {WEATHER_OPTIONS.map(w => (
                      <button key={w} onClick={() => toggleWeather(w)}
                        className={`px-3 py-1.5 rounded-lg text-[0.75rem] font-medium transition-all
                          ${weather.includes(w) ? 'bg-primary/20 text-moss-glow border border-primary/30' : 'bg-card/70 text-granite border border-border/40'}`}>
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={labelClass}>Water Sources</label>
                    <select className={inputClass} value={waterSources} onChange={e => setWaterSources(e.target.value)}>
                      <option value="">Select</option>
                      {WATER_SOURCES.map(w => <option key={w} value={w}>{w}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Bug Level</label>
                    <select className={inputClass} value={bugLevel} onChange={e => setBugLevel(e.target.value)}>
                      <option value="">Select</option>
                      {BUG_LEVELS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Snow/Ice</label>
                    <select className={inputClass} value={snowIce} onChange={e => setSnowIce(e.target.value)}>
                      <option value="">Select</option>
                      {SNOW_ICE.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Photos - only available when editing (need an ID to upload) */}
            {isEdit && (
              <>
                <SectionHeader title="Photos" section="photos" />
                {expandedSections.photos && (
                  <div className="mb-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                      {photos.map((p, i) => (
                        <div key={p.id} className="relative group rounded-xl overflow-hidden aspect-square">
                          <img src={p.photo_url} alt={p.caption || ''} className="w-full h-full object-cover" />
                          {i === 0 && <span className="absolute top-2 left-2 px-2 py-0.5 rounded text-[0.6rem] bg-primary text-primary-foreground">Cover</span>}
                          <button onClick={() => { deletePhoto(p); setPhotos(prev => prev.filter(x => x.id !== p.id)); }}
                            className="absolute top-2 right-2 p-1.5 rounded-lg bg-peak/80 text-danger opacity-0 group-hover:opacity-100 transition-opacity">
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-border/40 text-granite text-[0.85rem] cursor-pointer hover:border-primary/40 transition-colors">
                      <Upload size={16} />
                      {uploading ? 'Uploading...' : 'Upload Photos (max 20)'}
                      <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoUpload} disabled={uploading || photos.length >= 20} />
                    </label>
                  </div>
                )}
              </>
            )}

            {/* Gear */}
            <SectionHeader title="Gear Used" section="gear" />
            {expandedSections.gear && (
              <div className="space-y-4 mb-6">
                <div>
                  <label className={labelClass}>Link Packing List</label>
                  <select className={inputClass} value={packingListId} onChange={e => setPackingListId(e.target.value)}>
                    <option value="">None</option>
                    {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div><label className={labelClass}>Gear Notes</label><textarea className={inputClass + ' min-h-[80px]'} value={gearNotes} onChange={e => setGearNotes(e.target.value)} placeholder="What worked, what didn't..." /></div>
              </div>
            )}

            {/* Trip Notes */}
            <SectionHeader title="Trip Notes" section="notes" />
            {expandedSections.notes && (
              <div className="mb-6">
                <textarea className={inputClass + ' min-h-[150px]'} value={tripNotes} onChange={e => setTripNotes(e.target.value)} placeholder="Write your trip report..." />
              </div>
            )}

            {/* Day-by-Day */}
            <SectionHeader title="Day-by-Day Breakdown" section="days" />
            {expandedSections.days && (
              <div className="mb-6 space-y-3">
                {days.map((day, idx) => (
                  <div key={idx} className="bg-card/70 border border-border/40 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-display font-bold text-[0.95rem]">Day {day.day_number}</h4>
                      <button onClick={() => removeDay(idx)} className="text-granite hover:text-danger"><Trash2 size={14} /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div><label className={labelClass}>Miles</label><input className={inputClass} type="number" step="0.1" value={day.miles || ''} onChange={e => updateDay(idx, 'miles', e.target.value ? Number(e.target.value) : null)} /></div>
                      <div><label className={labelClass}>Camp Location</label><input className={inputClass} value={day.camp_location || ''} onChange={e => updateDay(idx, 'camp_location', e.target.value)} /></div>
                    </div>
                    <div><label className={labelClass}>Notes</label><textarea className={inputClass + ' min-h-[60px]'} value={day.notes || ''} onChange={e => updateDay(idx, 'notes', e.target.value)} /></div>
                  </div>
                ))}
                <button onClick={addDay} className="w-full py-2.5 rounded-lg border-2 border-dashed border-border/40 text-granite text-[0.8rem] font-semibold hover:border-primary/40 hover:text-snow transition-colors">
                  <Plus size={14} className="inline mr-1" /> Add Day
                </button>
              </div>
            )}

            {/* Public toggle + Save */}
            <div className="flex items-center gap-3 py-4 border-t border-border/30">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)}
                  className="w-4 h-4 rounded border-granite bg-transparent checked:bg-moss-glow" />
                <span className="text-[0.85rem]">Make this trip public</span>
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button onClick={() => navigate('/journal')} className="px-5 py-2.5 rounded-lg border border-border/40 bg-card/70 text-snow text-[0.8rem] font-semibold">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-6 py-2.5 rounded-lg bg-gradient-to-br from-moss to-moss-glow text-primary-foreground text-[0.8rem] font-semibold shadow-[0_4px_15px_hsla(140,35%,38%,0.25)] disabled:opacity-50">
                {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Log Trip'}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default JournalForm;

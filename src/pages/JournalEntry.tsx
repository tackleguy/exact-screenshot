import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MountainBackground } from '@/components/layout/MountainBackground';
import { AppHeader } from '@/components/layout/AppHeader';
import { useJournal, type JournalEntry as JournalEntryType, type JournalDay, type JournalPhoto } from '@/hooks/useJournal';
import { StatCard } from '@/components/shared/StatCard';
import { ArrowLeft, Pencil, Star, MapPin, Thermometer, Droplets, Bug, Snowflake, ChevronDown, ChevronUp, Mountain, X } from 'lucide-react';

const JournalEntryPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getEntry, getDays, getPhotos } = useJournal();

  const [entry, setEntry] = useState<JournalEntryType | null>(null);
  const [days, setDays] = useState<JournalDay[]>([]);
  const [photos, setPhotos] = useState<JournalPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [expandedDays, setExpandedDays] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!id) return;
    Promise.all([getEntry(id), getDays(id), getPhotos(id)]).then(([e, d, p]) => {
      setEntry(e);
      setDays(d);
      setPhotos(p);
      setLoading(false);
    });
  }, [id]);

  if (loading || !entry) {
    return (
      <div className="min-h-screen">
        <MountainBackground />
        <div className="relative z-10">
          <AppHeader />
          <div className="flex justify-center py-24"><div className="w-6 h-6 border-2 border-moss border-t-transparent rounded-full animate-spin" /></div>
        </div>
      </div>
    );
  }

  const heroUrl = entry.hero_photo_url || photos[0]?.photo_url;

  return (
    <div className="min-h-screen">
      <MountainBackground />
      <div className="relative z-10">
        <AppHeader />
        <main className="max-w-[900px] mx-auto px-6 lg:px-10 py-8 animate-fade-up">
          <div className="flex items-center justify-between mb-6">
            <button onClick={() => navigate('/journal')} className="flex items-center gap-1.5 text-granite hover:text-snow text-[0.85rem] transition-colors">
              <ArrowLeft size={16} /> Back to Journal
            </button>
            <button onClick={() => navigate(`/journal/${id}/edit`)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/40 bg-card/70 text-snow text-[0.8rem] font-semibold hover:border-border/60">
              <Pencil size={14} /> Edit
            </button>
          </div>

          {/* Hero */}
          <div className="relative rounded-2xl overflow-hidden mb-8 h-[300px]">
            {heroUrl ? (
              <img src={heroUrl} alt={entry.trip_name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-ridge to-peak flex items-center justify-center">
                <Mountain size={64} className="text-granite/20" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-peak via-peak/40 to-transparent" />
            <div className="absolute bottom-6 left-6 right-6">
              <h1 className="font-display text-[2rem] font-bold tracking-tight mb-1">{entry.trip_name}</h1>
              {entry.trail_name && <p className="text-granite flex items-center gap-1"><MapPin size={14} /> {entry.trail_name}</p>}
              {entry.start_date && (
                <p className="text-[0.8rem] text-granite mt-1">
                  {new Date(entry.start_date).toLocaleDateString()} {entry.end_date ? `— ${new Date(entry.end_date).toLocaleDateString()}` : ''}
                </p>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
            {entry.distance_miles && <StatCard value={`${entry.distance_miles}`} label="Miles" sub="distance" colorClass="text-moss-glow" />}
            {entry.elevation_gain_ft && <StatCard value={`${(entry.elevation_gain_ft / 1000).toFixed(1)}k`} label="Elev Gain" sub="feet" colorClass="text-amber" />}
            {entry.hiking_time_hours && <StatCard value={`${entry.hiking_time_hours}`} label="Hours" sub="hiking time" colorClass="text-ice" />}
            {entry.difficulty_rating && (
              <StatCard value={'★'.repeat(entry.difficulty_rating)} label="Difficulty" sub={`${entry.difficulty_rating}/5`} colorClass="text-amber" />
            )}
            {entry.trail_condition && <StatCard value={entry.trail_condition} label="Condition" sub="trail" />}
          </div>

          {/* Climate */}
          {(entry.avg_day_temp_f || entry.weather_conditions?.length > 0 || entry.water_sources || entry.bug_level || entry.snow_ice) && (
            <div className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl p-6 mb-8">
              <h3 className="text-[1.1rem] font-bold mb-4">Climate & Conditions</h3>
              <div className="flex flex-wrap gap-4 mb-4">
                {entry.avg_day_temp_f != null && (
                  <div className="flex items-center gap-1.5 text-[0.85rem]"><Thermometer size={14} className="text-amber" /> Day: {entry.avg_day_temp_f}°F</div>
                )}
                {entry.avg_night_temp_f != null && (
                  <div className="flex items-center gap-1.5 text-[0.85rem]"><Thermometer size={14} className="text-ice" /> Night: {entry.avg_night_temp_f}°F</div>
                )}
                {entry.water_sources && (
                  <div className="flex items-center gap-1.5 text-[0.85rem]"><Droplets size={14} className="text-ice" /> Water: {entry.water_sources}</div>
                )}
                {entry.bug_level && (
                  <div className="flex items-center gap-1.5 text-[0.85rem]"><Bug size={14} className="text-amber" /> Bugs: {entry.bug_level}</div>
                )}
                {entry.snow_ice && (
                  <div className="flex items-center gap-1.5 text-[0.85rem]"><Snowflake size={14} className="text-ice" /> Snow: {entry.snow_ice}</div>
                )}
              </div>
              {entry.weather_conditions?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {entry.weather_conditions.map(w => (
                    <span key={w} className="px-3 py-1 rounded-lg text-[0.75rem] font-medium bg-secondary text-snow">{w}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Photos */}
          {photos.length > 0 && (
            <div className="mb-8">
              <h3 className="text-[1.1rem] font-bold mb-4">Photos</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {photos.map(p => (
                  <div key={p.id} className="rounded-xl overflow-hidden aspect-square cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setLightbox(p.photo_url)}>
                    <img src={p.photo_url} alt={p.caption || ''} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Day-by-day */}
          {days.length > 0 && (
            <div className="mb-8">
              <h3 className="text-[1.1rem] font-bold mb-4">Day-by-Day</h3>
              <div className="space-y-2">
                {days.map(day => (
                  <div key={day.day_number} className="bg-card/70 border border-border/40 rounded-xl overflow-hidden">
                    <button onClick={() => setExpandedDays(prev => ({ ...prev, [day.day_number]: !prev[day.day_number] }))}
                      className="w-full flex items-center justify-between px-5 py-3 text-left">
                      <div className="flex items-center gap-3">
                        <span className="font-display font-bold">Day {day.day_number}</span>
                        {day.miles && <span className="font-mono text-[0.8rem] text-granite">{day.miles} mi</span>}
                        {day.camp_location && <span className="text-[0.8rem] text-granite">⛺ {day.camp_location}</span>}
                      </div>
                      {expandedDays[day.day_number] ? <ChevronUp size={16} className="text-granite" /> : <ChevronDown size={16} className="text-granite" />}
                    </button>
                    {expandedDays[day.day_number] && day.notes && (
                      <div className="px-5 pb-4 text-[0.85rem] text-snow/80 leading-relaxed border-t border-border/30 pt-3">{day.notes}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trip notes */}
          {entry.trip_notes && (
            <div className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl p-6 mb-8">
              <h3 className="text-[1.1rem] font-bold mb-4">Trip Report</h3>
              <div className="text-[0.9rem] text-snow/80 leading-relaxed whitespace-pre-wrap">{entry.trip_notes}</div>
            </div>
          )}

          {/* Gear notes */}
          {entry.gear_notes && (
            <div className="bg-card/70 border border-border/40 rounded-2xl backdrop-blur-xl p-6">
              <h3 className="text-[1.1rem] font-bold mb-4">Gear Notes</h3>
              <div className="text-[0.9rem] text-snow/80 leading-relaxed whitespace-pre-wrap">{entry.gear_notes}</div>
            </div>
          )}

          {/* Lightbox */}
          {lightbox && (
            <div className="fixed inset-0 z-[300] bg-peak/95 flex items-center justify-center" onClick={() => setLightbox(null)}>
              <button className="absolute top-6 right-6 text-snow hover:text-granite"><X size={24} /></button>
              <img src={lightbox} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" />
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default JournalEntryPage;

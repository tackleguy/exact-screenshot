import { type TabId } from '@/lib/data';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { LogOut, CreditCard, User } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

const TABS: { id: TabId; label: string }[] = [
  { id: 'gear', label: 'Gear Locker' },
  { id: 'packing', label: 'Packing List' },
  { id: 'weight', label: 'Weight Analysis' },
  { id: 'shopping', label: 'Shopping List' },
  { id: 'trails', label: 'Trail Database' },
];

interface Props {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function AppHeader({ activeTab, onTabChange }: Props) {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 backdrop-blur-xl bg-background/60 px-6 lg:px-10 py-4 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3">
        <svg className="w-9 h-9 shrink-0" viewBox="0 0 36 36" fill="hsl(var(--moss-glow))" style={{ filter: 'drop-shadow(0 0 8px hsla(140,35%,48%,0.3))' }}>
          <path d="M18 2 L6 28 L18 22 L30 28 Z"/>
          <path d="M18 8 L12 24 L18 20 L24 24 Z" fill="hsla(30,20%,92%,0.15)"/>
        </svg>
        <div>
          <h1 className="text-[1.6rem] font-black leading-none tracking-tight bg-gradient-to-br from-snow to-ice bg-clip-text text-transparent">
            TrailPack
          </h1>
          <span className="font-mono text-[0.65rem] text-granite tracking-[0.15em] uppercase opacity-70">
            Precision Gear Management
          </span>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`relative px-4 py-2 rounded-lg text-[0.85rem] font-medium transition-all duration-300
              ${activeTab === tab.id
                ? 'text-snow bg-primary/15 border border-primary/30'
                : 'text-granite border border-transparent hover:text-snow hover:bg-foreground/5'
              }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-[-1px] left-[30%] right-[30%] h-0.5 bg-moss-glow rounded-full" />
            )}
          </button>
        ))}
      </nav>

      {user && (
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/50 border border-border/30 text-sm text-snow hover:bg-secondary/70 transition-colors"
          >
            <User size={14} className="text-granite" />
            <span className="max-w-[120px] truncate">{profile?.display_name || user.email?.split('@')[0]}</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-ridge border border-border/50 rounded-xl shadow-xl overflow-hidden z-50">
              <button onClick={() => { navigate('/pricing'); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-snow/80 hover:bg-secondary/50 transition-colors">
                <CreditCard size={14} /> Plans & Pricing
              </button>
              <button onClick={handleSignOut} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-danger hover:bg-secondary/50 transition-colors">
                <LogOut size={14} /> Sign Out
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

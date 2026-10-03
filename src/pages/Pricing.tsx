import { useState } from 'react';
import { MountainBackground } from '@/components/layout/MountainBackground';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { Check, ArrowLeft } from 'lucide-react';

type BillingCycle = 'monthly' | 'yearly';

const tiers = [
  {
    id: 'base_camp' as const,
    name: 'Base Camp',
    monthlyPrice: 0,
    yearlyPrice: 0,
    highlight: null,
    features: [
      'Community access',
      'Browse community shared lists',
      'Trail database (view-only)',
      'Basic weight stats',
    ],
  },
  {
    id: 'summit' as const,
    name: 'Summit',
    monthlyPrice: 6.99,
    yearlyPrice: 59.99,
    highlight: 'moss',
    features: [
      'Everything in Base Camp',
      '5 packing lists per month',
      '3 AI-generated shopping lists per month',
      'Full weight charts (donut, bar, top 5)',
      'Trail favorites & notes',
      'Unlimited gear items',
      'Unit toggle (oz/g/lb)',
      'No watermark',
    ],
  },
  {
    id: 'thru_hiker' as const,
    name: 'Thru-Hiker',
    monthlyPrice: 12.99,
    yearlyPrice: 109.99,
    highlight: 'amber',
    features: [
      'Everything in Summit',
      'Unlimited packing lists',
      'Unlimited AI shopping lists',
      'CSV & PDF export',
      'AI Pack Optimizer',
      'Custom categories',
      'Gear comparison',
      'Trip planner',
      'Gear wear tracking',
      'Advanced analytics',
      'API access',
    ],
  },
];

const Pricing = () => {
  const { user, profile, refreshProfile } = useAuth();
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const [loading, setLoading] = useState<string | null>(null);

  const handleSelect = async (tierId: 'base_camp' | 'summit' | 'thru_hiker') => {
    if (!user) {
      toast.error('Please sign in first');
      return;
    }
    if (profile?.tier === tierId) return;
    setLoading(tierId);
    const { error } = await supabase
      .from('profiles')
      .update({ tier: tierId })
      .eq('user_id', user.id);
    if (error) {
      toast.error('Failed to update plan');
    } else {
      toast.success(`Switched to ${tiers.find(t => t.id === tierId)?.name}!`);
      await refreshProfile();
    }
    setLoading(null);
  };

  const yearlyDiscount = Math.round((1 - 59.99 / (6.99 * 12)) * 100);

  return (
    <div className="min-h-screen">
      <MountainBackground />
      <div className="relative z-10 max-w-6xl mx-auto px-6 py-12">
        <Link to={user ? '/dashboard' : '/'} className="inline-flex items-center gap-1 text-sm text-granite hover:text-snow transition-colors mb-8">
          <ArrowLeft size={14} /> Back
        </Link>

        <div className="text-center mb-10 animate-fade-up">
          <h1 className="font-display text-4xl font-bold tracking-tight mb-2">Choose Your Trail</h1>
          <p className="text-granite text-sm max-w-md mx-auto">Pick the plan that matches your ambition. Upgrade or downgrade anytime.</p>
        </div>

        {/* Billing toggle */}
        <div className="flex items-center justify-center gap-3 mb-10 animate-fade-up">
          <span className={`text-sm font-body ${billing === 'monthly' ? 'text-snow' : 'text-granite'}`}>Monthly</span>
          <button
            onClick={() => setBilling(b => b === 'monthly' ? 'yearly' : 'monthly')}
            className="relative w-12 h-6 rounded-full bg-secondary transition-colors"
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-moss transition-transform ${billing === 'yearly' ? 'translate-x-6' : 'translate-x-0.5'}`} />
          </button>
          <span className={`text-sm font-body ${billing === 'yearly' ? 'text-snow' : 'text-granite'}`}>Yearly</span>
          {billing === 'yearly' && (
            <span className="text-[0.65rem] font-mono font-medium bg-moss/20 text-moss-glow px-2 py-0.5 rounded-md">
              ~{yearlyDiscount}% off
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 animate-fade-up">
          {tiers.map(tier => {
            const isCurrent = profile?.tier === tier.id;
            const price = billing === 'monthly' ? tier.monthlyPrice : tier.yearlyPrice;
            const borderColor = tier.highlight === 'moss' ? 'border-moss/60' : tier.highlight === 'amber' ? 'border-amber/60' : 'border-border/40';
            const badgeColor = tier.highlight === 'moss' ? 'bg-moss/20 text-moss-glow' : tier.highlight === 'amber' ? 'bg-amber/20 text-amber-glow' : '';

            return (
              <div key={tier.id} className={`relative bg-ridge/60 backdrop-blur-xl border ${borderColor} rounded-2xl p-6 flex flex-col transition-all hover:border-opacity-80`}>
                {tier.highlight === 'moss' && (
                  <div className={`absolute -top-3 left-1/2 -translate-x-1/2 text-[0.6rem] font-mono font-semibold px-3 py-0.5 rounded-full ${badgeColor}`}>
                    Most Popular
                  </div>
                )}
                <h3 className="font-display text-xl font-bold mb-1">{tier.name}</h3>
                <div className="flex items-baseline gap-1 mb-5">
                  <span className="font-mono text-3xl font-medium">${price === 0 ? '0' : price.toFixed(2)}</span>
                  {price > 0 && <span className="text-granite text-xs">/{billing === 'monthly' ? 'mo' : 'yr'}</span>}
                  {price === 0 && <span className="text-granite text-xs">forever</span>}
                </div>
                <ul className="flex-1 space-y-2.5 mb-6">
                  {tier.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm text-snow/80">
                      <Check size={14} className={`mt-0.5 shrink-0 ${tier.highlight === 'amber' ? 'text-amber' : 'text-moss'}`} />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => handleSelect(tier.id)}
                  disabled={isCurrent || loading === tier.id}
                  className={`w-full font-body font-semibold text-sm py-2.5 rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 ${
                    isCurrent
                      ? 'bg-secondary text-snow/60 cursor-default'
                      : tier.highlight === 'amber'
                        ? 'bg-amber text-peak hover:bg-amber-glow'
                        : 'bg-primary text-primary-foreground hover:bg-primary/90'
                  }`}
                >
                  {loading === tier.id ? 'Updating…' : isCurrent ? 'Current Plan' : tier.monthlyPrice === 0 ? 'Get Started' : 'Upgrade'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Pricing;

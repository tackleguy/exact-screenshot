import { Link } from 'react-router-dom';
import { MountainBackground } from '@/components/layout/MountainBackground';
import { Check, Weight, ListChecks, Mountain } from 'lucide-react';

const features = [
  {
    icon: Weight,
    title: 'Precision Weight Tracking',
    desc: 'Track every ounce across your entire kit with smart unit conversion and detailed category breakdowns.',
  },
  {
    icon: ListChecks,
    title: 'Smart Packing Lists',
    desc: 'Build trip-specific checklists from your gear locker. Never forget a critical item again.',
  },
  {
    icon: Mountain,
    title: 'Trail Database',
    desc: 'Browse 30+ curated trails worldwide with distance, elevation, difficulty, and seasonal intel.',
  },
];

const tiers = [
  {
    name: 'Base Camp',
    price: 'Free',
    period: 'forever',
    highlight: null,
    features: ['30 gear items', '1 packing list', 'Basic weight stats', 'Trail database (view-only)'],
  },
  {
    name: 'Summit',
    price: '$6.99',
    period: '/mo',
    highlight: 'moss',
    badge: 'Most Popular',
    features: ['Unlimited gear & lists', 'Full weight charts', 'Trail favorites & notes', 'CSV export'],
  },
  {
    name: 'Thru-Hiker',
    price: '$12.99',
    period: '/mo',
    highlight: 'amber',
    features: ['Everything in Summit', 'AI Pack Optimizer', 'Community shared lists', 'Advanced analytics'],
  },
];

const Home = () => {
  return (
    <div className="min-h-screen">
      <MountainBackground />
      <div className="relative z-10">
        {/* Header */}
        <header className="flex items-center justify-between px-6 lg:px-10 py-5">
          <div className="flex items-center gap-3">
            <svg className="w-8 h-8 shrink-0" viewBox="0 0 36 36" fill="hsl(var(--moss-glow))" style={{ filter: 'drop-shadow(0 0 8px hsla(140,35%,48%,0.3))' }}>
              <path d="M18 2 L6 28 L18 22 L30 28 Z" />
              <path d="M18 8 L12 24 L18 20 L24 24 Z" fill="hsla(30,20%,92%,0.15)" />
            </svg>
            <span className="font-display text-xl font-bold tracking-tight bg-gradient-to-br from-snow to-ice bg-clip-text text-transparent">
              TrailPack
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="text-sm font-body text-granite hover:text-snow transition-colors px-4 py-2"
            >
              Sign In
            </Link>
            <Link
              to="/signup"
              className="text-sm font-body font-semibold bg-primary text-primary-foreground px-5 py-2 rounded-lg hover:bg-primary/90 transition-all active:scale-[0.98]"
            >
              Get Started Free
            </Link>
          </div>
        </header>

        {/* Hero */}
        <section className="max-w-4xl mx-auto px-6 pt-20 pb-24 text-center animate-fade-up">
          <h1 className="font-display text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
            Pack Smarter.{' '}
            <span className="bg-gradient-to-r from-moss to-moss-glow bg-clip-text text-transparent">Hike Lighter.</span>{' '}
            Go Further.
          </h1>
          <p className="text-granite text-lg max-w-2xl mx-auto mb-10 leading-relaxed">
            The precision gear management platform built for backpackers and thru-hikers.
            Track weight, build packing lists, and discover trails — all in one place.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link
              to="/signup"
              className="font-body font-semibold text-sm bg-primary text-primary-foreground px-8 py-3 rounded-lg hover:bg-primary/90 transition-all active:scale-[0.98]"
            >
              Get Started Free
            </Link>
            <Link
              to="/login"
              className="font-body font-medium text-sm text-snow border border-border/40 px-8 py-3 rounded-lg hover:bg-foreground/5 transition-all"
            >
              Sign In
            </Link>
          </div>
        </section>

        {/* Features */}
        <section className="max-w-5xl mx-auto px-6 pb-24">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {features.map((f) => (
              <div
                key={f.title}
                className="bg-ridge/50 backdrop-blur-xl border border-border/30 rounded-2xl p-6 hover:border-moss/30 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-moss/15 flex items-center justify-center mb-4">
                  <f.icon size={20} className="text-moss-glow" />
                </div>
                <h3 className="font-display text-lg font-bold mb-2">{f.title}</h3>
                <p className="text-granite text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section className="max-w-5xl mx-auto px-6 pb-24">
          <div className="text-center mb-10">
            <h2 className="font-display text-3xl font-bold tracking-tight mb-2">Choose Your Trail</h2>
            <p className="text-granite text-sm">Pick the plan that matches your ambition.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {tiers.map((tier) => {
              const borderColor =
                tier.highlight === 'moss'
                  ? 'border-moss/60'
                  : tier.highlight === 'amber'
                    ? 'border-amber/60'
                    : 'border-border/40';
              return (
                <div
                  key={tier.name}
                  className={`relative bg-ridge/50 backdrop-blur-xl border ${borderColor} rounded-2xl p-6 flex flex-col`}
                >
                  {tier.badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[0.6rem] font-mono font-semibold px-3 py-0.5 rounded-full bg-moss/20 text-moss-glow">
                      {tier.badge}
                    </div>
                  )}
                  <h3 className="font-display text-xl font-bold mb-1">{tier.name}</h3>
                  <div className="flex items-baseline gap-1 mb-5">
                    <span className="font-mono text-3xl font-medium">{tier.price}</span>
                    <span className="text-granite text-xs">{tier.period}</span>
                  </div>
                  <ul className="flex-1 space-y-2.5 mb-6">
                    {tier.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-snow/80">
                        <Check size={14} className={`mt-0.5 shrink-0 ${tier.highlight === 'amber' ? 'text-amber' : 'text-moss'}`} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/signup"
                    className={`w-full text-center font-body font-semibold text-sm py-2.5 rounded-lg transition-all active:scale-[0.98] ${
                      tier.highlight === 'amber'
                        ? 'bg-amber text-peak hover:bg-amber-glow'
                        : 'bg-primary text-primary-foreground hover:bg-primary/90'
                    }`}
                  >
                    Get Started
                  </Link>
                </div>
              );
            })}
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border/30 px-6 py-8">
          <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-granite">
            <span>© {new Date().getFullYear()} TrailPack. All rights reserved.</span>
            <div className="flex gap-6">
              <span className="hover:text-snow transition-colors cursor-pointer">About</span>
              <span className="hover:text-snow transition-colors cursor-pointer">Privacy</span>
              <span className="hover:text-snow transition-colors cursor-pointer">Terms</span>
              <span className="hover:text-snow transition-colors cursor-pointer">Contact</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Home;

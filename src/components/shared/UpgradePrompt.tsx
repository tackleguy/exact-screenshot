import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';

interface Props {
  feature: string;
  requiredTier: string;
  message?: string;
}

export function UpgradePrompt({ feature, requiredTier, message }: Props) {
  return (
    <div className="animate-fade-up flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-secondary/50 border border-border/40 flex items-center justify-center mb-6">
        <Lock size={28} className="text-granite" />
      </div>
      <h3 className="font-display text-xl font-bold mb-2">{feature}</h3>
      <p className="text-granite text-sm max-w-md mb-6">
        {message || `This feature is available on the ${requiredTier} plan and above. Upgrade to unlock it.`}
      </p>
      <Link
        to="/pricing"
        className="px-6 py-2.5 rounded-lg bg-gradient-to-br from-moss to-moss-glow text-primary-foreground text-sm font-semibold shadow-[0_4px_15px_hsla(140,35%,38%,0.25)] transition-all hover:shadow-[0_6px_20px_hsla(140,35%,38%,0.4)] hover:-translate-y-px active:scale-[0.97]"
      >
        Upgrade to {requiredTier}
      </Link>
    </div>
  );
}

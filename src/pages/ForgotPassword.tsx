import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { toast } from 'sonner';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    setSent(true);
  };

  const inputClass =
    'w-full bg-peak/60 border border-border/40 text-snow font-body text-sm py-2.5 px-3 rounded-lg outline-none transition-colors focus:border-moss/60 focus:ring-1 focus:ring-moss/30 placeholder:text-granite/50';

  return (
    <AuthLayout>
      <h2 className="font-display text-xl font-bold text-center mb-2">Reset your password</h2>
      <p className="text-granite text-sm text-center mb-6">Enter your email and we'll send you reset instructions.</p>

      {sent ? (
        <div className="text-center space-y-4">
          <div className="bg-moss/10 border border-moss/30 rounded-lg p-4">
            <p className="text-sm text-snow/80">
              If an account exists for that email, we've sent password reset instructions.
            </p>
          </div>
          <Link to="/login" className="inline-block text-sm text-moss hover:text-moss-glow transition-colors font-medium">
            Back to Sign In
          </Link>
        </div>
      ) : (
        <>
          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <label className="block text-sm font-body text-snow/80 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={inputClass}
                placeholder="you@example.com"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground font-body font-semibold text-sm py-2.5 rounded-lg transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'Sending…' : 'Send Reset Link'}
            </button>
          </form>
          <p className="text-center text-sm text-granite mt-6">
            <Link to="/login" className="text-moss hover:text-moss-glow transition-colors font-medium">
              Back to Sign In
            </Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
};

export default ForgotPassword;

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { toast } from 'sonner';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Check your email for a password reset link.');
    }
  };

  return (
    <AuthLayout>
      <h2 className="font-display text-xl font-bold text-center mb-2">Reset Password</h2>
      <p className="text-granite text-sm text-center mb-6">Enter your email and we'll send you a reset link.</p>
      <form onSubmit={handleReset} className="space-y-4">
        <div>
          <label className="block text-sm font-body text-snow/80 mb-1.5">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
            className="w-full bg-peak/60 border border-border/40 text-snow font-body text-sm py-2.5 px-3 rounded-lg outline-none transition-colors focus:border-moss/60 focus:ring-1 focus:ring-moss/30 placeholder:text-granite/50"
            placeholder="you@example.com" />
        </div>
        <button type="submit" disabled={loading} className="w-full bg-primary text-primary-foreground font-body font-semibold text-sm py-2.5 rounded-lg transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">
          {loading ? 'Sending…' : 'Send Reset Link'}
        </button>
      </form>
      <p className="text-center text-sm text-granite mt-6">
        <Link to="/login" className="text-moss hover:text-moss-glow transition-colors font-medium">Back to Sign In</Link>
      </p>
    </AuthLayout>
  );
};

export default ForgotPassword;

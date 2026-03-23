import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { toast } from 'sonner';

const ResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [valid, setValid] = useState(true);

  useEffect(() => {
    // Supabase sends recovery tokens in the URL hash or as query params
    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);
    const hasRecovery = hash.includes('type=recovery') || params.get('type') === 'recovery';
    if (!hasRecovery) {
      // Also check if there's an access_token (some flows put it in hash)
      if (!hash.includes('access_token')) {
        setValid(false);
      }
    }
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Password updated! Please sign in.');
      await supabase.auth.signOut();
      navigate('/login');
    }
  };

  const inputClass =
    'w-full bg-peak/60 border border-border/40 text-snow font-body text-sm py-2.5 px-3 rounded-lg outline-none transition-colors focus:border-moss/60 focus:ring-1 focus:ring-moss/30 placeholder:text-granite/50';

  if (!valid) {
    return (
      <AuthLayout>
        <div className="text-center space-y-4">
          <h2 className="font-display text-xl font-bold">Invalid Reset Link</h2>
          <p className="text-granite text-sm">This password reset link is invalid or has expired.</p>
          <button
            onClick={() => navigate('/forgot-password')}
            className="text-sm text-moss hover:text-moss-glow transition-colors font-medium"
          >
            Request a new reset link
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h2 className="font-display text-xl font-bold text-center mb-6">Choose a new password</h2>
      <form onSubmit={handleUpdate} className="space-y-4">
        <div>
          <label className="block text-sm font-body text-snow/80 mb-1.5">New Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={inputClass}
            placeholder="••••••••"
          />
        </div>
        <div>
          <label className="block text-sm font-body text-snow/80 mb-1.5">Confirm Password</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            className={inputClass}
            placeholder="••••••••"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary text-primary-foreground font-body font-semibold text-sm py-2.5 rounded-lg transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? 'Updating…' : 'Update Password'}
        </button>
      </form>
    </AuthLayout>
  );
};

export default ResetPassword;

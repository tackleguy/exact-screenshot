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

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes('type=recovery')) {
      toast.error('Invalid or expired reset link.');
      navigate('/login');
    }
  }, [navigate]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Password updated!');
      navigate('/dashboard');
    }
  };

  const inputClass = "w-full bg-peak/60 border border-border/40 text-snow font-body text-sm py-2.5 px-3 rounded-lg outline-none transition-colors focus:border-moss/60 focus:ring-1 focus:ring-moss/30 placeholder:text-granite/50";

  return (
    <AuthLayout>
      <h2 className="font-display text-xl font-bold text-center mb-6">Set New Password</h2>
      <form onSubmit={handleUpdate} className="space-y-4">
        <div>
          <label className="block text-sm font-body text-snow/80 mb-1.5">New Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className={inputClass} placeholder="••••••••" />
        </div>
        <div>
          <label className="block text-sm font-body text-snow/80 mb-1.5">Confirm Password</label>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required className={inputClass} placeholder="••••••••" />
        </div>
        <button type="submit" disabled={loading} className="w-full bg-primary text-primary-foreground font-body font-semibold text-sm py-2.5 rounded-lg transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">
          {loading ? 'Updating…' : 'Update Password'}
        </button>
      </form>
    </AuthLayout>
  );
};

export default ResetPassword;

import { useState } from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const Signup = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirect authenticated users to dashboard
  if (!authLoading && user) return <Navigate to="/dashboard" replace />;

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: window.location.origin + '/dashboard',
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Account created! Check your email to confirm.');
      navigate('/dashboard');
    }
  };

  const inputClass =
    'w-full bg-peak/60 border border-border/40 text-snow font-body text-sm py-2.5 px-3 rounded-lg outline-none transition-colors focus:border-moss/60 focus:ring-1 focus:ring-moss/30 placeholder:text-granite/50';

  return (
    <AuthLayout>
      <h2 className="font-display text-xl font-bold text-center mb-6">Create your TrailPack account</h2>
      <form onSubmit={handleSignup} className="space-y-4">
        <div>
          <label className="block text-sm font-body text-snow/80 mb-1.5">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className={inputClass}
            placeholder="Trail Runner"
          />
        </div>
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
        <div>
          <label className="block text-sm font-body text-snow/80 mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
          {loading ? 'Creating account…' : 'Create Account'}
        </button>
      </form>

      <p className="text-center text-sm text-granite mt-6">
        Already have an account?{' '}
        <Link to="/login" className="text-moss hover:text-moss-glow transition-colors font-medium">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
};

export default Signup;

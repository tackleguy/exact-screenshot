import { useState } from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const Login = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);

  // Redirect authenticated users to dashboard
  if (!authLoading && user) return <Navigate to="/dashboard" replace />;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // If "Remember me" is unchecked, we clear session on tab/browser close
    // by removing the persisted session after sign-in completes.
    // Supabase always persists to localStorage; the best we can do is
    // move the session to sessionStorage when rememberMe is off.
    if (!rememberMe) {
      // Signal to clear localStorage session after auth completes
      sessionStorage.setItem('trailpack_session_only', 'true');
    } else {
      sessionStorage.removeItem('trailpack_session_only');
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      navigate('/dashboard');
    }
  };

  const inputClass =
    'w-full bg-peak/60 border border-border/40 text-snow font-body text-sm py-2.5 px-3 rounded-lg outline-none transition-colors focus:border-moss/60 focus:ring-1 focus:ring-moss/30 placeholder:text-granite/50';

  return (
    <AuthLayout>
      <h2 className="font-display text-xl font-bold text-center mb-6">Welcome back</h2>
      <form onSubmit={handleLogin} className="space-y-4">
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
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="w-4 h-4 rounded border-border/40 bg-peak/60 text-moss accent-moss focus:ring-moss/30"
            />
            <span className="text-sm text-snow/70">Remember me</span>
          </label>
          <Link to="/forgot-password" className="text-xs text-moss hover:text-moss-glow transition-colors">
            Forgot password?
          </Link>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary text-primary-foreground font-body font-semibold text-sm py-2.5 rounded-lg transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>

      <p className="text-center text-sm text-granite mt-6">
        Don't have an account?{' '}
        <Link to="/signup" className="text-moss hover:text-moss-glow transition-colors font-medium">
          Sign up
        </Link>
      </p>
    </AuthLayout>
  );
};

export default Login;

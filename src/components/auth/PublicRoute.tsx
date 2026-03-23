import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-moss border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Authenticated users go to dashboard
  if (user) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}

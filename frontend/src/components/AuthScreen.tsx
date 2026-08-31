import { useState, useEffect } from 'react';
import { Terminal, Lock, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import type { User } from '../App';
import { socket } from '../lib/socket';

interface AuthScreenProps {
  onLogin: (user: User) => void;
}

export const AuthScreen = ({ onLogin }: AuthScreenProps) => {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  
  const [isVerifying, setIsVerifying] = useState(false);
  const [targetProblem, setTargetProblem] = useState('');
  const [error, setError] = useState('');

    useEffect(() => {
        if (!socket.connected) {
            socket.connect();
      }
    let pollInterval: ReturnType<typeof setInterval>;

    if (isVerifying && handle && password && !isLoginMode) {
      pollInterval = setInterval(async () => {
        try {
          const response = await api.post('/auth/register/confirm', { handle, password });
          if (response.data.status === 'success') {
            const verifiedUser = response.data.user;
            localStorage.setItem('arena_user', JSON.stringify(verifiedUser));
            clearInterval(pollInterval);
            onLogin(verifiedUser);
          }
        } catch (err: any) {
          if (err.response?.status !== 400) console.error("Polling error", err);
        }
      }, 5000);
    }

    return () => clearInterval(pollInterval);
  }, [isVerifying, handle, password, isLoginMode, onLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handle || !password) return;
    setError('');

    if (isLoginMode) {
      try {
        const response = await api.post('/auth/login', { handle, password });
        if (response.data.status === 'success') {
          const user = response.data.user;
          localStorage.setItem('arena_user', JSON.stringify(user));
          onLogin(user);
        }
      } catch (err: any) {
        setError(err.response?.data?.error || 'Login failed.');
      }
    } else {
      setIsVerifying(true);
      try {
        const response = await api.post('/auth/register/request', { handle });
        setTargetProblem(response.data.data.targetProblem);
      } catch (err: any) {
        setIsVerifying(false);
        setError(err.response?.data?.error || 'Registration request failed.');
      }
    }
  };

  return (
    <section className="flex-1 flex flex-col items-center justify-center p-4 h-full w-full">
      <div className="glass-panel w-full max-w-md rounded-xl p-8 flex flex-col gap-6 relative overflow-hidden bg-surface/40 backdrop-blur-xl border border-white/10 shadow-2xl">
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-primary/20 rounded-full blur-[40px]"></div>
        
        <div className="text-center z-10">
          <h1 className="text-3xl font-bold text-primary tracking-tighter drop-shadow-[0_0_8px_rgba(59,130,246,0.5)] mb-2">ARENA</h1>
          <p className="font-mono text-xs text-gray-400 uppercase tracking-widest">
            {isLoginMode ? 'Access Uplink' : 'New User Registration'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 z-10">
          <div className="relative">
            <label className="font-mono text-xs text-gray-400 mb-1 block">Codeforces Handle</label>
            <input 
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              disabled={isVerifying}
              className="w-full bg-surface/80 border border-white/10 rounded-lg px-4 py-3 font-mono text-primary focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-gray-600 disabled:opacity-50"
              placeholder="e.g. tourist"
            />
            <Terminal className="absolute right-3 top-[34px] w-5 h-5 text-primary opacity-50" />
          </div>

          <div className="relative">
            <label className="font-mono text-xs text-gray-400 mb-1 block">Password</label>
            <input 
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isVerifying}
              className="w-full bg-surface/80 border border-white/10 rounded-lg px-4 py-3 font-mono text-primary focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-gray-600 disabled:opacity-50"
              placeholder="••••••••"
            />
            <Lock className="absolute right-3 top-[34px] w-5 h-5 text-primary opacity-50" />
          </div>
          
          {error && <div className="text-danger font-mono text-xs text-center">{error}</div>}

          <button 
            type="submit"
            disabled={isVerifying}
            className="w-full bg-primary text-background font-mono font-bold text-sm py-3 rounded-lg hover:bg-blue-400 transition-colors shadow-[0_0_15px_rgba(59,130,246,0.3)] mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoginMode ? 'LOGIN' : 'INITIATE REGISTRATION'}
          </button>
        </form>

        {!isVerifying && (
          <button 
            onClick={() => { setIsLoginMode(!isLoginMode); setError(''); }}
            className="text-gray-400 hover:text-primary font-mono text-xs text-center transition-colors z-10"
          >
            {isLoginMode ? "Don't have an account? Register" : "Already registered? Login"}
          </button>
        )}

        {!isLoginMode && isVerifying && targetProblem && (
          <div className="mt-2 pt-6 border-t border-white/10 flex flex-col items-center gap-3 z-10">
            <div className="flex items-center gap-2 text-primary font-mono text-xs animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>AWAITING VERIFICATION</span>
            </div>
            <p className="font-mono text-gray-400 text-center text-sm">
              Submit a <span className="text-danger">Compilation Error</span> for Problem <span className="text-primary font-bold">{targetProblem}</span> to link this handle.
            </p>
          </div>
        )}
      </div>
    </section>
  );
};
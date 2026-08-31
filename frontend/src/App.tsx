import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthScreen } from './components/AuthScreen';
import { LobbyScreen } from './components/LobbyScreen';
import { ArenaScreen } from './components/ArenaScreen';
import { ShootoutScreen } from './components/ShootoutScreen'; 

export interface User {
  id?: string;
  cfHandle: string;
  rating: number;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    const savedUser = localStorage.getItem('arena_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setIsCheckingAuth(false);
  }, []);

  if (isCheckingAuth) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden bg-background">
        <main className="w-full max-w-6xl p-6 z-10 flex-1 flex">
          <Routes>
            <Route 
              path="/auth" 
              element={!user ? <AuthScreen onLogin={setUser} /> : <Navigate to="/lobby" replace />} 
            />
            <Route 
              path="/lobby" 
              element={user ? <LobbyScreen user={user} onLogout={() => setUser(null)} /> : <Navigate to="/auth" replace />} 
            />
            <Route 
              path="/arena" 
              element={user ? <ArenaScreen user={user} onLogout={() => setUser(null)} /> : <Navigate to="/auth" replace />} 
            />
            <Route 
              path="/shootout" 
              element={user ? <ShootoutScreen user={user} onLogout={() => setUser(null)} /> : <Navigate to="/auth" replace />} 
            />
            <Route path="*" element={<Navigate to={user ? "/lobby" : "/auth"} replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TerminalSquare, Flag, Lock } from 'lucide-react';
import { socket } from '../lib/socket';
import type { User } from '../App';

interface ArenaScreenProps {
  user: User;
  onLogout: () => void;
}

interface GameOverData {
  winner: string;
  reason?: string;
  newRatingP1?: number;
  newRatingP2?: number;
}

export const ArenaScreen = ({ user }: ArenaScreenProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  
  // 1. STATE PERSISTENCE: Check location state first, fallback to localStorage
  const [matchData] = useState(() => {
    const stateData = location.state?.matchData;
    if (stateData) {
      localStorage.setItem('active_match', JSON.stringify(stateData));
      return stateData;
    }
    return JSON.parse(localStorage.getItem('active_match') || 'null');
  });

  // 2. SOCKET RECONNECTION HOOK
  useEffect(() => {
    if (!matchData) {
      navigate('/lobby');
      return;
    }
    
    if (!socket.connected) socket.connect();

    // CRITICAL FIX: Tell the backend to put us back in our routing room if we refreshed!
    if (user?.cfHandle) {
      socket.emit('reconnect_user', user.cfHandle);
    }
  }, [matchData, navigate, user?.cfHandle]);

  const opponentHandle = matchData?.p1 === user.cfHandle ? matchData.p2 : matchData?.p1;
  
  const [grid] = useState<string[]>(matchData?.grid || []);
  const [lockedProblem, setLockedProblem] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  
  // 3. GRID STATE: Track who owns which problem via localStorage
  const [claims, setClaims] = useState<Record<string, string>>(() => {
    return JSON.parse(localStorage.getItem('arena_claims') || '{}');
  });

  const [feed, setFeed] = useState<string[]>([
    `[SYS] Match initiated against ${opponentHandle}.`,
    `[SYS] Select a problem from the grid to lock in.`
  ]);

  // 4. GAME ENGINE LISTENERS
  useEffect(() => {
    socket.on('game_over', (data: GameOverData) => {
      setWinner(data.winner);
      setFeed(prev => [...prev, `[SYS] ${data.winner} won the match! ${data.reason || ''}`]);
      
      // Clear game memory so next game starts fresh
      localStorage.removeItem('active_match'); 
      localStorage.removeItem('arena_claims'); 
      
      const storedUser = JSON.parse(localStorage.getItem('arena_user') || '{}');
      const newRating = data.newRatingP1 || data.newRatingP2; 
      if (newRating) {
        localStorage.setItem('arena_user', JSON.stringify({ ...storedUser, rating: newRating }));
      }
    });

    socket.on('opponent_forfeited', () => {
      setWinner(user.cfHandle);
      setFeed(prev => [...prev, `[SYS] Opponent forfeited the match. You win!`]);
      localStorage.removeItem('active_match');
      localStorage.removeItem('arena_claims');
    });

    // Listen for squares being claimed by the Daemon
    socket.on('square_claimed', (data: { problem: string; handle: string }) => {
      setClaims(prev => {
        const updatedClaims = { ...prev, [data.problem]: data.handle };
        localStorage.setItem('arena_claims', JSON.stringify(updatedClaims));
        return updatedClaims;
      });
      
      setFeed(prev => [...prev, `[SYS] ${data.handle} claimed problem ${data.problem}!`]);
      
      // Release our lock if we successfully claimed it
      if (data.handle === user.cfHandle) {
        setLockedProblem(null);
      }
    });

    return () => {
      socket.off('game_over');
      socket.off('opponent_forfeited');
      socket.off('square_claimed');
    };
  }, [user.cfHandle]);

  const handleLockProblem = (problem: string) => {
    // Prevent locking if game is over OR if the square is already claimed!
    if (lockedProblem === problem || winner || claims[problem]) return; 
    
    setLockedProblem(problem);
    setFeed(prev => [...prev, `[SYS] You locked in problem ${problem}.`]);
    socket.emit('lock_problem', { roomId: matchData.roomId, problem, handle: user.cfHandle });
  };

  const handleResign = () => {
    if (window.confirm("Are you sure you want to forfeit this match? You will lose Elo.")) {
      // Tell backend we quit
      socket.emit('forfeit_match', { roomId: matchData.roomId, handle: user.cfHandle });
      
      // Clear our local memory immediately
      localStorage.removeItem('active_match');
      localStorage.removeItem('arena_claims');
      
      // Update UI instantly so the user knows they lost, let backend's broadcast finish it
      setWinner(opponentHandle); 
      setFeed(prev => [...prev, `[SYS] You forfeited the match.`]);
    }
  };

  if (!matchData) return null;

  return (
    <section className="flex-1 flex flex-col relative w-full h-full max-w-6xl mx-auto overflow-hidden pt-4">
      
      {/* VS Header */}
      <div className="bg-surface/40 backdrop-blur-xl border border-white/10 w-full flex justify-between items-center px-4 md:px-8 py-3 rounded-xl mb-6 shadow-lg">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-surface border border-primary flex items-center justify-center font-bold text-primary">P1</div>
          <div>
            <div className="font-bold text-lg text-primary leading-none">{user.cfHandle}</div>
            <div className="font-mono text-xs text-gray-400 mt-1">ELO {user.rating}</div>
          </div>
        </div>
        <div className="font-bold text-2xl text-gray-600 italic px-4">VS</div>
        <div className="flex items-center gap-4 text-right">
          <div>
            <div className="font-bold text-lg text-fuchsia-400 leading-none">{opponentHandle}</div>
            <div className="font-mono text-xs text-gray-400 mt-1">OPPONENT</div>
          </div>
          <div className="w-12 h-12 rounded-lg bg-surface border border-fuchsia-400 flex items-center justify-center font-bold text-fuchsia-400">P2</div>
        </div>
        
        {/* Forfeit Flag Button */}
        <button 
          onClick={handleResign} 
          disabled={!!winner} 
          title="Forfeit Match"
          className="absolute -top-3 -right-3 bg-surface border border-danger text-danger p-2 rounded-full hover:bg-danger hover:text-white transition-colors shadow-lg disabled:opacity-50"
        >
           <Flag className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden min-h-0 pb-4">
        
        {/* 3x3 Tic-Tac-Toe Board */}
        <div className="flex-1 flex items-center justify-center relative">
          
          {/* VICTORY/DEFEAT OVERLAY */}
          {winner && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-xl">
              <div className="text-center p-8 glass-panel rounded-xl border border-primary shadow-[0_0_50px_rgba(59,130,246,0.3)]">
                <h2 className="text-4xl font-bold mb-2 tracking-wider">
                  {winner === user.cfHandle 
                    ? <span className="text-primary drop-shadow-[0_0_10px_rgba(59,130,246,0.8)]">VICTORY</span> 
                    : <span className="text-danger drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]">DEFEAT</span>}
                </h2>
                <p className="font-mono text-gray-300 mb-6">{winner} secured the win.</p>
                <button onClick={() => navigate('/lobby')} className="bg-surface border border-white/20 text-white font-bold px-6 py-2 rounded hover:bg-white/10 transition-colors">
                  Return to Lobby
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 md:gap-4 w-full max-w-md aspect-square">
            {grid.map((problem, index) => {
              // Determine exact state of this specific square
              const claimedByMe = claims[problem] === user.cfHandle;
              const claimedByOpp = claims[problem] === opponentHandle;
              const isClaimed = claimedByMe || claimedByOpp;
              const isLocked = lockedProblem === problem;

              // Default Styling (Available)
              let buttonStyles = "bg-surface/40 border-white/5 hover:border-primary/50 cursor-pointer group";
              let textStyles = "text-gray-500 group-hover:text-primary";
              let statusText = "AVAILABLE";
              let statusColor = "text-gray-600";

              // Dynamic Overrides based on Game State
              if (claimedByMe) {
                buttonStyles = "bg-green-500/10 border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.3)] cursor-default";
                textStyles = "text-green-500 drop-shadow-[0_0_8px_rgba(34,197,94,0.5)]";
                statusText = "CAPTURED";
                statusColor = "text-green-500 bg-green-500/20 font-bold";
              } else if (claimedByOpp) {
                buttonStyles = "bg-red-500/10 border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)] cursor-default";
                textStyles = "text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]";
                statusText = "LOST";
                statusColor = "text-red-500 bg-red-500/20 font-bold";
              } else if (isLocked) {
                buttonStyles = "bg-primary/10 border-primary shadow-[0_0_15px_rgba(59,130,246,0.3)] cursor-default";
                textStyles = "text-primary drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]";
                statusText = "LOCKED";
                statusColor = "text-primary bg-primary/20 animate-pulse";
              }

              return (
                <button 
                  key={index}
                  onClick={() => handleLockProblem(problem)}
                  disabled={isClaimed} 
                  className={`relative rounded-xl flex flex-col items-center justify-center p-2 transition-all h-full w-full border ${buttonStyles}`}
                >
                  <span className={`font-bold text-3xl mb-1 transition-colors ${textStyles}`}>
                    {problem}
                  </span>
                  
                  {isLocked && !isClaimed && (
                    <div className="absolute top-2 right-2 text-primary animate-pulse">
                      <Lock className="w-4 h-4" />
                    </div>
                  )}
                  
                  <span className={`font-mono text-[10px] z-10 px-2 py-0.5 rounded ${statusColor}`}>
                    {statusText}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Feed */}
        <div className="w-full md:w-80 bg-surface/40 backdrop-blur-xl rounded-xl flex flex-col overflow-hidden h-64 md:h-auto border border-white/10 shadow-xl">
          <div className="bg-surface/80 px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <TerminalSquare className="w-4 h-4 text-gray-400" />
            <span className="font-mono text-xs text-gray-400 uppercase tracking-wider">Live System Feed</span>
          </div>
          <div className="flex-1 p-4 font-mono text-sm overflow-y-auto flex flex-col gap-3">
            {feed.map((log, index) => (
              <div key={index} className="text-gray-300">
                {log.includes('[SYS]') ? <span className="text-blue-400 font-bold">{log}</span> : log}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TerminalSquare, LogOut, Trophy, AlertTriangle } from 'lucide-react';
import { socket } from '../lib/socket';
import type { User } from '../App';

interface ShootoutScreenProps {
  user: User;
  onLogout: () => void;
}

export const ShootoutScreen = ({ user }: ShootoutScreenProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  
  // FIX 3: Added setMatchData so we can actively update the UI
  const [matchData, setMatchData] = useState<any>(() => {
    const stateData = location.state?.matchData;
    if (stateData) {
      localStorage.setItem('shootout_match', JSON.stringify(stateData));
      return stateData;
    }
    return JSON.parse(localStorage.getItem('shootout_match') || 'null');
  });

  const [winner, setWinner] = useState<string | null>(null);
  const [feed, setFeed] = useState<string[]>([
    `[SYS] Custom match initiated. First to solve wins.`,
    `[SYS] Target problem: ${matchData?.targetProblem}`
  ]);

  useEffect(() => {
    if (!matchData) {
      navigate('/lobby');
      return;
    }
    if (!socket.connected) socket.connect();
    
    // FIX 2: Send the exact same object payload we used in the Lobby so the backend knows the room!
    if (user?.cfHandle) {
      socket.emit('reconnect_user', { 
        handle: user.cfHandle, 
        customRoomCode: matchData.roomCode 
      });
    }

    socket.on('custom_game_over', (data: { winner: string }) => {
      setWinner(data.winner);
      setFeed(prev => [...prev, `[SYS] ${data.winner} solved the problem first!`]);
      localStorage.removeItem('shootout_match');
    });

    // FIX 1: Listen for players leaving and update the React state + Local Storage!
    socket.on('custom_room_updated', (data: { players: string[] }) => {
      setMatchData((prev: any) => {
        if (!prev) return prev;
        const updatedState = { ...prev, players: data.players };
        localStorage.setItem('shootout_match', JSON.stringify(updatedState));
        return updatedState;
      });
      setFeed(prev => [...prev, `[SYS] A player left the match. Remaining: ${data.players.length}`]);
    });

    return () => {
      socket.off('custom_game_over');
      socket.off('custom_room_updated');
    };
  }, [matchData?.roomCode, navigate, user?.cfHandle]);

  const handleLeave = () => {
    if (window.confirm("Are you sure you want to leave this custom match?")) {
      socket.emit('leave_custom_room', { roomCode: matchData.roomCode, handle: user.cfHandle });
      
      localStorage.removeItem('shootout_match');
      localStorage.removeItem('custom_room_state'); 
      
      navigate('/lobby');
    }
  };

  if (!matchData) return null;

  return (
    <section className="flex-1 flex flex-col relative w-full h-full max-w-6xl mx-auto overflow-hidden pt-4">
      
      {/* Header */}
      <div className="bg-surface/40 backdrop-blur-xl border border-fuchsia-500/30 w-full flex justify-between items-center px-4 md:px-8 py-3 rounded-xl mb-6 shadow-[0_0_30px_rgba(217,70,239,0.1)]">
        <div className="flex items-center gap-4">
          <div className="text-fuchsia-400 font-bold tracking-widest uppercase text-sm">Room</div>
          <div className="text-xl font-mono font-black text-white bg-surface px-3 py-1 rounded border border-white/10">
            {matchData.roomCode}
          </div>
        </div>
        
        <div className="font-bold text-2xl text-gray-200 tracking-wider">FFA SHOOTOUT</div>
        
        <button 
          onClick={handleLeave} 
          className="bg-surface border border-white/20 text-gray-400 p-2 rounded hover:bg-danger/20 hover:text-danger hover:border-danger transition-colors shadow-lg"
        >
           <LogOut className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden min-h-0 pb-4">
        
        {/* Left Side: The Problem & Winner Overlay */}
        <div className="flex-1 flex items-center justify-center relative bg-surface/20 rounded-xl border border-white/5">
          
          {winner && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-md rounded-xl">
              <div className="text-center p-12 glass-panel rounded-xl border border-fuchsia-500 shadow-[0_0_80px_rgba(217,70,239,0.4)]">
                <Trophy className="w-20 h-20 text-fuchsia-400 mx-auto mb-6 drop-shadow-[0_0_15px_rgba(217,70,239,0.8)]" />
                <h2 className="text-5xl font-black mb-4 tracking-wider text-white">
                  {winner} WINS!
                </h2>
                <p className="font-mono text-gray-400 mb-8 uppercase tracking-widest">First to solve {matchData.targetProblem}</p>
                <button onClick={() => navigate('/lobby')} className="bg-fuchsia-500 text-white font-bold px-8 py-3 rounded-lg hover:bg-fuchsia-400 transition-colors shadow-lg">
                  Return to Lobby
                </button>
              </div>
            </div>
          )}

          <div className="text-center">
            <h3 className="text-gray-500 font-mono text-sm tracking-widest uppercase mb-4">Target Problem</h3>
            <div className="text-8xl md:text-[150px] font-black text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.2)] tracking-tighter">
              {matchData.targetProblem}
            </div>
            <p className="mt-8 text-fuchsia-400 font-mono uppercase tracking-widest animate-pulse flex items-center justify-center gap-2">
              <AlertTriangle className="w-5 h-5" /> Race is live
            </p>
          </div>
        </div>

        {/* Right Side: Leaderboard & Feed */}
        <div className="w-full md:w-80 flex flex-col gap-6 h-full">
          
          {/* Competitors List */}
          <div className="bg-surface/40 backdrop-blur-xl rounded-xl p-4 border border-white/10 shadow-xl">
            <h3 className="font-bold text-gray-400 text-xs tracking-widest uppercase mb-4 border-b border-white/10 pb-2">Competitors</h3>
            <div className="flex flex-col gap-3">
              {matchData.players.map((p: string, idx: number) => (
                <div key={idx} className={`flex items-center justify-between p-3 rounded-lg border ${winner === p ? 'bg-fuchsia-500/20 border-fuchsia-500' : 'bg-surface/60 border-white/5'}`}>
                  <span className={`font-bold ${p === user.cfHandle ? 'text-primary' : 'text-gray-300'} ${winner === p ? 'text-fuchsia-400' : ''}`}>
                    {p}
                  </span>
                  {winner === p ? (
                    <Trophy className="w-4 h-4 text-fuchsia-400" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-gray-600 animate-pulse"></div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Live Feed */}
          <div className="flex-1 bg-surface/40 backdrop-blur-xl rounded-xl flex flex-col overflow-hidden border border-white/10 shadow-xl">
            <div className="bg-surface/80 px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <TerminalSquare className="w-4 h-4 text-gray-400" />
              <span className="font-mono text-xs text-gray-400 uppercase tracking-wider">Race Feed</span>
            </div>
            <div className="flex-1 p-4 font-mono text-sm overflow-y-auto flex flex-col gap-3">
              {feed.map((log, index) => (
                <div key={index} className="text-gray-300">
                  {log.includes('[SYS]') ? <span className="text-fuchsia-400 font-bold">{log}</span> : log}
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </section>
  );
};
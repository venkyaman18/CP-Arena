import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radar, LogOut, Users, Key, Play, X, Trophy } from 'lucide-react';
import axios from 'axios';
import { socket } from '../lib/socket';
import type { User } from '../App';

interface LobbyScreenProps {
  user: User;
  onLogout: () => void;
}

// ... keeping your existing interfaces ...
interface QueueData { status: string; }
interface MatchData { roomId: string; p1: string; p2: string; targetProblem?: string; grid?: string[] }
interface QueueError { message: string; }

// NEW: Custom Room Interface
interface CustomRoomState {
  roomCode: string;
  players: string[];
  isHost: boolean;
}

export const LobbyScreen = ({ user, onLogout }: LobbyScreenProps) => {
  const [isSearching, setIsSearching] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const navigate = useNavigate();

  // Custom Room States
const [roomMode, setRoomMode] = useState<'default' | 'entering_code' | 'waiting_room'>(() => {
    return localStorage.getItem('custom_room_state') ? 'waiting_room' : 'default';
  });  const [joinCode, setJoinCode] = useState('');
const [customRoom, setCustomRoom] = useState<CustomRoomState | null>(() => {
    return JSON.parse(localStorage.getItem('custom_room_state') || 'null');
  });
    useEffect(() => {
      socket.emit('reconnect_user', { 
      handle: user.cfHandle, 
      customRoomCode: customRoom?.roomCode 
    });
    axios.get(`${import.meta.env.VITE_BACKEND_URL}/api/history/${user.cfHandle}`)
      .then(res => setHistory(res.data))
      .catch(err => console.error("Could not fetch history:", err));
  }, [user.cfHandle]);

  useEffect(() => {
    socket.connect();

    socket.on('queue_joined', (data: QueueData) => console.log('[Queue]', data.status));
    socket.on('queue_error', (data: QueueError) => {
      console.error('[Queue Error]', data.message);
      setIsSearching(false);
    });
    socket.on('match_found', (matchData: MatchData) => {
      navigate('/arena', { state: { matchData, mode: '1v1' } });
    });

    socket.on('custom_room_created', (data: CustomRoomState) => {
      setCustomRoom(data);
      setRoomMode('waiting_room');
      localStorage.setItem('custom_room_state', JSON.stringify(data));
    });

    socket.on('custom_room_joined', (data: CustomRoomState) => {
      setCustomRoom(data);
      setRoomMode('waiting_room');
      localStorage.setItem('custom_room_state', JSON.stringify(data));
    });

    socket.on('custom_room_updated', (data: { players: string[], host?: string }) => {
      setCustomRoom(prev => {
        if (!prev) return null;
        const newState = {
          ...prev,
          players: data.players,
          isHost: data.host ? data.host === user.cfHandle : prev.isHost
        };
        localStorage.setItem('custom_room_state', JSON.stringify(newState));
        return newState;
      });
    });

    socket.on('custom_room_error', (data: { message: string }) => {
      alert(`Room Error: ${data.message}`);
      setRoomMode('default');
      localStorage.removeItem('custom_room_state');
    });

    socket.on('custom_match_started', (matchData: any) => {
      localStorage.removeItem('custom_room_state');
      setCustomRoom(null);
      setRoomMode('default');
      
      navigate('/shootout', { state: { matchData } });
    });
    return () => {
      socket.off('queue_joined');
      socket.off('queue_error');
      socket.off('match_found');
      socket.off('custom_room_created');
      socket.off('custom_room_joined');
      socket.off('custom_room_updated');
      socket.off('custom_room_error');
      socket.off('custom_match_started');
    };
  }, [navigate]);

  // --- ACTIONS ---
  const toggleSearch = () => {
    if (!isSearching) {
      if (!socket.connected) socket.connect(); 
      socket.emit('join_queue', { handle: user.cfHandle });
      setIsSearching(true);
    } else {
      socket.disconnect();
      setTimeout(() => socket.connect(), 500); 
      setIsSearching(false);
    }
  };

  const handleCreateRoom = () => {
    if (!socket.connected) socket.connect();
    socket.emit('create_custom_room', { handle: user.cfHandle });
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode || joinCode.length !== 6) return;
    if (!socket.connected) socket.connect();
    socket.emit('join_custom_room', { handle: user.cfHandle, roomCode: joinCode.toUpperCase() });
  };

  const handleStartCustomMatch = () => {
    if (customRoom?.isHost) {
      socket.emit('start_custom_match', { roomCode: customRoom.roomCode, handle: user.cfHandle });
    }
  };

  const handleLogout = () => {
    socket.disconnect();
    localStorage.removeItem('arena_user');
    onLogout();
  };

  // --- RENDER HELPERS ---
  const renderDefaultLobby = () => (
    <div className="relative flex flex-col items-center w-full max-w-lg shrink-0 mb-12">
      {isSearching && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none top-[-20px]">
          <div className="w-48 h-48 rounded-full border border-primary/30 animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite] absolute"></div>
        </div>
      )}

      <button 
        onClick={toggleSearch}
        className={`relative z-10 w-48 h-48 rounded-full backdrop-blur-md border-2 shadow-[0_0_30px_rgba(59,130,246,0.2)] transition-all flex flex-col items-center justify-center gap-2 group
          ${isSearching ? 'bg-primary/20 border-primary shadow-[0_0_50px_rgba(59,130,246,0.5)]' : 'bg-surface/80 border-gray-600 hover:border-primary/50'}`}
      >
        <Radar className={`w-10 h-10 ${isSearching ? 'text-primary animate-pulse' : 'text-gray-400 group-hover:text-primary/70'}`} />
        <span className={`font-bold tracking-wider uppercase mt-2 text-center leading-tight ${isSearching ? 'text-primary' : 'text-gray-400'}`}>
          {isSearching ? 'Searching...' : 'Ranked\n1v1'}
        </span>
      </button>

      {/* NEW: Custom Room Buttons */}
      {!isSearching && (
        <div className="flex gap-4 mt-8 w-full max-w-sm">
          <button 
            onClick={handleCreateRoom}
            className="flex-1 bg-surface/60 border border-fuchsia-500/30 hover:border-fuchsia-500 text-fuchsia-400 p-3 rounded-lg flex items-center justify-center gap-2 transition-all font-bold"
          >
            <Users className="w-5 h-5" /> Host Party
          </button>
          <button 
            onClick={() => setRoomMode('entering_code')}
            className="flex-1 bg-surface/60 border border-white/10 hover:border-white/30 text-white p-3 rounded-lg flex items-center justify-center gap-2 transition-all font-bold"
          >
            <Key className="w-5 h-5 text-gray-400" /> Join Code
          </button>
        </div>
      )}
    </div>
  );

  const renderJoinPrompt = () => (
    <div className="w-full max-w-sm bg-surface/80 backdrop-blur-xl border border-white/20 p-6 rounded-xl shadow-2xl mb-12 flex flex-col items-center animate-in fade-in zoom-in duration-200">
      <div className="w-full flex justify-between items-center mb-6">
        <h3 className="font-bold tracking-wider text-lg">ENTER ROOM CODE</h3>
        <button onClick={() => setRoomMode('default')} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
      </div>
      <form onSubmit={handleJoinRoom} className="w-full flex flex-col gap-4">
        <input 
          autoFocus
          maxLength={6}
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          placeholder="e.g. X7K9PQ" 
          className="w-full bg-background border border-white/10 rounded-lg p-4 text-center text-2xl font-mono uppercase tracking-[0.5em] text-primary focus:outline-none focus:border-primary"
        />
        <button type="submit" disabled={joinCode.length !== 6} className="w-full bg-primary text-background font-bold py-3 rounded-lg hover:bg-blue-400 transition-colors disabled:opacity-50">
          JOIN LOBBY
        </button>
      </form>
    </div>
  );

  const renderWaitingRoom = () => {
    if (!customRoom) return null;
    return (
      <div className="w-full max-w-md bg-surface/80 backdrop-blur-xl border border-fuchsia-500/30 p-6 rounded-xl shadow-[0_0_50px_rgba(217,70,239,0.15)] mb-12 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex justify-between items-start mb-6 border-b border-white/10 pb-4">
          <div>
            <h2 className="text-fuchsia-400 font-bold tracking-widest uppercase text-sm">Custom Match</h2>
            <div className="text-3xl font-mono font-black tracking-widest mt-1 text-white select-all">
              {customRoom.roomCode}
            </div>
          </div>
          {/* UPDATED BUTTON HERE */}
          <button 
            onClick={() => { 
              socket.emit('leave_custom_room', { roomCode: customRoom.roomCode, handle: user.cfHandle });
              setRoomMode('default'); 
              setCustomRoom(null); 
              localStorage.removeItem('custom_room_state'); // ADD THIS LINE
            }} 
            className="text-gray-500 hover:text-danger p-2 bg-surface rounded-lg"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        <div className="flex justify-between text-xs font-mono text-gray-500 mb-3 px-1">
          <span>PLAYERS</span>
          <span>{customRoom.players.length} / 5</span>
        </div>

        <div className="flex flex-col gap-2 mb-6">
          {customRoom.players.map((p, i) => (
            <div key={i} className="flex items-center gap-3 bg-background/50 border border-white/5 p-3 rounded-lg">
              <div className="w-8 h-8 rounded bg-surface border border-white/10 flex items-center justify-center font-bold text-gray-400">
                {i === 0 ? <Trophy className="w-4 h-4 text-yellow-500" /> : i + 1}
              </div>
              <span className={`font-bold ${p === user.cfHandle ? 'text-primary' : 'text-gray-300'}`}>{p}</span>
              {i === 0 && <span className="ml-auto text-[10px] bg-fuchsia-500/20 text-fuchsia-400 px-2 py-1 rounded font-mono uppercase">Host</span>}
            </div>
          ))}
          {[...Array(5 - customRoom.players.length)].map((_, i) => (
            <div key={`empty-${i}`} className="flex items-center gap-3 bg-background/20 border border-dashed border-white/10 p-3 rounded-lg opacity-50">
              <div className="w-8 h-8 rounded border border-dashed border-white/20"></div>
              <span className="font-mono text-sm text-gray-600">Waiting for player...</span>
            </div>
          ))}
        </div>

        {customRoom.isHost ? (
          <button onClick={handleStartCustomMatch} className="w-full bg-fuchsia-500 text-white font-bold py-4 rounded-lg flex items-center justify-center gap-2 hover:bg-fuchsia-400 shadow-[0_0_20px_rgba(217,70,239,0.4)] transition-all">
            <Play className="w-5 h-5 fill-current" /> START MATCH
          </button>
        ) : (
          <div className="w-full bg-surface border border-white/5 text-gray-400 font-mono text-center py-4 rounded-lg animate-pulse">
            Waiting for host to start...
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="flex-1 flex flex-col items-center justify-start p-4 w-full h-full relative overflow-y-auto pt-24 pb-12">
      {/* ... keeping your existing absolute header exactly the same ... */}
      <div className="fixed top-0 left-0 w-full flex justify-between items-center px-4 md:px-8 py-4 bg-surface/80 backdrop-blur-xl border-b border-white/10 z-50">
        <div className="text-2xl font-bold text-primary tracking-tighter drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]">ARENA</div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="font-semibold text-gray-100">{user.cfHandle}</div>
            <div className="font-mono text-xs text-primary">ELO {user.rating}</div>
          </div>
          <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"><LogOut className="w-5 h-5" /></button>
        </div>
      </div>

      {/* DYNAMIC LOBBY STATE */}
      <div className="min-h-[300px] flex items-center justify-center w-full mt-4">
        {roomMode === 'default' && renderDefaultLobby()}
        {roomMode === 'entering_code' && renderJoinPrompt()}
        {roomMode === 'waiting_room' && renderWaitingRoom()}
      </div>

      {/* ... keeping your existing Match History section exactly the same ... */}
      <div className="w-full max-w-3xl bg-surface/40 backdrop-blur-xl border border-white/10 rounded-xl p-6 shadow-xl shrink-0 mt-4">
        <h2 className="text-xl font-bold text-white mb-6 tracking-wider uppercase flex items-center gap-3">
          <span className="w-2 h-6 bg-primary rounded-full inline-block"></span>
          Recent Duels
        </h2>
        {history.length === 0 ? (
          <div className="text-center p-8 border border-dashed border-white/10 rounded-lg">
            <div className="text-gray-500 font-mono text-sm">No matches played yet. Enter the Arena to forge your legacy.</div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {history.map((match) => {
              const isWin = match.winner === user.cfHandle;
              
              // NEW: Check if this was a 5-player party mode or a 1v1
              const isPartyMode = match.p2.includes(',');;
              const opponent = isPartyMode ? 'FFA Shootout' : (match.p1 === user.cfHandle ? match.p2 : match.p1);
              
              return (
                <div key={match.id} className="flex flex-col md:flex-row md:items-center justify-between p-4 bg-surface/60 border border-white/5 rounded-lg hover:border-white/20 transition-colors gap-4">
                  
                  <div className="flex items-center gap-4">
                    <div className={`font-bold text-lg w-24 tracking-wider ${isWin ? 'text-green-500 drop-shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.4)]'}`}>
                      {isWin ? 'VICTORY' : 'DEFEAT'}
                    </div>
                    <div className="text-gray-400 font-mono text-sm border-l border-white/10 pl-4 py-1">
                      {isPartyMode ? 'in ' : 'vs '} 
                      <span className={`font-bold text-base ${isPartyMode ? 'text-fuchsia-400' : 'text-white'}`}>
                        {opponent}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex flex-col md:items-end text-xs text-gray-500 font-mono uppercase">
                    <span className="text-gray-300">{match.reason}</span>
                    <span className="mt-1 opacity-60">{new Date(match.createdAt).toLocaleString()}</span>
                  </div>
                  
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
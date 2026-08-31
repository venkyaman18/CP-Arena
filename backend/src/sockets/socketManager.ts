import { Server, Socket } from 'socket.io';
import { redis } from '../config/redis';
import { prisma } from '../config/db';
import { calculateNewRatings } from '../utils/elo';
import axios from 'axios';
export const initializeSockets = (io: Server) => {
  io.on('connection', (socket: Socket) => {
      console.log(`[Socket Connected] Client ID: ${socket.id}`);
// 4. Player leaves a custom room
    // 4. Player leaves a custom room
    socket.on('leave_custom_room', async (data: { roomCode: string, handle: string }) => {
      try {
        if (!data.roomCode || !data.handle) return; // Safety check

        const roomKey = `custom_room:${data.roomCode}`;
        const roomExists = await redis.exists(roomKey);
        if (!roomExists) return;

        const rawPlayers = await redis.hget(roomKey, 'players');
        const host = await redis.hget(roomKey, 'host');
        let players: string[] = rawPlayers ? JSON.parse(rawPlayers) : [];

        // Remove the player physically and from the array
        players = players.filter(p => p !== data.handle);
        socket.leave(`custom:${data.roomCode}`);

        // If the room is now empty, destroy it completely!
        if (players.length === 0) {
          await redis.del(roomKey);
          console.log(`[Custom Room] ${data.roomCode} destroyed (empty).`);
          return;
        }

        // Host Migration: If the host left, crown the next person in line
        let newHost = host;
        if (host === data.handle) {
          newHost = players[0];
          await redis.hset(roomKey, { host: newHost });
        }

        // Save the updated list and blast the UNIFIED state to everyone left
        await redis.hset(roomKey, { players: JSON.stringify(players) });
        
        io.to(`custom:${data.roomCode}`).emit('custom_room_updated', { 
          players, 
          host: newHost 
        });

        console.log(`[Custom Room] ${data.handle} left. New host is ${newHost}.`);
      } catch (error) {
        console.error('[Room Error] Failed to leave room:', error);
      }
    });
    socket.on('create_custom_room', async (data: { handle: string }) => {
      try {
        // Generate a random 6-character uppercase code (e.g., "X7K9PQ")
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const roomKey = `custom_room:${roomCode}`;

        const roomState = {
          host: data.handle,
          players: JSON.stringify([data.handle]),
          status: 'waiting', // waiting | active
          problem: ''
        };

        await redis.hset(roomKey, roomState);
        // Expire the lobby after 1 hour if they abandon it
        await redis.expire(roomKey, 3600); 

        socket.join(`custom:${roomCode}`);
        
        socket.emit('custom_room_created', { 
          roomCode, 
          players: [data.handle], 
          isHost: true 
        });
        
        console.log(`[Custom Room] ${data.handle} created room ${roomCode}`);
      } catch (error) {
        console.error('[Room Error]', error);
      }
    });

    // 2. Challenger joins a room
    socket.on('join_custom_room', async (data: { handle: string, roomCode: string }) => {
      try {
        const roomKey = `custom_room:${data.roomCode}`;
        const roomExists = await redis.exists(roomKey);

        if (!roomExists) {
          socket.emit('custom_room_error', { message: 'Room not found or expired.' });
          return;
        }

        const rawPlayers = await redis.hget(roomKey, 'players');
        const status = await redis.hget(roomKey, 'status');
        let players: string[] = rawPlayers ? JSON.parse(rawPlayers) : [];

        if (status !== 'waiting') {
          socket.emit('custom_room_error', { message: 'Match has already started.' });
          return;
        }

        if (players.length >= 5) {
          socket.emit('custom_room_error', { message: 'Room is full (Max 5 players).' });
          return;
        }

        if (players.includes(data.handle)) {
          // They refreshed or clicked twice, just put them back in the socket room
          socket.join(`custom:${data.roomCode}`);
          socket.emit('custom_room_joined', { roomCode: data.roomCode, players });
          return;
        }

        // Add player and save
        players.push(data.handle);
        await redis.hset(roomKey, { players: JSON.stringify(players) });
        
        socket.join(`custom:${data.roomCode}`);
        socket.emit('custom_room_joined', { roomCode: data.roomCode, players, isHost: false });
        
        // Broadcast to everyone else in the room that a new challenger arrived
        io.to(`custom:${data.roomCode}`).emit('custom_room_updated', { players });
        
        console.log(`[Custom Room] ${data.handle} joined ${data.roomCode} (${players.length}/5)`);
      } catch (error) {
        console.error('[Room Error]', error);
      }
    });

    // 3. Host starts the match
    // 3. Host starts the match
    socket.on('start_custom_match', async (data: { roomCode: string, handle: string }) => {
      try {
        const roomKey = `custom_room:${data.roomCode}`;
        const host = await redis.hget(roomKey, 'host');
        if (!host) {
          socket.emit('custom_room_error', { message: 'Room no longer exists.' });
          return;
        }
        if (host !== data.handle) return; // Security: Only host can start

        const rawPlayers = await redis.hget(roomKey, 'players');
        const players: string[] = rawPlayers ? JSON.parse(rawPlayers) : [];

        console.log(`[Custom Room] Fetching histories to find virgin problem for ${players.length} players...`);

        // 1. Grab the master pool
        const pool = await redis.smembers('arena:problem_pool');
        const safePool = pool.length > 0 ? pool : ['158A', '71A', '231A'];
        const blacklist = new Set<string>();

        // 2. Fetch all player histories concurrently
        // We use Promise.allSettled so if one user's API call fails, it doesn't crash the whole lobby
        const historyPromises = players.map(p => 
          axios.get(`https://codeforces.com/api/user.status?handle=${p}`, { timeout: 4000 })
        );

        const results = await Promise.allSettled(historyPromises);

        // 3. Build the unified blacklist of every problem ever solved by ANY player in the room
        results.forEach(res => {
          if (res.status === 'fulfilled' && res.value.data.status === 'OK') {
            res.value.data.result.forEach((sub: any) => {
              if (sub.verdict === 'OK') {
                blacklist.add(`${sub.problem.contestId}${sub.problem.index}`);
              }
            });
          }
        });

        // 4. Filter the pool to find problems NO ONE has solved
        const freshProblems = safePool.filter(prob => !blacklist.has(prob));

        // 5. Select the target (with a fallback just in case they are absolute veterans)
        let targetProblem;
        if (freshProblems.length > 0) {
          targetProblem = freshProblems[Math.floor(Math.random() * freshProblems.length)];
          console.log(`[Custom Room] Found fresh problem: ${targetProblem} (Excluded ${blacklist.size} solved problems)`);
        } else {
          console.warn(`[Custom Room] Lobby exhausted the Elo pool. Using random fallback.`);
          targetProblem = safePool[Math.floor(Math.random() * safePool.length)];
        }

        // 6. Lock the room and start the game
        await redis.hset(roomKey, { status: 'active', problem: targetProblem });

        const gameData = { roomCode: data.roomCode, players, targetProblem, startTime: Math.floor(Date.now() / 1000) };
        await redis.sadd('active_custom_games', JSON.stringify(gameData));

        io.to(`custom:${data.roomCode}`).emit('custom_match_started', {
           roomCode: data.roomCode,
           players,
           targetProblem 
        });

      } catch (error) {
        console.error('[Room Error] Failed to start custom match:', error);
      }
    });
    // Catch page refreshes and re-assign them to their target rooms
    // Catch page refreshes and re-assign them to their target rooms
    // Catch page refreshes and re-assign them to their target rooms
    socket.on('reconnect_user', async (data: any) => {
        const handle = typeof data === 'string' ? data : data.handle;
        const customRoomCode = typeof data === 'object' ? data.customRoomCode : null;

        socket.join(`user:${handle}`);
        
        if (customRoomCode) {
            const exists = await redis.exists(`custom_room:${customRoomCode}`);
            
            if (exists) {
                socket.join(`custom:${customRoomCode}`);
                
                // CRITICAL FIX: Actively sync the latest state to the reconnected user!
                const rawPlayers = await redis.hget(`custom_room:${customRoomCode}`, 'players');
                const host = await redis.hget(`custom_room:${customRoomCode}`, 'host');
                
                if (rawPlayers) {
                    socket.emit('custom_room_updated', { 
                        players: JSON.parse(rawPlayers), 
                        host: host 
                    });
                }
                
                console.log(`[Socket] ${handle} re-registered & synced in room ${customRoomCode}.`);
            } else {
                socket.emit('custom_room_error', { message: 'The room was closed or expired.' });
            }
        } else {
            console.log(`[Socket] ${handle} re-registered their connection.`);
        }
    });
    // User requests to join the 1v1 queue
    socket.on('join_queue', async (data: { handle: string }) => {
      try {
        const { handle } = data;
        
        // 1. Verify user exists and fetch current Elo
        const user = await prisma.user.findUnique({ where: { cfHandle: handle } });
        if (!user) {
          socket.emit('queue_error', { message: 'Unregistered handle.' });
          return;
        }

        // 2. Map socket ID to handle for easy disconnect cleanup
        await redis.set(`socket:${socket.id}`, handle, 'EX', 86400);

        // 3. Add to matchmaking Sorted Set and record exact join time
        const now = Date.now();
        await redis.pipeline()
          .zadd('queue:1v1', user.rating, handle)
          .hset('queue:wait_times', handle, now)
          .exec();

        // 4. Group socket into a personal room so workers can message them directly
        socket.join(`user:${handle}`);
        socket.emit('queue_joined', { status: 'Searching for opponent...' });
        
        console.log(`[Queue] ${handle} joined at Elo ${user.rating}`);
      } catch (error) {
        socket.emit('queue_error', { message: 'Internal queue failure.' });
      }
    });

   socket.on('forfeit_match', async (data: { roomId: string; handle: string }) => {
      try {
        const { roomId, handle: loser } = data;

        // 1. Find the active game in Redis
        const activeGames = await redis.smembers('active_games');
        let gameStr = null;
        let gameData = null;

        for (const g of activeGames) {
          const parsed = JSON.parse(g);
          if (parsed.roomId === roomId) {
            gameStr = g;
            gameData = parsed;
            break;
          }
        }

        if (!gameData || !gameStr) return; 

        
        const removed = await redis.srem('active_games', gameStr);
        if (removed === 0) {
          console.log(`[Arena] Blocked ghost forfeit for ${roomId}. Match already resolved.`);
          return; 
        }

        // Clean up the targeted room cache
        await redis.del(`match:${roomId}`);

        // 3. Identify the winner
        const winner = gameData.p1 === loser ? gameData.p2 : gameData.p1;

        // 4. Fetch current ratings and calculate the new Elo
        const winnerData = await prisma.user.findUnique({ where: { cfHandle: winner } });
        const loserData = await prisma.user.findUnique({ where: { cfHandle: loser } });

        if (winnerData && loserData) {
          const { newRatingA, newRatingB } = calculateNewRatings(winnerData.rating, loserData.rating, 1);
          const claims = await redis.hgetall(`claims:${roomId}`);
          const { grid, p1, p2 } = gameData;
          // 5. Execute Database Updates
          await prisma.$transaction([
            prisma.user.update({
              where: { cfHandle: winner },
              data: { rating: newRatingA, matchesWon: { increment: 1 }, matchesPlayed: { increment: 1 } }
              
            }),
            prisma.user.update({
              where: { cfHandle: loser },
              data: { rating: newRatingB, matchesPlayed: { increment: 1 } }
            }),
            prisma.match.create({
                data: {
                  p1,
                  p2,
                  winner,
                  grid: grid,
                  claims: claims, 
                  reason: 'Opponent surrendered'
                }
              })
          ]);

          // 6. Notify the Winner to trigger their UI Victory screen
          const p1NewRating = winner === gameData.p1 ? newRatingA : newRatingB;
          const p2NewRating = winner === gameData.p2 ? newRatingA : newRatingB;
          const payload = {
            winner: winner,
            reason: 'Opponent surrendered.',
            newRatingP1: p1NewRating,
            newRatingP2: p2NewRating
          };
         io.to(`user:${winner}`).emit('game_over', payload);
          io.to(`user:${loser}`).emit('game_over', payload);

          console.log(`[Arena] Match ${roomId} forfeited by ${loser}. ${winner} awarded the win.`);
        }
      } catch (error) {
        console.error('[Forfeit Error] Failed to process match forfeit:', error);
      }
   });
      // Listen for a player locking a cell
    socket.on('lock_problem', async (data: { roomId: string; problem: string; handle: string }) => {
      try {
        // Save the target to a specific Redis Hash for this room
        await redis.hset(`locks:${data.roomId}`, {
          [data.handle]: data.problem
        });
        console.log(`[Arena] ${data.handle} locked problem ${data.problem} in ${data.roomId}`);
        
        // (Optional but cool) You can broadcast this to the opponent here later!
      } catch (error) {
        console.error('[Socket] Error saving locked problem:', error);
      }
    });

    // Cleanup when user closes tab or cancels
    socket.on('disconnect', async () => {
      const handle = await redis.get(`socket:${socket.id}`);
      if (handle) {
        await redis.pipeline()
          .zrem('queue:1v1', handle)
          .hdel('queue:wait_times', handle)
          .del(`socket:${socket.id}`)
          .exec();
        console.log(`[Queue] ${handle} abandoned the queue.`);
      }
    });
  });
};
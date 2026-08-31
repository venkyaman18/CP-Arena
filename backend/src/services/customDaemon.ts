import { Server } from 'socket.io';
import { redis } from '../config/redis';
import axios from 'axios';
import { prisma } from '../config/db';
const CF_API = 'https://codeforces.com/api/user.status';

export const startCustomDaemon = (io: Server) => {
  const poll = async () => {
    try {
      const activeGames = await redis.smembers('active_custom_games');
      if (activeGames.length === 0) return;

        for (const gameStr of activeGames) {
            const game = JSON.parse(gameStr);
            const { roomCode, players, targetProblem, startTime } = game;

            let winner: string | null = null;

            // Loop through all players in the shootout
            for (const gameStr of activeGames) {
                const game = JSON.parse(gameStr);
                const { roomCode, players, targetProblem, startTime } = game;

                // 1. THE ABANDON CHECK: If the room key was deleted because everyone left, drop the game!
                const roomExists = await redis.exists(`custom_room:${roomCode}`);
                if (!roomExists) {
                    console.log(`[FFA Daemon] Room ${roomCode} was abandoned by all players. Dropping from engine.`);
                    await redis.srem('active_custom_games', gameStr);
                    continue; // Skip the Codeforces polling entirely!
                }

                let winner: string | null = null;

                // Loop through all players in the shootout
                for (const player of players) {
                    const solved = await fetchVerdict(player, targetProblem, startTime);
          
                    if (solved) {
                        winner = player;
                        break;
                    }
                    await sleep(1000);
                }

                if (winner) {
                    const removed = await redis.srem('active_custom_games', gameStr);
                    if (removed === 0) continue;

                    await redis.del(`custom_room:${roomCode}`);

                    console.log(`[FFA Daemon] SHOOTOUT OVER! ${winner} won room ${roomCode}`);

                    // 2. THE HISTORY FIX: Save all players in p2 so the database can find them!
                    try {
                        await prisma.match.create({
                            data: {
                                p1: players[0] || 'Unknown',
                                p2: players.join(','), // Saves as: "Host,Player2,Player3..."
                                winner: winner,
                                grid: [targetProblem],
                                claims: { [targetProblem]: winner },
                                reason: 'First to Solve'
                            }
                        });
                    } catch (dbError) {
                        console.error('[FFA Daemon] Failed to save match history:', dbError);
                    }

                    io.to(`custom:${roomCode}`).emit('custom_game_over', { winner });
          
                    players.forEach((p: string) => {
                        io.to(`user:${p}`).emit('custom_game_over', { winner });
                    });
                }
            }
        }
    } catch (error) {
      console.error('[FFA Daemon Error]', error);
    } finally {
      // Wait 5 seconds before checking the lobbies again
      setTimeout(poll, 5000); 
    }
  };

  poll();
};

// Reusing our bulletproof verdict checker from the 1v1 Daemon
const fetchVerdict = async (handle: string, targetProblem: string, startTime: number): Promise<boolean> => {
  try {
    const res = await axios.get(`${CF_API}?handle=${handle}&from=1&count=10`, { timeout: 4000 });
    if (res.data.status !== 'OK') return false;

    const regexMatch = targetProblem.match(/^(\d+)([A-Z0-9]+)$/);
    if (!regexMatch) return false;

    const targetContest = parseInt(regexMatch[1]);
    const targetIndex = regexMatch[2];
    const bufferedStartTime = startTime - 60; // 60s buffer for clock skew

    return res.data.result.some((sub: any) => 
      sub.creationTimeSeconds >= bufferedStartTime &&
      sub.verdict === 'OK' &&
      sub.problem.contestId === targetContest &&
      sub.problem.index === targetIndex
    );
  } catch (error: any) {
    if (error.response?.status === 429) {
      console.log(`[FFA Daemon] Rate limited on ${handle}.`);
    }
    return false; 
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
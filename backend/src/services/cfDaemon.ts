import { Server } from 'socket.io';
import { redis } from '../config/redis';
import axios from 'axios';
import { prisma } from '../config/db';
import { calculateNewRatings } from '../utils/elo';

const CF_API = 'https://codeforces.com/api/user.status';

// The 8 possible winning combinations on a 3x3 grid
const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
  [0, 4, 8], [2, 4, 6]             // Diagonals
];

const checkWinCondition = (grid: string[], claims: Record<string, string>, handle: string) => {
  // Find all grid indexes this player owns
  const ownedIndexes = grid
    .map((prob, idx) => (claims[prob] === handle ? idx : -1))
    .filter(idx => idx !== -1);

  // Check if any winning line is fully contained in their owned indexes
  return WIN_LINES.some(line => line.every(idx => ownedIndexes.includes(idx)));
};

export const startCfDaemon = (io: Server) => {
  const poll = async () => {
    try {
      const activeGames = await redis.smembers('active_games');
      if (activeGames.length === 0) return;

      for (const gameStr of activeGames) {
        const game = JSON.parse(gameStr);
        const { p1, p2, roomId, startTime, grid } = game;

        const locks = await redis.hgetall(`locks:${roomId}`);
        const claims = await redis.hgetall(`claims:${roomId}`); // Track who owns which problem

        // Only poll if they have a lock AND they haven't already claimed it
        if (locks[p1] && claims[locks[p1]] !== p1) {
          const solved = await fetchVerdict(p1, locks[p1], startTime);
          if (solved) {
            await redis.hset(`claims:${roomId}`, { [locks[p1]]: p1 });
            claims[locks[p1]] = p1; // Update local state
            io.to(`user:${p1}`).emit('square_claimed', { problem: locks[p1], handle: p1 });
            io.to(`user:${p2}`).emit('square_claimed', { problem: locks[p1], handle: p1 });
            console.log(`[Daemon] ${p1} claimed square ${locks[p1]}`);
          }
          await sleep(1000); // Protect against CF Rate Limits
        }
        
        if (locks[p2] && claims[locks[p2]] !== p2) {
          const solved = await fetchVerdict(p2, locks[p2], startTime);
          if (solved) {
            await redis.hset(`claims:${roomId}`, { [locks[p2]]: p2 });
            claims[locks[p2]] = p2;
            io.to(`user:${p1}`).emit('square_claimed', { problem: locks[p2], handle: p2 });
            io.to(`user:${p2}`).emit('square_claimed', { problem: locks[p2], handle: p2 });
            console.log(`[Daemon] ${p2} claimed square ${locks[p2]}`);
          }
          await sleep(1000);
        }

        // Check Win Conditions
        let winner = null;
        let loser = null;

        if (checkWinCondition(grid, claims, p1)) { winner = p1; loser = p2; }
        else if (checkWinCondition(grid, claims, p2)) { winner = p2; loser = p1; }

        if (winner && loser) {
          const removed = await redis.srem('active_games', gameStr);
          if (removed === 0) continue; // Prevent double execution

          // Clean up Room Memory
          await redis.del(`match:${roomId}`);
          await redis.del(`locks:${roomId}`);
          await redis.del(`claims:${roomId}`);

          const winnerData = await prisma.user.findUnique({ where: { cfHandle: winner } });
          const loserData = await prisma.user.findUnique({ where: { cfHandle: loser } });

          if (winnerData && loserData) {
            const { newRatingA, newRatingB } = calculateNewRatings(winnerData.rating, loserData.rating, 1);

            await prisma.$transaction([
              prisma.user.update({ where: { cfHandle: winner }, data: { rating: newRatingA, matchesWon: { increment: 1 }, matchesPlayed: { increment: 1 } } }),
                prisma.user.update({ where: { cfHandle: loser }, data: { rating: newRatingB, matchesPlayed: { increment: 1 } } }),
                prisma.match.create({
                data: {
                  p1,
                  p2,
                  winner,
                  grid: grid, 
                  claims: claims, 
                  reason: 'Tic-Tac-Toe Victory'
                }
              })
            ]);

            const p1NewRating = winner === p1 ? newRatingA : newRatingB;
            const p2NewRating = winner === p2 ? newRatingA : newRatingB;

            console.log(`[Daemon] TIC-TAC-TOE VICTORY: ${winner} defeated ${loser}.`);

            io.to(`user:${p1}`).emit('game_over', { winner, newRatingP1: p1NewRating });
            io.to(`user:${p2}`).emit('game_over', { winner, newRatingP2: p2NewRating });
          }
        }
      }
    } catch (error) {
      console.error('[Daemon Error]', error);
    } finally {
      // Increased to 5 seconds to guarantee we stay under the CF API limits
      setTimeout(poll, 5000); 
    }
  };

  poll();
};

const fetchVerdict = async (handle: string, targetProblem: string, startTime: number): Promise<boolean> => {
  try {
    // 1. Increased count to 15 to ensure we don't miss buried submissions
    const res = await axios.get(`${CF_API}?handle=${handle}&from=1&count=15`, { timeout: 5000 });
    
    if (res.data.status !== 'OK') {
      console.error(`[CF API Warning] Unhealthy status for ${handle}: ${res.data.status}`);
      return false;
    }

    // 2. Upgraded Regex to allow numbers in the problem index (e.g., 177B2)
    const regexMatch = targetProblem.match(/^(\d+)([A-Z0-9]+)$/);
    if (!regexMatch) {
      console.error(`[Daemon Error] Failed to parse problem format: ${targetProblem}`);
      return false;
    }

    const targetContest = parseInt(regexMatch[1]);
    const targetIndex = regexMatch[2];

    // 3. Subtract 60 seconds from startTime to account for server clock differences!
    const bufferedStartTime = startTime - 60; 

    // Find if ANY submission matches our criteria
    const validSubmission = res.data.result.find((sub: any) => {
      const isCorrectTime = sub.creationTimeSeconds >= bufferedStartTime;
      const isCorrectVerdict = sub.verdict === 'OK'; // Change to 'COMPILATION_ERROR' if testing!
      const isCorrectProblem = sub.problem.contestId === targetContest && sub.problem.index === targetIndex;
      
      return isCorrectTime && isCorrectVerdict && isCorrectProblem;
    });

    if (validSubmission) {
      return true;
    }

    return false;

  } catch (error: any) {
    // If we hit a rate limit, print it so we actually know!
    if (error.response && error.response.status === 429) {
      console.log(`[Daemon] Rate limited by Codeforces API for ${handle}. Retrying next loop...`);
    } else if (error.code === 'ECONNABORTED') {
      console.log(`[Daemon] Timeout fetching data for ${handle}.`);
    } else {
      console.error(`[Daemon Error] Unknown fetch failure for ${handle}:`, error.message);
    }
    return false; 
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
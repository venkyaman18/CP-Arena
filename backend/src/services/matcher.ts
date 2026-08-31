import axios from 'axios';
import { redis } from '../config/redis';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

const getUnsolvedProblem = async (p1: string, p2: string): Promise<string> => {
  const masterPool = await redis.smembers('arena:problem_pool');
  const safePool = masterPool.length > 0 ? masterPool : ['158A', '71A', '231A', '282A', '50A'];

  try {
    const [res1, res2] = await Promise.all([
      axios.get(`https://codeforces.com/api/user.status?handle=${p1}`, { timeout: 3000 }),
      axios.get(`https://codeforces.com/api/user.status?handle=${p2}`, { timeout: 3000 })
    ]);

    const p1Solved = res1.data.result.filter((s: any) => s.verdict === 'OK').map((s: any) => `${s.problem.contestId}${s.problem.index}`);
    const p2Solved = res2.data.result.filter((s: any) => s.verdict === 'OK').map((s: any) => `${s.problem.contestId}${s.problem.index}`);

    const blacklist = new Set([...p1Solved, ...p2Solved]);
    const freshProblems = safePool.filter(prob => !blacklist.has(prob));

 
    if (freshProblems.length === 0) {
      console.warn(`[Matchmaker] ${p1} & ${p2} exhausted the Elo pool. Using random fallback.`);
      return safePool[Math.floor(Math.random() * safePool.length)];
    }

    return freshProblems[Math.floor(Math.random() * freshProblems.length)];
  } catch (error) {
    console.error(`[Matchmaker] CF API Outage for ${p1}/${p2}. Bypassing filter.`);
    return safePool[Math.floor(Math.random() * safePool.length)];
  }
};
const getUnsolvedGrid = async (p1: string, p2: string): Promise<string[]> => {
  const masterPool = await redis.smembers('arena:problem_pool');
  const safePool = masterPool.length >= 9 ? masterPool : ['158A', '71A', '231A', '282A', '50A', '339A', '112A', '266A', '118A'];

  try {
    const [res1, res2] = await Promise.all([
      axios.get(`https://codeforces.com/api/user.status?handle=${p1}`, { timeout: 3000 }),
      axios.get(`https://codeforces.com/api/user.status?handle=${p2}`, { timeout: 3000 })
    ]);

    const p1Solved = res1.data.result.filter((s: any) => s.verdict === 'OK').map((s: any) => `${s.problem.contestId}${s.problem.index}`);
    const p2Solved = res2.data.result.filter((s: any) => s.verdict === 'OK').map((s: any) => `${s.problem.contestId}${s.problem.index}`);

    const blacklist = new Set([...p1Solved, ...p2Solved]);
    const freshProblems = safePool.filter(prob => !blacklist.has(prob));

    if (freshProblems.length < 9) {
      console.warn(`[Matchmaker] Elo pool exhausted. Using random fallback.`);
      return safePool.sort(() => 0.5 - Math.random()).slice(0, 9);
    }

    return freshProblems.sort(() => 0.5 - Math.random()).slice(0, 9);
  } catch (error) {
    console.error(`[Matchmaker] CF API Outage. Bypassing filter.`);
    return safePool.sort(() => 0.5 - Math.random()).slice(0, 9);
  }
};
export const startMatchmaker = (io: Server) => {
  setInterval(async () => {
    try {
      const queue = await redis.zrange('queue:1v1', 0, -1, 'WITHSCORES');
      if (queue.length < 2) return; 
      
      const now = Date.now();

      for (let i = 0; i < queue.length - 1; i += 2) {
        const p1 = queue[i];
        const elo1 = parseInt(queue[i + 1]);
        const p2 = queue[i + 2];
        const elo2 = parseInt(queue[i + 3]);

        const [p1Time, p2Time] = await Promise.all([
          redis.hget('queue:wait_times', p1),
          redis.hget('queue:wait_times', p2)
        ]);

        const maxWaitSecs = Math.floor(Math.max(now - parseInt(p1Time || `${now}`), now - parseInt(p2Time || `${now}`)) / 1000);
        const eloDiff = Math.abs(elo1 - elo2);
        const acceptableGap = 50 + (maxWaitSecs * 15);

        if (eloDiff <= acceptableGap) {
          const roomId = `room:${uuidv4()}`;
          
          const grid = await getUnsolvedGrid(p1, p2);

          await redis.pipeline()
            .zrem('queue:1v1', p1, p2)
            .hdel('queue:wait_times', p1, p2)
            .exec();

          const gameData = JSON.stringify({
            p1, p2, roomId, grid, startTime: Math.floor(now / 1000)
          });
          await redis.sadd('active_games', gameData);

          const matchPayload = { roomId, p1, p2, grid };
          io.to(`user:${p1}`).emit('match_found', matchPayload);
          io.to(`user:${p2}`).emit('match_found', matchPayload);

          console.log(`[Matchmaker] Room ${roomId} created. 3x3 Grid initialized.`);
        }
      }
    } catch (error) {
      console.error('[Matchmaker Error]', error);
    }
  }, 3000);
};
export const pairPlayers = async (io: Server, player1Handle: string, player2Handle: string) => {
    console.log(`[Matchmaker] Generating grid for ${player1Handle} vs ${player2Handle}...`);
    
    const gridProblems = await getUnsolvedGrid(player1Handle, player2Handle);

    const matchData = {
      roomId: `match_${Date.now()}`,
      p1: player1Handle,
      p2: player2Handle,
      grid: gridProblems, 
      startTime: Math.floor(Date.now() / 1000)
    };

    io.to(`user:${player1Handle}`).emit('match_found', matchData);
    io.to(`user:${player2Handle}`).emit('match_found', matchData);

    await redis.sadd('active_games', JSON.stringify(matchData));
}
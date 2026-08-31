import axios from 'axios';
import { redis } from '../config/redis';

export const initializeProblemPool = async () => {
  try {
    console.log('[System] Fetching global problemset from Codeforces...');
    const response = await axios.get('https://codeforces.com/api/problemset.problems');
    
    if (response.data.status === 'OK') {
      const minRating = parseInt(process.env.CF_MIN_RATING || '1000');
      const maxRating = parseInt(process.env.CF_MAX_RATING || '1200');

      const validProblems = response.data.result.problems
        .filter((p: any) => p.rating >= minRating && p.rating <= maxRating)
        .map((p: any) => `${p.contestId}${p.index}`);

      if (validProblems.length > 0) {
        await redis.del('arena:problem_pool');
        for (let i = 0; i < validProblems.length; i += 500) {
          const chunk = validProblems.slice(i, i + 500);
          await redis.sadd('arena:problem_pool', ...chunk);
        }
        
        console.log(`[System] Successfully cached ${validProblems.length} problems (${minRating}-${maxRating}) into Redis.`);
      }
    }
  } catch (error) {
    console.error('[System Error] Failed to fetch CF problemset. Will retry in 1 minute.');
    setTimeout(initializeProblemPool, 60000);
  }
};
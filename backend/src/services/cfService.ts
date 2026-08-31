import axios from 'axios';

interface CFSubmission {
  id: number;
  creationTimeSeconds: number;
  verdict: string;
  problem: {
    contestId: number;
    index: string;
  };
}

export const VERIFICATION_PROBLEMS = ['1A', '4A', '71A', '158A', '231A', '263A', '112A'];

export const checkCFCompilationError = async (
  handle: string,
  targetProblem: string,
  initiatedAtSeconds: number
): Promise<boolean> => {
  try {
    const response = await axios.get(
      `https://codeforces.com/api/user.status?handle=${handle}&from=1&count=10`,
      { timeout: 5000 }
    );

    if (response.data.status !== 'OK') {
      throw new Error('Codeforces API explicitly rejected the target payload.');
    }

    const submissions: CFSubmission[] = response.data.result;

    const regexMatch = targetProblem.match(/^(\d+)([A-Z]+)$/);
    if (!regexMatch) throw new Error('Malformed execution problem formatting.');

    const targetContestId = parseInt(regexMatch[1]);
    const targetIndex = regexMatch[2];

    return submissions.some((sub) => {
      const isNewerSubmission = sub.creationTimeSeconds >= initiatedAtSeconds;
      const isCompilationError = sub.verdict === 'COMPILATION_ERROR';
      const isTargetProblem = 
        sub.problem.contestId === targetContestId && 
        sub.problem.index === targetIndex;

      return isNewerSubmission && isCompilationError && isTargetProblem;
    });
  } catch (error) {
    console.error(`[CF Service Exception] Verification failure for ${handle}:`, error);
    throw new Error('Failed to completely cross-examine the Codeforces status endpoint.');
  }
};
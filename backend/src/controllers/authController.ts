import { Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '../config/db';
import { redis } from '../config/redis';
import { checkCFCompilationError, VERIFICATION_PROBLEMS } from '../services/cfService';

const handleValidator = z.object({
  handle: z.string().min(2).max(24).regex(/^[a-zA-Z0-9_.-]+$/),
});

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { handle, password } = req.body;
    
    const user = await prisma.user.findUnique({ where: { cfHandle: handle } });
    if (!user) {
      res.status(401).json({ error: 'Handle not found.' });
      return;
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid password.' });
      return;
    }

    res.status(200).json({ status: 'success', user });
  } catch (error) {
    res.status(500).json({ error: 'Login verification failed.' });
  }
};

export const requestRegistration = async (req: Request, res: Response): Promise<void> => {
  try {
    const { handle } = handleValidator.parse(req.body);
    
    const existingUser = await prisma.user.findUnique({ where: { cfHandle: handle } });
    if (existingUser) {
      res.status(400).json({ error: 'Handle is already registered.' });
      return;
    }

    const charSum = handle.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const targetProblem = VERIFICATION_PROBLEMS[charSum % VERIFICATION_PROBLEMS.length];
    const initiatedAt = Math.floor(Date.now() / 1000);

    const sessionPayload = JSON.stringify({ targetProblem, initiatedAt });
    await redis.set(`verification:session:${handle}`, sessionPayload, 'EX', 300); 
    
    res.status(200).json({ data: { targetProblem, expiresInSeconds: 300 } });
  } catch (error) {
    res.status(400).json({ error: 'Invalid payload formatting.' });
  }
};

export const confirmRegistration = async (req: Request, res: Response): Promise<void> => {
  try {
    const { handle, password } = req.body;
    
    const sessionData = await redis.get(`verification:session:${handle}`);
    if (!sessionData) {
      res.status(400).json({ error: 'Verification expired or not requested.' });
      return;
    }

    const { targetProblem, initiatedAt } = JSON.parse(sessionData);

    const hasCompilationError = await checkCFCompilationError(handle, targetProblem, initiatedAt); 

    if (hasCompilationError) {
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = await prisma.user.create({
        data: { cfHandle: handle, password: hashedPassword, rating: 1500 }
      });

      await redis.del(`verification:session:${handle}`);
      res.status(201).json({ status: 'success', user: newUser });
    } else {
      res.status(400).json({ error: 'Compilation Error not found yet.' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal system validation exception occurred.' });
  }
};
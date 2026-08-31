import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { prisma } from './config/db';
import authRoutes from './routes/authRoutes';
import { initializeSockets } from './sockets/socketManager';
import { startMatchmaker } from './services/matcher'; 
import { startCfDaemon } from './services/cfDaemon'; 
import { initializeProblemPool } from './services/problemPool';
import { startCustomDaemon } from './services/customDaemon'; 
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: '*' }));
app.use(express.json());

app.use('/api/auth', authRoutes);

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*', 
    methods: ['GET', 'POST']
  }
});

initializeSockets(io);
startMatchmaker(io);
startCfDaemon(io); 
app.get('/api/history/:handle', async (req, res) => {
  try {
    const { handle } = req.params;
    const history = await prisma.match.findMany({
      where: {
        OR: [
          { p1: handle },
          { p2: handle },
          { p2: { contains: handle } } // THE FIX: Searches inside the comma-separated string!
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 10 
    });
    res.json(history);
  } catch (error) {
    console.error('[API] Failed to fetch history', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});
initializeProblemPool().then(() => {
  httpServer.listen(PORT, () => console.log(`[Core System] Live on port ${PORT}`));
  startCfDaemon(io);        
    startCustomDaemon(io);    
});

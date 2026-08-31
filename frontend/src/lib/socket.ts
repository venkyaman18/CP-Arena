import { io } from 'socket.io-client';

export const socket = io(import.meta.env.VITE_BACKEND_URL, {
  autoConnect: false,
});

socket.on('connect', () => {
  console.log('[Socket] Uplink established with server.');
});

socket.on('disconnect', () => {
  console.log('[Socket] Connection lost or intentionally disconnected.');
});
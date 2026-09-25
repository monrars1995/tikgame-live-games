/**
 * server.js
 * Main entry point - Express + Socket.io Server
 *
 * MULTI-TENANT ARCHITECTURE:
 * - Each streamer = 1 isolated Socket.io Room
 * - Room ID = TikTok username
 * - Data isolation: Streamer A cannot see Streamer B's data
 *
 * @module server
 */

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import tiktokService from "./services/TikTokService.js";

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ==========================================
// SERVER INITIALIZATION
// ==========================================
const app = express();
const server = createServer(app);

// Socket.io with CORS enabled for development
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";

// ==========================================
// MIDDLEWARE & STATIC FILES
// ==========================================

// Serve static files from public directory
app.use(express.static(join(__dirname, "../public")));

// Parse JSON body
app.use(express.json());

// ==========================================
// API ROUTES
// ==========================================

/**
 * Health check endpoint
 * @route GET /api/health
 */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    stats: tiktokService.getStats(),
  });
});

/**
 * Get connection statistics
 * @route GET /api/stats
 */
app.get("/api/stats", (req, res) => {
  res.json(tiktokService.getStats());
});

// ==========================================
// SOCKET.IO - REALTIME CONNECTION HANDLING
// ==========================================

/** One Socket.io client subscribes to one streamer at a time. */
export function registerSocketHandlers(socket, roomIo = io, service = tiktokService) {
  let membershipVersion = 0;
  let pendingJoin = null;
  socket.tiktokUsername = null;

  const normalizeUsername = (value) => {
    if (typeof value !== "string") return null;
    const name = value.trim().replace(/^@/, "").toLowerCase();
    return /^[a-z0-9_.]+$/.test(name) ? name : null;
  };

  const leaveCurrentRoom = () => {
    const username = socket.tiktokUsername;
    if (!username) return;
    membershipVersion++;
    pendingJoin = null;
    socket.tiktokUsername = null;
    socket.leave(username);
    service.removeClientFromRoom(username);
    console.log(`[Socket] ${socket.id} left room: ${username}`);
  };

  socket.on("join-room", async (value) => {
    const username = normalizeUsername(value);
    if (!username) {
      socket.emit("error", { message: "Invalid username" });
      return;
    }
    if (socket.tiktokUsername !== username) {
      leaveCurrentRoom();
      socket.tiktokUsername = username;
      socket.join(username);
      service.addClientToRoom(username);
      console.log(`[Socket] ${socket.id} joined room: ${username}`);
    }
    if (pendingJoin?.username === username) return;

    const version = membershipVersion;
    const join = { username };
    pendingJoin = join;
    try {
      const connected = await service.connect(username, roomIo);
      if (socket.tiktokUsername !== username || membershipVersion !== version) return;
      if (connected) {
        socket.emit("room-joined", {
          room: username,
          message: `Joined room: ${username}`,
        });
      } else {
        socket.emit("connection-error", {
          message: `Cannot connect to ${username}'s live. Make sure they are currently streaming!`,
        });
      }
    } catch (error) {
      if (socket.tiktokUsername === username && membershipVersion === version) {
        socket.emit("connection-error", { message: error.message });
      }
    } finally {
      if (pendingJoin === join) pendingJoin = null;
    }
  });

  socket.on("leave-room", (value) => {
    if (normalizeUsername(value) === socket.tiktokUsername) leaveCurrentRoom();
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom();
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });

  socket.on("ping", () => socket.emit("pong", { timestamp: Date.now() }));
}

io.on("connection", (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  registerSocketHandlers(socket);
});

// ==========================================
// START SERVER
// ==========================================

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  server.listen(PORT, HOST, () => {
    console.log(`TikGame Live Games running at http://${HOST}:${PORT}`);
  });

  process.on("SIGINT", () => {
    for (const username of tiktokService.getStats().connections) {
      tiktokService.disconnect(username);
    }
    server.close(() => process.exit(0));
  });
}

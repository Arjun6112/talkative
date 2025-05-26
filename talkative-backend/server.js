import express from "express";
import { createServer } from "http"; // Back to http
import { Server } from "socket.io";
import cors from "cors";
import { networkInterfaces } from "os";

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://your-netlify-app.netlify.app",
      "https://talkative-production-8690.up.railway.app",
    ],
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});

app.use(cors());
app.use(express.json());

// Add a simple health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

// Function to get local IP addresses
function getLocalIPs() {
  const nets = networkInterfaces();
  const results = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        results.push(net.address);
      }
    }
  }
  return results;
}

// Store waiting users
const waitingUsers = new Set();
const activeConnections = new Map();
const connectedUsers = new Set(); // Track all connected users

// Function to broadcast user count to all clients
function broadcastUserCount() {
  const userCount = connectedUsers.size;
  io.emit("user-count", userCount);
  console.log(`👥 Broadcasting user count: ${userCount}`);
}

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id} from ${socket.handshake.address}`);

  // Add user to connected users and broadcast count
  connectedUsers.add(socket.id);
  broadcastUserCount();

  socket.on("find-peer", () => {
    console.log(`User ${socket.id} looking for peer`);

    // If there's someone waiting, match them
    if (waitingUsers.size > 0) {
      const waitingUser = waitingUsers.values().next().value;
      waitingUsers.delete(waitingUser);

      // Create connection mapping
      activeConnections.set(socket.id, waitingUser);
      activeConnections.set(waitingUser, socket.id);

      // Notify both users they've been matched
      socket.emit("matched");
      io.to(waitingUser).emit("matched");

      console.log(`Matched ${socket.id} with ${waitingUser}`);
    } else {
      // Add to waiting list
      waitingUsers.add(socket.id);
      console.log(`Added ${socket.id} to waiting list`);
    }
  });

  socket.on("stop-search", () => {
    waitingUsers.delete(socket.id);
    console.log(`Removed ${socket.id} from waiting list`);
  });

  socket.on("skip-peer", () => {
    const peerId = activeConnections.get(socket.id);
    if (peerId) {
      // Notify peer they were disconnected
      io.to(peerId).emit("peer-disconnected");

      // Clean up connections
      activeConnections.delete(socket.id);
      activeConnections.delete(peerId);

      console.log(`${socket.id} skipped ${peerId}`);
    }
  });

  // WebRTC signaling
  socket.on("offer", (offer) => {
    const peerId = activeConnections.get(socket.id);
    if (peerId) {
      io.to(peerId).emit("offer", offer);
    }
  });

  socket.on("answer", (answer) => {
    const peerId = activeConnections.get(socket.id);
    if (peerId) {
      io.to(peerId).emit("answer", answer);
    }
  });

  socket.on("ice-candidate", (candidate) => {
    const peerId = activeConnections.get(socket.id);
    if (peerId) {
      io.to(peerId).emit("ice-candidate", candidate);
    }
  });

  // Chat message handling
  socket.on("chat-message", (message) => {
    const peerId = activeConnections.get(socket.id);
    if (peerId) {
      io.to(peerId).emit("chat-message", message);
      console.log(`Chat message from ${socket.id} to ${peerId}`);
    }
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);

    // Remove from all sets and maps
    waitingUsers.delete(socket.id);
    connectedUsers.delete(socket.id);

    // Notify peer if they were in a chat
    const peerId = activeConnections.get(socket.id);
    if (peerId) {
      io.to(peerId).emit("peer-disconnected");
      activeConnections.delete(peerId);
    }
    activeConnections.delete(socket.id);

    // Broadcast updated user count
    broadcastUserCount();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  const isProduction = process.env.NODE_ENV === "production";
  const baseUrl = isProduction
    ? "https://talkative-production-8690.up.railway.app"
    : `http://localhost:${PORT}`;

  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📱 Access: ${baseUrl}`);
  console.log(`🔍 Health check: ${baseUrl}/health`);
  console.log("👥 Waiting for connections...");
});

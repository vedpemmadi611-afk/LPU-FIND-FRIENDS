const express = require("express");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

const PORT = Number(process.env.PORT || 3000);
const CATEGORIES = new Set([
  "friends", "hackathon", "roommate", "gaming", "relationship", "projects"
]);
const MAX_MESSAGE_LENGTH = 500;
const MAX_MESSAGES_PER_WINDOW = 12;
const RATE_WINDOW_MS = 10_000;
const IDLE_QUEUE_TTL_MS = 60_000;
const clients = new Map(); // ws -> client session
const queues = new Map();  // category -> [clientId]
const rooms = new Map();   // roomId -> { category, members:Set<clientId> }
const queueTimers = new Map();

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  next();
});
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/health", (_req, res) => res.json({ ok: true }));

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
function sendClient(client, payload) {
  if (client && client.ws) send(client.ws, payload);
}
function getQueue(category) {
  if (!queues.has(category)) queues.set(category, []);
  return queues.get(category);
}
function removeFromQueue(client) {
  if (!client || !client.queuedCategory) return;
  const q = queues.get(client.queuedCategory);
  if (q) {
    const index = q.indexOf(client.id);
    if (index !== -1) q.splice(index, 1);
  }
  const timer = queueTimers.get(client.id);
  if (timer) clearTimeout(timer);
  queueTimers.delete(client.id);
  client.queuedCategory = null;
}
function getClientById(id) {
  for (const client of clients.values()) if (client.id === id) return client;
  return null;
}
function cleanRoom(roomId, leavingId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.members.delete(leavingId);
  for (const memberId of room.members) {
    const peer = getClientById(memberId);
    if (peer) {
      peer.roomId = null;
      sendClient(peer, { type: "partner-left", message: "Your partner disconnected. Choose a category to meet someone else." });
    }
  }
  rooms.delete(roomId);
}
function leave(client, notifyPeer = true) {
  removeFromQueue(client);
  if (client.roomId) {
    const roomId = client.roomId;
    const room = rooms.get(roomId);
    client.roomId = null;
    if (room) {
      if (notifyPeer) {
        for (const memberId of room.members) {
          if (memberId === client.id) continue;
          const peer = getClientById(memberId);
          if (peer) {
            peer.roomId = null;
            sendClient(peer, { type: "partner-left", message: "Your partner left the chat." });
          }
        }
      }
      rooms.delete(roomId);
    }
  }
  client.category = null;
}
function queueTimeout(client) {
  const timer = setTimeout(() => {
    if (client.queuedCategory) {
      const category = client.queuedCategory;
      removeFromQueue(client);
      sendClient(client, { type: "queue-timeout", message: "No partner found yet. Try again or choose another category." });
    }
  }, IDLE_QUEUE_TTL_MS);
  queueTimers.set(client.id, timer);
}
function match(client, category) {
  leave(client);
  client.category = category;
  const q = getQueue(category);
  let partner = null;

  // Choose a random eligible person from this category's waiting queue.
  // Remove stale queue entries as we inspect candidates.
  const eligible = [];
  for (let i = q.length - 1; i >= 0; i--) {
    const candidate = getClientById(q[i]);
    if (!candidate || candidate === client ||
        candidate.queuedCategory !== category || candidate.roomId) {
      q.splice(i, 1);
    } else {
      eligible.push(candidate);
    }
  }
  if (eligible.length) {
    partner = eligible[Math.floor(Math.random() * eligible.length)];
    const queueIndex = q.indexOf(partner.id);
    if (queueIndex !== -1) q.splice(queueIndex, 1);
    const timer = queueTimers.get(partner.id);
    if (timer) clearTimeout(timer);
    queueTimers.delete(partner.id);
    partner.queuedCategory = null;
  }
  if (!partner) {
    client.queuedCategory = category;
    q.push(client.id);
    sendClient(client, { type: "searching", category, message: "Looking for someone in this category…" });
    queueTimeout(client);
    return;
  }
  const roomId = crypto.randomUUID();
  const room = { id: roomId, category, members: new Set([client.id, partner.id]) };
  rooms.set(roomId, room);
  client.roomId = roomId;
  partner.roomId = roomId;
  client.queuedCategory = null;
  partner.queuedCategory = null;
  sendClient(client, { type: "matched", category, roomId, message: "You're connected! Say hello." });
  sendClient(partner, { type: "matched", category, roomId, message: "You're connected! Say hello." });
}
function handleMessage(client, raw) {
  if (typeof raw !== "string" || raw.length > 4096) return;
  let data;
  try { data = JSON.parse(raw); } catch { return; }
  if (!data || typeof data.type !== "string") return;

  if (data.type === "join") {
    const category = String(data.category || "");
    if (!CATEGORIES.has(category)) {
      sendClient(client, { type: "error", message: "That category is not available." });
      return;
    }
    match(client, category);
    return;
  }
  if (data.type === "leave") {
    leave(client);
    sendClient(client, { type: "left", message: "You left the chat." });
    return;
  }
  if (data.type === "chat") {
    const text = typeof data.text === "string" ? data.text.trim() : "";
    if (!client.roomId || !text || text.length > MAX_MESSAGE_LENGTH) return;
    const now = Date.now();
    client.rateTimes = client.rateTimes.filter(t => now - t < RATE_WINDOW_MS);
    if (client.rateTimes.length >= MAX_MESSAGES_PER_WINDOW) {
      sendClient(client, { type: "error", message: "You're sending messages too quickly. Please slow down." });
      return;
    }
    client.rateTimes.push(now);
    const room = rooms.get(client.roomId);
    if (!room || !room.members.has(client.id)) return;
    for (const memberId of room.members) {
      const peer = getClientById(memberId);
      if (peer) sendClient(peer, { type: "chat", text, mine: memberId === client.id, at: now });
    }
    return;
  }
  if (data.type === "report") {
    // This demo does not persist reports or identify users. Add a protected moderation workflow before public launch.
    leave(client);
    sendClient(client, { type: "reported", message: "You've left this chat. This demo does not send reports to a moderation team." });
  }
}
server.on("upgrade", (request, socket, head) => {
  // Only accept WebSocket connections on /ws.
  if (request.url !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws, request));
});
wss.on("connection", ws => {
  const client = {
    id: crypto.randomUUID(), ws, roomId: null, category: null,
    queuedCategory: null, rateTimes: []
  };
  clients.set(ws, client);
  send(ws, { type: "ready", message: "Connected to LinkUp. Choose a category to find a partner." });
  ws.on("message", raw => handleMessage(client, raw.toString()));
  ws.on("close", () => {
    leave(client, true);
    clients.delete(ws);
  });
  ws.on("error", () => {
    leave(client, true);
    clients.delete(ws);
  });
});
server.listen(PORT, () => {
  console.log(`LinkUp is running at http://localhost:${PORT}`);
});

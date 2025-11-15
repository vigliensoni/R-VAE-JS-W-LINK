const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");
const AbletonLink = require("abletonlink");

const PORT = Number(process.env.PORT) || 3000;
const BROADCAST_INTERVAL_MS = 50;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve static assets from the built client bundle by default.
const staticDir = path.join(__dirname, "..", "dist");
app.use(express.static(staticDir));

// Ableton Link session (default: 160 BPM, quantum = 4 beats, enabled).
const link = new AbletonLink(160, 4, true);

// Shared clock state that all WebSocket clients follow.
let beatPosition = 0;
let lastUpdate = Date.now() / 1000;

function updateClock() {
  const now = Date.now() / 1000;
  const delta = now - lastUpdate;
  lastUpdate = now;

  const secondsPerBeat = 60 / link.bpm;
  beatPosition += delta / secondsPerBeat;

  // Keep a four-beat phase for convenience (0-4 range)
  const phase = beatPosition % 4;

  return { beat: beatPosition, phase };
}

function broadcastState() {
  const { beat, phase } = updateClock();
  const payload = JSON.stringify({
    bpm: link.bpm,
    beat,
    phase,
    serverTime: Date.now(),
  });

  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(payload);
  });
}

setInterval(broadcastState, BROADCAST_INTERVAL_MS);

wss.on("connection", (ws) => {
  console.log("Browser client connected to Ableton Link bridge");

  // Immediately send the current state so the client can sync quickly.
  const { beat, phase } = updateClock();
  ws.send(
    JSON.stringify({
      bpm: link.bpm,
      beat,
      phase,
      serverTime: Date.now(),
    })
  );

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (typeof data.bpm === "number" && Number.isFinite(data.bpm) && data.bpm > 0) {
        link.bpm = data.bpm;
        console.log(`Tempo updated via WebSocket: ${data.bpm} BPM`);

        // Reset integration so the next broadcast starts from the new tempo.
        lastUpdate = Date.now() / 1000;
      }
    } catch (err) {
      console.warn("Ignoring malformed message from client:", err);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Ableton Link bridge available at http://localhost:${PORT}`);
});


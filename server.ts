import express from "express";
import path from "path";
import multer from "multer";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { parseTorrent } from "./src/server/torrent-parser";
import { TorrentEngine } from "./src/server/torrent-engine";

async function startServer() {
  const app = express();
  const PORT = 3000;

  const storage = multer.memoryStorage();
  const upload = multer({ storage });

  let activeEngine: TorrentEngine | null = null;
  let sseClients: any[] = [];
  let currentLogs: string[] = [];

  const broadcast = (data: any) => {
    for (const client of sseClients) {
      client.res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  const addLog = (msg: string) => {
    currentLogs.push(msg);
    if (currentLogs.length > 50) currentLogs.shift();
    broadcast({ type: 'log', message: msg });
  };

  app.post("/api/upload", upload.single('torrent'), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const torrentInfo = parseTorrent(req.file.buffer);

      if (activeEngine) {
         activeEngine.stop();
      }
      currentLogs = [];

      const peerId = '-ND0001-' + crypto.randomBytes(6).toString('hex');
      const allAnnounce = torrentInfo.announceList ? torrentInfo.announceList.flat() : [torrentInfo.announce];

      activeEngine = new TorrentEngine(
        crypto.randomUUID(), 
        torrentInfo.infoHash, 
        peerId, 
        allAnnounce, 
        torrentInfo.pieces, 
        torrentInfo.pieceLength, 
        torrentInfo.length
      );

      activeEngine.on('log', (msg) => addLog(msg));
      activeEngine.on('update', (state) => broadcast({ type: 'state', state }));

      activeEngine.start();
      
      res.json({ 
        success: true, 
        name: torrentInfo.name, 
        length: torrentInfo.length, 
        pieces: torrentInfo.pieces.length / 20 
      });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message || 'Error parsing torrent' });
    }
  });

  app.get("/api/stream", (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const client = { id: crypto.randomUUID(), res };
    sseClients.push(client);

    if (activeEngine) {
      res.write(`data: ${JSON.stringify({ type: 'state', state: activeEngine.getProgress() })}\n\n`);
    }
    for (const msg of currentLogs) {
       res.write(`data: ${JSON.stringify({ type: 'log', message: msg })}\n\n`);
    }

    req.on('close', () => {
      sseClients = sseClients.filter(c => c.id !== client.id);
    });
  });

  app.post("/api/stop", (req, res) => {
    if (activeEngine) {
      activeEngine.stop();
      activeEngine = null;
    }
    broadcast({ type: 'state', state: null });
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

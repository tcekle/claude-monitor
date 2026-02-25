import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { networkInterfaces } from 'os';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import { HookManager } from './hook-manager.js';
import { ensureDataDirs } from './persistence.js';
import { loadTranscripts } from './transcript-loader.js';

const PORT = process.env.PORT || 3500;
const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '10mb' }));

const server = createServer(app);

// WebSocket server on /ws path
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Hook-based session manager
const hookManager = new HookManager();

// Broadcast to all connected WebSocket clients
function broadcast(data) {
  const json = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(json);
    }
  }
}

// Forward hookManager events to all clients
hookManager.on('instance_created', (data) => {
  console.log(`[broadcast] instance_created: "${data.name}" (${data.id?.slice(0, 8)})`);
  broadcast({ type: 'instance_created', ...data });
});

hookManager.on('message', (data) => {
  console.log(`[broadcast] message to ${data.id?.slice(0, 8)}: type=${data.message?.type}`);
  broadcast({ type: 'message', id: data.id, message: data.message });
});

hookManager.on('instance_status', (data) => {
  console.log(`[broadcast] instance_status: ${data.id?.slice(0, 8)} → ${data.status}`);
  broadcast({ type: 'instance_status', ...data });
});

hookManager.on('instance_usage', (data) => {
  broadcast({ type: 'instance_usage', id: data.id, usage: data.usage });
});

// WebSocket connection handler
wss.on('connection', (ws) => {
  const snapshot = hookManager.getSnapshot();
  console.log(`[ws] Client connected — sending snapshot with ${snapshot.length} sessions`);

  ws.send(JSON.stringify({
    type: 'snapshot',
    instances: snapshot,
  }));

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    console.log('[ws] Received:', JSON.stringify(msg).slice(0, 200));
    try {
      switch (msg.action) {
        case 'approve': {
          // Resolve the clicked one first to find the session
          const pending = hookManager.getDecision(msg.pendingId);
          hookManager.resolveDecision(msg.pendingId, 'allow', msg.reason);
          // Also resolve any other pending decisions for the same session
          if (pending) {
            for (const p of hookManager.pendingDecisions.values()) {
              if (p.sessionId === pending.sessionId && !p.decided) {
                hookManager.resolveDecision(p.pendingId, 'allow', 'Batch approved');
              }
            }
          }
          break;
        }

        case 'reject':
          hookManager.resolveDecision(msg.pendingId, 'deny', msg.reason || 'Rejected by user');
          break;

        case 'approve_session':
          hookManager.setAutoApprove(msg.sessionId, true);
          break;

        case 'rename': {
          const session = hookManager.sessions.get(msg.id);
          if (session) {
            session.name = msg.name;
            broadcast({ type: 'instance_renamed', id: msg.id, name: msg.name });
          }
          break;
        }

        default:
          ws.send(JSON.stringify({ type: 'error', message: `Unknown action: ${msg.action}` }));
      }
    } catch (err) {
      console.error('[ws] Error handling message:', err.message);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  ws.on('close', () => {
    console.log('[ws] Client disconnected');
  });
});

// =============================================
// Hook API — called by hook-bridge.mjs
// =============================================

// Receive hook events from Claude Code
app.post('/api/hooks/:eventType', (req, res) => {
  const { eventType } = req.params;
  const data = req.body;

  console.log(`[hook-api] ${eventType} from session ${data.session_id?.slice(0, 8) || '?'}`);

  try {
    const result = hookManager.handleEvent(eventType, data);
    res.json(result);
  } catch (err) {
    console.error(`[hook-api] Error handling ${eventType}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Long-poll for PreToolUse decisions (called by hook-bridge.mjs)
app.get('/api/hooks/decision/:pendingId', (req, res) => {
  const { pendingId } = req.params;
  const pending = hookManager.getDecision(pendingId);

  if (!pending) {
    return res.status(404).json({ error: 'Pending decision not found' });
  }

  if (pending.decided) {
    return res.json({
      decided: true,
      decision: pending.decision,
      reason: pending.reason,
      updatedInput: pending.updatedInput,
    });
  }

  // Not yet decided
  res.json({ decided: false });
});

// REST API endpoints
app.get('/api/instances', (req, res) => {
  res.json(hookManager.getSnapshot());
});

// Git branch for a given working directory
app.get('/api/git-branch', (req, res) => {
  const cwd = req.query.cwd;
  if (!cwd || typeof cwd !== 'string') {
    return res.json({ branch: null });
  }
  exec('git rev-parse --abbrev-ref HEAD', { cwd, timeout: 3000 }, (err, stdout) => {
    if (err) {
      console.log(`[git-branch] failed for cwd=${cwd}: ${err.message}`);
      return res.json({ branch: null });
    }
    res.json({ branch: stdout.trim() || null });
  });
});

// Settings generator — returns the .claude/settings.json hooks config
app.get('/api/hooks-config', (req, res) => {
  const bridgePath = join(__dirname, 'hooks', 'hook-bridge.mjs').replace(/\\/g, '/');
  const serverUrl = `http://localhost:${PORT}`;

  const config = {
    hooks: {
      SessionStart: [{
        matcher: '',
        hooks: [{
          type: 'command',
          command: `node "${bridgePath}" SessionStart`,
          timeout: 10,
        }],
      }],
      PreToolUse: [{
        matcher: '',
        hooks: [{
          type: 'command',
          command: `CLAUDE_MONITOR_URL=${serverUrl} node "${bridgePath}" PreToolUse`,
          timeout: 600,
        }],
      }],
      PostToolUse: [{
        matcher: '',
        hooks: [{
          type: 'command',
          command: `node "${bridgePath}" PostToolUse`,
          timeout: 10,
          async: true,
        }],
      }],
      PostToolUseFailure: [{
        matcher: '',
        hooks: [{
          type: 'command',
          command: `node "${bridgePath}" PostToolUseFailure`,
          timeout: 10,
          async: true,
        }],
      }],
      Stop: [{
        matcher: '',
        hooks: [{
          type: 'command',
          command: `node "${bridgePath}" Stop`,
          timeout: 10,
          async: true,
        }],
      }],
      SessionEnd: [{
        matcher: '',
        hooks: [{
          type: 'command',
          command: `node "${bridgePath}" SessionEnd`,
          timeout: 10,
          async: true,
        }],
      }],
      Notification: [{
        matcher: '',
        hooks: [{
          type: 'command',
          command: `node "${bridgePath}" Notification`,
          timeout: 10,
          async: true,
        }],
      }],
    },
  };

  res.json(config);
});

// Serve Angular build in production
const clientDist = join(__dirname, '..', '..', 'client', 'dist', 'client', 'browser');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('/{*path}', (req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
}

// Start
async function start() {
  await ensureDataDirs();
  loadTranscripts(hookManager);

  server.listen(PORT, '0.0.0.0', () => {
    const bridgePath = join(__dirname, 'hooks', 'hook-bridge.mjs').replace(/\\/g, '/');
    console.log(`\n[server] Claude Monitor running on http://localhost:${PORT}`);
    console.log(`[server] Hook bridge: ${bridgePath}`);
    console.log(`[server] Get hooks config: http://localhost:${PORT}/api/hooks-config`);

    // Log LAN IPs
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`[server] LAN: http://${net.address}:${PORT}`);
        }
      }
    }
    console.log('');
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

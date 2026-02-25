> **Disclaimer:** This project was 100% generated using Claude (Anthropic). It has not been fully audited for security or production readiness. Use at your own risk and review the code carefully before deploying in any environment.

---

# Claude Code Monitor

A web-based monitoring interface for [Claude Code](https://claude.ai/code) CLI sessions. It allows you to observe running Claude Code instances in real time from any browser, review tool use requests, approve or deny them, and track session activity — all without being at the terminal where Claude is running.

## How It Works

Claude Code supports [hooks](https://docs.anthropic.com/claude-code/hooks) — shell commands that are called at key points during a session (tool use, session start/stop, notifications). This project uses those hooks to bridge Claude Code events to a local HTTP server, which then pushes them to a web UI via WebSocket.

When Claude Code wants to use a tool (e.g. run a Bash command or edit a file), the hook calls a bridge script that posts the event to the monitor server and waits for an approve/deny decision from the UI before proceeding.

```
Claude Code  →  hook-bridge.mjs  →  Express server  →  WebSocket  →  Angular UI
                (PreToolUse)           (3500)                           (5200 dev)
```

## Stack

- **Frontend:** Angular 21, PrimeNG 21, TailwindCSS 4
- **Backend:** Node.js, Express 5, ws (WebSocket)
- **Markdown rendering:** marked + highlight.js

## Project Structure

```
src/
  server/
    src/
      server.js          # Express + WebSocket server
      hook-manager.js    # Session and approval state
      persistence.js     # Data directory helpers
      hooks/
        hook-bridge.mjs  # Script called by Claude Code hooks
  client/
    src/
      app/
        components/      # Angular components
        services/        # WebSocket, store, markdown, notifications
        models/          # TypeScript interfaces
```

## Prerequisites

- Node.js 20+
- npm 10+

## Setup

**1. Install dependencies**

```bash
npm install
```

**2. Build the frontend**

```bash
npm run build
```

**3. Configure Claude Code hooks**

Add the following to your `~/.claude/settings.json` (adjust the path to match your installation):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/path/to/src/server/src/hooks/hook-bridge.mjs\" PreToolUse",
            "timeout": 600
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/path/to/src/server/src/hooks/hook-bridge.mjs\" PostToolUse",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/path/to/src/server/src/hooks/hook-bridge.mjs\" SessionStart",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/path/to/src/server/src/hooks/hook-bridge.mjs\" Stop",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/path/to/src/server/src/hooks/hook-bridge.mjs\" Notification",
            "timeout": 10,
            "async": true
          }
        ]
      }
    ]
  }
}
```

The server URL defaults to `http://localhost:3500`. This is hardcoded in `hook-bridge.mjs` and can be changed if needed.

## Running

**Production** (serves built Angular app from the Express server on port 3500):

```bash
npm start
```

Open `http://localhost:3500` in your browser.

**Development** (hot-reloading frontend on port 5200, API proxied to 3500):

```bash
npm run dev
```

Open `http://localhost:5200` in your browser.

## Usage

1. Start the monitor server.
2. Start a Claude Code session in any directory — it will appear as a tab automatically.
3. When Claude requests to use a tool, the UI will display the request with **Approve** / **Reject** buttons.
   - **Approve** — allows the current tool use (and any others queued in the same batch).
   - **Yes, don't ask again** — approves and auto-approves all future tool uses for the session.
   - **Reject** — denies the tool use; Claude receives an error and can adapt.
4. Tool results, assistant messages, and session events stream in real time.
5. Double-click a session tab to rename it.

## Notes

- The `PreToolUse` hook is **synchronous** and blocks Claude until a decision is made (up to 10 minutes by default). If the monitor server is not running, the hook falls back to `permissionDecision: "ask"` so Claude is not permanently blocked.
- Session data is held in memory only — it is not persisted across server restarts.
- The monitor does not spawn or control Claude Code sessions; it only observes and gates tool use via hooks.

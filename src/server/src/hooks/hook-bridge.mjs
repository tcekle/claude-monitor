#!/usr/bin/env node

/**
 * Claude Code Hook Bridge
 *
 * This script is called by Claude Code hooks. It:
 * 1. Reads the hook event JSON from stdin
 * 2. POSTs it to the Claude Monitor server
 * 3. For PreToolUse: long-polls for an approve/deny decision
 * 4. Returns appropriate JSON to Claude Code
 *
 * Usage in .claude/settings.json:
 *   "command": "node /path/to/hook-bridge.mjs PreToolUse"
 *
 * Environment:
 *   CLAUDE_MONITOR_URL  — server URL (default: http://localhost:3500)
 */

import http from 'http';
import https from 'https';

const EVENT_TYPE = process.argv[2] || 'unknown';
const SERVER = process.env.CLAUDE_MONITOR_URL || 'http://localhost:3500';
const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 600_000; // 10 minutes (matches hook timeout default)

function httpRequest(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // Read stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    data = { raw: input };
  }

  const payload = {
    eventType: EVENT_TYPE,
    ...data,
    _hookTs: Date.now(),
  };

  try {
    const res = await httpRequest('POST', `${SERVER}/api/hooks/${EVENT_TYPE}`, payload);

    if (EVENT_TYPE === 'PreToolUse' && res.body?.pendingId) {
      // Long-poll for decision
      const pendingId = res.body.pendingId;
      const startTime = Date.now();

      while (Date.now() - startTime < MAX_WAIT_MS) {
        await sleep(POLL_INTERVAL_MS);

        const poll = await httpRequest('GET', `${SERVER}/api/hooks/decision/${pendingId}`);

        if (poll.body?.decided) {
          const decision = poll.body.decision; // 'allow' | 'deny'

          if (decision === 'allow') {
            const output = {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
                permissionDecisionReason: 'Approved via Claude Monitor UI',
              },
            };
            if (poll.body.updatedInput) {
              output.hookSpecificOutput.updatedInput = poll.body.updatedInput;
            }
            process.stdout.write(JSON.stringify(output));
            process.exit(0);
          } else {
            // Deny: exit code 2 with stderr message
            process.stderr.write(poll.body.reason || 'Rejected via Claude Monitor UI');
            process.exit(2);
          }
        }
      }

      // Timeout — deny by default
      process.stderr.write('Claude Monitor: approval timed out');
      process.exit(2);

    } else if (res.body?.output) {
      // Server returned JSON to pass back to Claude Code
      process.stdout.write(JSON.stringify(res.body.output));
      process.exit(res.body.exitCode || 0);
    }
  } catch (err) {
    // If server is unreachable, don't block Claude — allow by default
    process.stderr.write(`Claude Monitor unreachable (${err.code || err.message}), allowing by default\n`);
    if (EVENT_TYPE === 'PreToolUse') {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: 'Claude Monitor server unreachable, falling back to normal permission flow',
        },
      }));
    }
    process.exit(0);
  }
}

main().catch((err) => {
  process.stderr.write(`Hook bridge error: ${err.message}`);
  process.exit(0); // Don't block Claude on errors
});

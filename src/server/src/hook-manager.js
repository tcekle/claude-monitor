import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';

function log(tag, ...args) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}][${tag}]`, ...args);
}

/**
 * HookManager — manages sessions and tool approvals based on
 * events received from Claude Code hooks (via HTTP API).
 *
 * Sessions are keyed by Claude Code's session_id.
 * Tool approvals are tracked with pending decisions.
 */
export class HookManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, HookSession>} */
    this.sessions = new Map();
    /** @type {Map<string, PendingDecision>} */
    this.pendingDecisions = new Map();
  }

  /** Handle an incoming hook event */
  handleEvent(eventType, data) {
    const sessionId = data.session_id || 'unknown';

    switch (eventType) {
      case 'SessionStart':
        return this._handleSessionStart(sessionId, data);
      case 'PreToolUse':
        return this._handlePreToolUse(sessionId, data);
      case 'PostToolUse':
        return this._handlePostToolUse(sessionId, data);
      case 'PostToolUseFailure':
        return this._handlePostToolUseFailure(sessionId, data);
      case 'Stop':
        return this._handleStop(sessionId, data);
      case 'SessionEnd':
        return this._handleSessionEnd(sessionId, data);
      case 'Notification':
        return this._handleNotification(sessionId, data);
      default:
        return this._handleGenericEvent(eventType, sessionId, data);
    }
  }

  /** Resolve a pending tool approval */
  resolveDecision(pendingId, decision, reason, updatedInput) {
    const pending = this.pendingDecisions.get(pendingId);
    if (!pending) {
      log('decision', `Pending ${pendingId} not found`);
      return false;
    }

    log('decision', `Resolving ${pendingId}: ${decision} (${reason || 'no reason'})`);
    pending.decided = true;
    pending.decision = decision;
    pending.reason = reason || '';
    pending.updatedInput = updatedInput || null;
    pending.decidedAt = Date.now();

    // Update session status
    const session = this.sessions.get(pending.sessionId);
    if (session && session.status === 'awaiting_approval') {
      session.status = 'running';
      this.emit('instance_status', { id: pending.sessionId, status: 'running' });
    }

    this.emit('message', {
      id: pending.sessionId,
      message: {
        type: 'user_input',
        text: decision === 'allow' ? `Approved: ${pending.toolName}` : `Rejected: ${pending.toolName}`,
        ts: Date.now(),
      },
    });

    return true;
  }

  /** Auto-approve all future tool uses for a session */
  setAutoApprove(sessionId, enabled) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      log('auto-approve', `Session ${sessionId} not found`);
      return false;
    }
    session.autoApprove = enabled;
    log('auto-approve', `Session ${sessionId.slice(0, 8)}: autoApprove=${enabled}`);

    // Also resolve any currently pending decisions for this session
    if (enabled) {
      for (const pending of this.pendingDecisions.values()) {
        if (pending.sessionId === sessionId && !pending.decided) {
          this.resolveDecision(pending.pendingId, 'allow', 'Auto-approved for session');
        }
      }
    }
    return true;
  }

  /** Get a pending decision (for long-poll from hook script) */
  getDecision(pendingId) {
    return this.pendingDecisions.get(pendingId) || null;
  }

  /** Get snapshot of all sessions for WebSocket clients */
  getSnapshot() {
    const instances = [];
    for (const [id, session] of this.sessions) {
      instances.push({
        id: session.id,
        name: session.name,
        prompt: session.prompt || '(hook session)',
        cwd: session.cwd,
        status: session.status,
        pid: null,
        stdinAvailable: false,
        messages: session.messages,
        usage: session.usage || null,
      });
    }
    return instances;
  }

  // --- Event handlers ---

  _handleSessionStart(sessionId, data) {
    log('session', `SessionStart: ${sessionId} (model=${data.model}, source=${data.source})`);

    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        name: this._buildName(data.cwd, sessionId),
        prompt: '',
        cwd: data.cwd || '',
        status: 'running',
        model: data.model,
        permissionMode: data.permission_mode,
        messages: [],
        createdAt: Date.now(),
      };
      this.sessions.set(sessionId, session);

      this.emit('instance_created', {
        id: sessionId,
        name: session.name,
        prompt: session.prompt,
        cwd: session.cwd,
        status: 'running',
        pid: null,
        stdinAvailable: false,
      });
    } else {
      // Resumed session
      session.status = 'running';
      this.emit('instance_status', { id: sessionId, status: 'running' });
    }

    this._addMessage(session, {
      type: 'system',
      text: `Session ${data.source || 'started'} (model: ${data.model || 'unknown'})`,
      ts: Date.now(),
    });

    return {};
  }

  _handlePreToolUse(sessionId, data) {
    const toolName = data.tool_name || 'unknown';
    const toolInput = data.tool_input || {};
    const toolUseId = data.tool_use_id || randomUUID();

    log('pre-tool', `[${sessionId.slice(0, 8)}] PreToolUse: ${toolName}`);

    const session = this._ensureSession(sessionId, data);

    // Create a pending decision
    const pendingId = randomUUID();
    const autoApprove = !!session.autoApprove;
    this.pendingDecisions.set(pendingId, {
      pendingId,
      sessionId,
      toolName,
      toolInput,
      toolUseId,
      decided: autoApprove,
      decision: autoApprove ? 'allow' : null,
      reason: autoApprove ? 'Auto-approved for session' : null,
      updatedInput: null,
      createdAt: Date.now(),
      decidedAt: autoApprove ? Date.now() : null,
    });

    if (!autoApprove) {
      // Update session status
      session.status = 'awaiting_approval';
      this.emit('instance_status', { id: sessionId, status: 'awaiting_approval' });
    }

    // Emit tool_use message to UI
    this._addMessage(session, {
      type: 'tool_use',
      toolName,
      toolId: toolUseId,
      input: toolInput,
      pendingId,
      ts: Date.now(),
    });

    return { pendingId };
  }

  _handlePostToolUse(sessionId, data) {
    const toolName = data.tool_name || 'unknown';
    log('post-tool', `[${sessionId.slice(0, 8)}] PostToolUse: ${toolName}`);

    const session = this._ensureSession(sessionId, data);

    if (session.status === 'awaiting_approval') {
      session.status = 'running';
      this.emit('instance_status', { id: sessionId, status: 'running' });
    }

    this._addMessage(session, {
      type: 'tool_result',
      toolId: data.tool_use_id,
      toolName,
      content: data.tool_response,
      ts: Date.now(),
    });

    return {};
  }

  _handlePostToolUseFailure(sessionId, data) {
    const toolName = data.tool_name || 'unknown';
    log('post-tool-fail', `[${sessionId.slice(0, 8)}] PostToolUseFailure: ${toolName} — ${data.error}`);

    const session = this._ensureSession(sessionId, data);

    this._addMessage(session, {
      type: 'tool_result',
      toolId: data.tool_use_id,
      toolName,
      content: `Error: ${data.error}`,
      isError: true,
      ts: Date.now(),
    });

    return {};
  }

  _handleStop(sessionId, data) {
    log('stop', `[${sessionId.slice(0, 8)}] Stop`);

    const session = this._ensureSession(sessionId, data);
    session.status = 'idle';
    this.emit('instance_status', { id: sessionId, status: 'idle' });

    const usage = this._readUsageFromTranscript(data.transcript_path);
    if (usage) {
      session.usage = usage;
      this.emit('instance_usage', { id: sessionId, usage });
    }

    if (data.last_assistant_message) {
      this._addMessage(session, {
        type: 'assistant',
        text: data.last_assistant_message,
        ts: Date.now(),
      });
    }

    return {};
  }

  _handleSessionEnd(sessionId, data) {
    log('session-end', `[${sessionId.slice(0, 8)}] SessionEnd: reason=${data.reason}`);

    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'done';
      this._addMessage(session, {
        type: 'system',
        text: `Session ended (${data.reason || 'unknown reason'})`,
        ts: Date.now(),
      });
      this.emit('instance_status', { id: sessionId, status: 'done' });
    }

    return {};
  }

  _handleNotification(sessionId, data) {
    log('notification', `[${sessionId.slice(0, 8)}] Notification: ${data.message || data.notification_type}`);

    const session = this._ensureSession(sessionId, data);
    const text = data.message || data.notification_type || 'Notification';
    this._addMessage(session, {
      type: 'system',
      text,
      ts: Date.now(),
    });

    return {};
  }

  _handleGenericEvent(eventType, sessionId, data) {
    log('event', `[${sessionId.slice(0, 8)}] ${eventType}`);

    const session = this._ensureSession(sessionId, data);
    this._addMessage(session, {
      type: 'event',
      eventType,
      data,
      ts: Date.now(),
    });

    return {};
  }

  _ensureSession(sessionId, data) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        name: this._buildName(data.cwd, sessionId),
        prompt: '',
        cwd: data.cwd || '',
        status: 'running',
        messages: [],
        createdAt: Date.now(),
      };
      this.sessions.set(sessionId, session);
      this.emit('instance_created', {
        id: sessionId,
        name: session.name,
        prompt: '',
        cwd: session.cwd,
        status: 'running',
        pid: null,
        stdinAvailable: false,
      });
    }
    return session;
  }

  _readUsageFromTranscript(transcriptPath) {
    if (!transcriptPath) return null;
    try {
      const content = readFileSync(transcriptPath, 'utf8');
      const lines = content.trim().split('\n');
      // Walk backwards to find the last assistant message with usage
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === 'assistant' && entry.message?.usage) {
            return entry.message.usage;
          }
        } catch { /* skip malformed lines */ }
      }
    } catch (err) {
      log('transcript', `Failed to read ${transcriptPath}: ${err.message}`);
    }
    return null;
  }

  _buildName(cwd, sessionId) {
    if (cwd) {
      const folder = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop();
      if (folder) return folder;
    }
    return `Session ${sessionId.slice(0, 8)}`;
  }

  _addMessage(session, message) {
    session.messages.push(message);
    this.emit('message', { id: session.id, message });
  }
}

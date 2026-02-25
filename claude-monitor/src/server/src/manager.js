import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { createReadStream, existsSync, statSync, watch } from 'fs';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import {
  saveInstanceMeta,
  updateInstanceMeta,
  getStdoutPath,
  getStderrPath,
  getProcessDir,
  loadAllInstances,
  appendStdoutLine,
} from './persistence.js';

function log(tag, ...args) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}][${tag}]`, ...args);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class Manager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, Instance>} */
    this.instances = new Map();
  }

  /** Load persisted instances and re-attach to any still-running processes */
  async init() {
    const saved = await loadAllInstances();
    log('manager', `Found ${saved.length} persisted instances`);
    for (const meta of saved) {
      const instance = {
        id: meta.id,
        name: meta.name,
        prompt: meta.prompt,
        cwd: meta.cwd,
        status: meta.status,
        pid: meta.pid || null,
        messages: meta.messages || [],
        process: null,
        lineBuffer: '',
        stdoutStream: null,
        fileWatcher: null,
        stdinAvailable: false,
        fileOffset: 0,
      };

      // If it was running, check if process is still alive
      if (instance.status === 'running' || instance.status === 'awaiting_approval') {
        if (instance.pid && isProcessAlive(instance.pid)) {
          log('manager', `Re-attaching to "${instance.name}" (pid=${instance.pid}) — still alive`);
          instance.status = 'monitoring';
          this.instances.set(instance.id, instance);
          await updateInstanceMeta(instance.id, { status: 'monitoring' });
          this._tailStdoutFile(instance);
        } else {
          log('manager', `"${instance.name}" (pid=${instance.pid}) — process dead, marking stopped`);
          instance.status = 'stopped';
          this.instances.set(instance.id, instance);
          await updateInstanceMeta(instance.id, { status: 'stopped' });
        }
      } else {
        log('manager', `Loaded "${instance.name}" — status=${instance.status}, ${instance.messages.length} messages`);
        this.instances.set(instance.id, instance);
      }
    }
    log('manager', `Init complete: ${this.instances.size} instances loaded`);
  }

  /** Spawn a new claude process */
  async spawn({ name, prompt, cwd }) {
    const id = randomUUID();
    const instanceName = name || `Instance ${this.instances.size + 1}`;
    const workDir = cwd || process.cwd();

    log('spawn', `Creating instance "${instanceName}" (id=${id.slice(0, 8)})`);
    log('spawn', `  prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
    log('spawn', `  cwd: ${workDir}`);

    // Ensure process data directory exists
    await mkdir(getProcessDir(id), { recursive: true });

    const stdoutPath = getStdoutPath(id);
    const stderrPath = getStderrPath(id);
    const stdoutFileStream = createWriteStream(stdoutPath, { flags: 'a' });
    const stderrFileStream = createWriteStream(stderrPath, { flags: 'a' });

    const args = [
      '--output-format', 'stream-json',
      '--verbose',
    ];
    log('spawn', `Running: claude ${args.join(' ')} (interactive mode)`);

    const child = spawn('claude', args, {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    log('spawn', `Process started — pid=${child.pid}`);

    // Write the initial prompt to stdin (interactive mode)
    log('spawn', `Writing initial prompt to stdin: "${prompt.substring(0, 80)}"`);
    child.stdin.write(prompt + '\n');

    const instance = {
      id,
      name: instanceName,
      prompt,
      cwd: workDir,
      status: 'running',
      pid: child.pid,
      messages: [],
      process: child,
      lineBuffer: '',
      stdoutStream: stdoutFileStream,
      stderrStream: stderrFileStream,
      fileWatcher: null,
      stdinAvailable: true,
      fileOffset: 0,
    };

    this.instances.set(id, instance);

    // Save meta to disk
    await saveInstanceMeta(id, {
      id,
      name: instanceName,
      prompt,
      cwd: workDir,
      status: 'running',
      pid: child.pid,
      createdAt: new Date().toISOString(),
    });

    // Parse stdout in real-time
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      log('stdout', `[${instanceName}] (${text.length} bytes) ${text.substring(0, 200).replace(/\n/g, '\\n')}`);
      // Write raw output to file for persistence
      stdoutFileStream.write(text);
      // Parse in real-time
      this._parseChunk(instance, text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      log('stderr', `[${instanceName}] ${text.substring(0, 300).replace(/\n/g, '\\n')}`);
      stderrFileStream.write(text);
      this._emitMessage(instance, {
        type: 'system',
        text,
        ts: Date.now(),
      });
    });

    child.on('close', async (code) => {
      log('process', `[${instanceName}] Exited with code ${code}`);
      instance.status = 'done';
      instance.stdinAvailable = false;
      stdoutFileStream.end();
      stderrFileStream.end();
      await updateInstanceMeta(id, { status: 'done', exitCode: code });
      this.emit('instance_status', { id, status: 'done', exitCode: code });
    });

    child.on('error', async (err) => {
      log('process', `[${instanceName}] ERROR: ${err.message}`);
      instance.status = 'error';
      instance.stdinAvailable = false;
      stdoutFileStream.end();
      stderrFileStream.end();
      await updateInstanceMeta(id, { status: 'error', error: err.message });
      this.emit('instance_status', { id, status: 'error', error: err.message });
      this._emitMessage(instance, {
        type: 'system',
        text: `Process error: ${err.message}`,
        ts: Date.now(),
      });
    });

    this.emit('instance_created', {
      id,
      name: instanceName,
      prompt,
      cwd: workDir,
      status: 'running',
      pid: child.pid,
    });

    log('spawn', `Instance "${instanceName}" created and running`);
    return { id, name: instanceName };
  }

  /** Attach to an existing process by PID — monitors output file only */
  async attach({ pid, name, stdoutPath }) {
    log('attach', `Attaching to pid=${pid}, name="${name}"`);
    if (!pid || !isProcessAlive(pid)) {
      log('attach', `FAILED — pid ${pid} is not running`);
      throw new Error(`Process ${pid} is not running`);
    }

    const id = randomUUID();
    const instanceName = name || `Attached-${pid}`;

    const instance = {
      id,
      name: instanceName,
      prompt: '(attached)',
      cwd: '',
      status: 'monitoring',
      pid,
      messages: [],
      process: null,
      lineBuffer: '',
      stdoutStream: null,
      fileWatcher: null,
      stdinAvailable: false,
      fileOffset: 0,
    };

    this.instances.set(id, instance);

    await saveInstanceMeta(id, {
      id,
      name: instanceName,
      prompt: '(attached)',
      cwd: '',
      status: 'monitoring',
      pid,
      createdAt: new Date().toISOString(),
    });

    if (stdoutPath && existsSync(stdoutPath)) {
      log('attach', `Tailing stdout file: ${stdoutPath}`);
      this._tailExternalFile(instance, stdoutPath);
    }

    this.emit('instance_created', {
      id,
      name: instanceName,
      prompt: '(attached)',
      cwd: '',
      status: 'monitoring',
      pid,
      stdinAvailable: false,
    });

    log('attach', `Attached to "${instanceName}" successfully`);
    return { id, name: instanceName };
  }

  /** Send input to process stdin */
  sendInput(id, text) {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`Instance ${id} not found`);
    if (!instance.stdinAvailable || !instance.process) {
      throw new Error(`stdin not available for instance ${id} (monitoring only)`);
    }
    log('stdin', `[${instance.name}] Writing: "${text.trim()}"`);
    instance.process.stdin.write(text);
    this._emitMessage(instance, {
      type: 'user_input',
      text: text.trim(),
      ts: Date.now(),
    });
  }

  /** Approve a pending tool use */
  approve(id) {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`Instance ${id} not found`);
    log('approve', `[${instance.name}] Approving tool use`);
    if (instance.status === 'awaiting_approval') {
      instance.status = 'running';
      updateInstanceMeta(id, { status: 'running' });
      this.emit('instance_status', { id, status: 'running' });
    }
    this.sendInput(id, 'y\n');
  }

  /** Reject a pending tool use */
  reject(id) {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`Instance ${id} not found`);
    log('reject', `[${instance.name}] Rejecting tool use`);
    if (instance.status === 'awaiting_approval') {
      instance.status = 'running';
      updateInstanceMeta(id, { status: 'running' });
      this.emit('instance_status', { id, status: 'running' });
    }
    this.sendInput(id, 'n\n');
  }

  /** Kill a process */
  async kill(id) {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`Instance ${id} not found`);

    log('kill', `[${instance.name}] Killing process (pid=${instance.pid})`);

    if (instance.process) {
      instance.process.kill('SIGTERM');
    } else if (instance.pid && isProcessAlive(instance.pid)) {
      process.kill(instance.pid, 'SIGTERM');
    }

    if (instance.fileWatcher) {
      instance.fileWatcher.close();
      instance.fileWatcher = null;
    }

    instance.status = 'stopped';
    instance.stdinAvailable = false;
    await updateInstanceMeta(id, { status: 'stopped' });
    this.emit('instance_status', { id, status: 'stopped' });
    log('kill', `[${instance.name}] Stopped`);
  }

  /** Get serializable snapshot of all instances */
  getSnapshot() {
    const instances = [];
    for (const [id, inst] of this.instances) {
      instances.push({
        id: inst.id,
        name: inst.name,
        prompt: inst.prompt,
        cwd: inst.cwd,
        status: inst.status,
        pid: inst.pid,
        stdinAvailable: inst.stdinAvailable,
        messages: inst.messages,
      });
    }
    return instances;
  }

  // --- Internal methods ---

  _parseChunk(instance, text) {
    instance.lineBuffer += text;
    const lines = instance.lineBuffer.split('\n');
    // Keep the last incomplete line in the buffer
    instance.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        log('event', `[${instance.name}] type=${event.type}`);
        this._handleEvent(instance, event);
      } catch {
        // Non-JSON line — emit as raw text
        log('raw', `[${instance.name}] ${line.substring(0, 150)}`);
        this._emitMessage(instance, {
          type: 'system',
          text: line,
          ts: Date.now(),
        });
      }
    }
  }

  _handleEvent(instance, event) {
    const ts = Date.now();

    switch (event.type) {
      case 'system': {
        // system/init event — session initialization info
        log('system', `[${instance.name}] subtype=${event.subtype}, session=${event.session_id}, model=${event.model}`);
        instance.sessionId = event.session_id;
        this._emitMessage(instance, {
          type: 'system',
          text: `Session started (model: ${event.model || 'unknown'}, mode: ${event.permissionMode || 'unknown'})`,
          data: event,
          ts,
        });
        break;
      }

      case 'assistant': {
        const content = event.message?.content || [];
        for (const block of content) {
          if (block.type === 'text') {
            log('assistant', `[${instance.name}] Text (${block.text.length} chars): "${block.text.substring(0, 80)}..."`);
            this._emitMessage(instance, {
              type: 'assistant',
              text: block.text,
              ts,
            });
          } else if (block.type === 'thinking') {
            log('thinking', `[${instance.name}] Thinking (${block.thinking.length} chars)`);
            // Don't emit thinking blocks to UI by default — too noisy
          } else if (block.type === 'tool_use') {
            log('tool_use', `[${instance.name}] Tool: ${block.name} (id=${block.id})`);
            log('tool_use', `[${instance.name}]   Input keys: ${Object.keys(block.input || {}).join(', ')}`);
            instance.status = 'awaiting_approval';
            updateInstanceMeta(instance.id, { status: 'awaiting_approval' });
            this.emit('instance_status', {
              id: instance.id,
              status: 'awaiting_approval',
            });
            this._emitMessage(instance, {
              type: 'tool_use',
              toolName: block.name,
              toolId: block.id,
              input: block.input,
              ts,
            });
          }
        }
        break;
      }

      case 'tool_result': {
        const contentPreview = typeof event.content === 'string'
          ? event.content.substring(0, 100)
          : JSON.stringify(event.content).substring(0, 100);
        log('tool_result', `[${instance.name}] Result: ${contentPreview}`);
        if (instance.status === 'awaiting_approval') {
          instance.status = 'running';
          updateInstanceMeta(instance.id, { status: 'running' });
          this.emit('instance_status', {
            id: instance.id,
            status: 'running',
          });
        }
        this._emitMessage(instance, {
          type: 'tool_result',
          toolId: event.tool_use_id || event.id,
          content: event.content,
          ts,
        });
        break;
      }

      case 'result': {
        log('result', `[${instance.name}] Turn complete — cost=$${event.cost_usd}, duration=${event.duration_ms}ms, total=$${event.total_cost_usd}`);
        // In interactive mode, 'result' means a turn ended — session is still alive.
        // The process stays running and waits for more stdin input.
        // Only mark as 'done' status — the 'close' event handles actual process exit.
        this._emitMessage(instance, {
          type: 'result',
          text: event.result,
          subtype: event.subtype,
          costUsd: event.cost_usd,
          durationMs: event.duration_ms,
          totalCostUsd: event.total_cost_usd,
          ts,
        });
        // Update cost tracking but keep status as 'running' (session still alive)
        instance.status = 'idle';
        updateInstanceMeta(instance.id, {
          status: 'idle',
          costUsd: event.cost_usd,
          durationMs: event.duration_ms,
          totalCostUsd: event.total_cost_usd,
        });
        this.emit('instance_status', { id: instance.id, status: 'idle' });
        break;
      }

      case 'rate_limit_event': {
        log('rate_limit', `[${instance.name}] status=${event.rate_limit_info?.status}`);
        // Don't spam the UI with rate limit events unless it's actually limited
        if (event.rate_limit_info?.status !== 'allowed') {
          this._emitMessage(instance, {
            type: 'system',
            text: `Rate limited — resets at ${new Date(event.rate_limit_info?.resetsAt * 1000).toLocaleTimeString()}`,
            ts,
          });
        }
        break;
      }

      default: {
        log('event', `[${instance.name}] Unknown event type: ${event.type}`);
        this._emitMessage(instance, {
          type: 'event',
          eventType: event.type,
          data: event,
          ts,
        });
      }
    }
  }

  _emitMessage(instance, message) {
    instance.messages.push(message);
    this.emit('message', { id: instance.id, message });
  }

  /** Tail the stdout.jsonl file for a re-attached (previously spawned) instance */
  _tailStdoutFile(instance) {
    const stdoutPath = getStdoutPath(instance.id);
    if (!existsSync(stdoutPath)) return;

    // We already loaded all existing messages during init,
    // so track current file size as our offset
    const stats = statSync(stdoutPath);
    instance.fileOffset = stats.size;
    log('tail', `[${instance.name}] Tailing ${stdoutPath} from offset ${stats.size}`);

    // Watch for new data
    instance.fileWatcher = watch(stdoutPath, () => {
      this._readNewData(instance, stdoutPath);
    });

    // Also poll periodically as fs.watch can miss events
    instance._pollInterval = setInterval(() => {
      if (instance.pid && !isProcessAlive(instance.pid)) {
        log('tail', `[${instance.name}] Process died (pid=${instance.pid}), stopping tail`);
        instance.status = 'done';
        updateInstanceMeta(instance.id, { status: 'done' });
        this.emit('instance_status', { id: instance.id, status: 'done' });
        clearInterval(instance._pollInterval);
        if (instance.fileWatcher) {
          instance.fileWatcher.close();
          instance.fileWatcher = null;
        }
        return;
      }
      this._readNewData(instance, stdoutPath);
    }, 2000);
  }

  /** Tail an external stdout file (for attach-by-pid) */
  _tailExternalFile(instance, filePath) {
    if (!existsSync(filePath)) return;

    // Read existing content first
    const stats = statSync(filePath);
    instance.fileOffset = 0;
    log('tail', `[${instance.name}] Reading existing content from ${filePath} (${stats.size} bytes)`);
    this._readNewData(instance, filePath);
    instance.fileOffset = stats.size;

    instance.fileWatcher = watch(filePath, () => {
      this._readNewData(instance, filePath);
    });

    instance._pollInterval = setInterval(() => {
      if (instance.pid && !isProcessAlive(instance.pid)) {
        log('tail', `[${instance.name}] Attached process died (pid=${instance.pid})`);
        instance.status = 'done';
        updateInstanceMeta(instance.id, { status: 'done' });
        this.emit('instance_status', { id: instance.id, status: 'done' });
        clearInterval(instance._pollInterval);
        if (instance.fileWatcher) instance.fileWatcher.close();
        return;
      }
      this._readNewData(instance, filePath);
    }, 2000);
  }

  _readNewData(instance, filePath) {
    try {
      const stats = statSync(filePath);
      if (stats.size <= instance.fileOffset) return;

      const newBytes = stats.size - instance.fileOffset;
      log('tail', `[${instance.name}] Reading ${newBytes} new bytes from ${filePath}`);

      const stream = createReadStream(filePath, {
        start: instance.fileOffset,
        encoding: 'utf-8',
      });

      let data = '';
      stream.on('data', (chunk) => { data += chunk; });
      stream.on('end', () => {
        instance.fileOffset = stats.size;
        if (data) this._parseChunk(instance, data);
      });
    } catch (err) {
      log('tail', `[${instance.name}] Error reading file: ${err.message}`);
    }
  }
}

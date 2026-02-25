import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function log(tag, ...args) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}][${tag}]`, ...args);
}

/**
 * Reads all lines from a .jsonl file, returns parsed objects.
 */
function readJsonl(filePath) {
  const entries = [];
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { entries.push(JSON.parse(trimmed)); } catch { /* skip */ }
    }
  } catch { /* skip unreadable files */ }
  return entries;
}

/**
 * Convert transcript entries into InstanceMessage array.
 * Only includes assistant text and user text — skips thinking, tool calls (too noisy for history).
 */
function buildMessages(entries) {
  const messages = [];
  let ts = Date.now();

  for (const entry of entries) {
    const type = entry.type;

    if (type === 'assistant') {
      const content = entry.message?.content ?? [];
      const textBlocks = content.filter(c => c.type === 'text' && c.text?.trim());
      for (const block of textBlocks) {
        messages.push({ type: 'assistant', text: block.text, ts: ts++ });
      }
    }

    if (type === 'user') {
      const content = entry.message?.content;
      if (typeof content === 'string' && content.trim()) {
        messages.push({ type: 'user_input', text: content.trim(), ts: ts++ });
      } else if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type === 'text' && c.text?.trim()) {
            messages.push({ type: 'user_input', text: c.text.trim(), ts: ts++ });
          }
        }
      }
    }
  }

  return messages;
}

/**
 * Scan the ~/.claude/projects folder and load recent sessions into hookManager.
 * Only loads sessions modified within the last `maxAgeDays` days.
 */
export function loadTranscripts(hookManager, maxAgeDays = 7) {
  const projectsDir = join(homedir(), '.claude', 'projects');
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let loaded = 0;

  let projectFolders;
  try {
    projectFolders = readdirSync(projectsDir);
  } catch {
    log('transcript', `Projects folder not found: ${projectsDir}`);
    return;
  }

  for (const folder of projectFolders) {
    const folderPath = join(projectsDir, folder);
    let files;
    try {
      files = readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));
    } catch { continue; }

    for (const file of files) {
      const filePath = join(folderPath, file);
      const sessionId = file.replace('.jsonl', '');

      // Skip if already loaded (live session)
      if (hookManager.sessions.has(sessionId)) continue;

      // Skip if too old
      let mtimeMs;
      try {
        const stat = statSync(filePath);
        if (stat.mtimeMs < cutoff) continue;
        mtimeMs = stat.mtimeMs;
      } catch { continue; }

      const entries = readJsonl(filePath);
      if (entries.length === 0) continue;

      // Get cwd and sessionId from entries
      const meta = entries.find(e => e.cwd && e.sessionId);
      if (!meta) continue;

      const cwd = meta.cwd || '';
      const messages = buildMessages(entries);

      // Determine if session ended
      const lastEntry = entries[entries.length - 1];
      const status = 'idle';

      const session = {
        id: sessionId,
        name: hookManager._buildName(cwd, sessionId),
        prompt: '',
        cwd,
        status,
        model: entries.find(e => e.message?.model)?.message?.model || '',
        messages,
        createdAt: mtimeMs,
        autoApprove: false,
        fromTranscript: true,
      };

      hookManager.sessions.set(sessionId, session);
      loaded++;
      log('transcript', `Loaded session ${sessionId.slice(0, 8)} (${session.name}) — ${messages.length} messages`);
    }
  }

  log('transcript', `Loaded ${loaded} session(s) from transcripts`);
}

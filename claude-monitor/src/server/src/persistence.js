import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(import.meta.dirname, '..', 'data');
const PROCESSES_DIR = join(DATA_DIR, 'processes');

export async function ensureDataDirs() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(PROCESSES_DIR, { recursive: true });
}

export function getProcessDir(id) {
  return join(PROCESSES_DIR, id);
}

export async function saveInstanceMeta(id, meta) {
  const dir = getProcessDir(id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
}

export async function loadInstanceMeta(id) {
  const metaPath = join(getProcessDir(id), 'meta.json');
  if (!existsSync(metaPath)) return null;
  const raw = await readFile(metaPath, 'utf-8');
  return JSON.parse(raw);
}

export async function updateInstanceMeta(id, updates) {
  const existing = await loadInstanceMeta(id);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  await saveInstanceMeta(id, updated);
  return updated;
}

export function getStdoutPath(id) {
  return join(getProcessDir(id), 'stdout.jsonl');
}

export function getStderrPath(id) {
  return join(getProcessDir(id), 'stderr.log');
}

export async function loadAllInstances() {
  await ensureDataDirs();
  if (!existsSync(PROCESSES_DIR)) return [];

  const entries = await readdir(PROCESSES_DIR);
  const instances = [];

  for (const entry of entries) {
    const metaPath = join(PROCESSES_DIR, entry, 'meta.json');
    if (!existsSync(metaPath)) continue;
    try {
      const raw = await readFile(metaPath, 'utf-8');
      const meta = JSON.parse(raw);
      // Load message history from stdout.jsonl
      const stdoutPath = join(PROCESSES_DIR, entry, 'stdout.jsonl');
      meta.messages = [];
      if (existsSync(stdoutPath)) {
        const stdout = await readFile(stdoutPath, 'utf-8');
        for (const line of stdout.split('\n')) {
          if (!line.trim()) continue;
          try {
            meta.messages.push(JSON.parse(line));
          } catch {}
        }
      }
      instances.push(meta);
    } catch (err) {
      console.error(`Failed to load instance ${entry}:`, err.message);
    }
  }

  return instances;
}

export async function appendStdoutLine(id, jsonLine) {
  const p = getStdoutPath(id);
  await writeFile(p, jsonLine + '\n', { flag: 'a' });
}

export async function appendStderrLine(id, text) {
  const p = getStderrPath(id);
  await writeFile(p, text, { flag: 'a' });
}

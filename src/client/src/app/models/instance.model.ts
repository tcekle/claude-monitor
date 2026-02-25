export type InstanceStatus =
  | 'running'
  | 'awaiting_approval'
  | 'idle'
  | 'done'
  | 'stopped'
  | 'error'
  | 'monitoring';

export interface InstanceMessage {
  type: 'assistant' | 'tool_use' | 'tool_result' | 'result' | 'user_input' | 'system' | 'event';
  text?: string;
  toolName?: string;
  toolId?: string;
  input?: Record<string, unknown>;
  pendingId?: string;
  content?: unknown;
  costUsd?: number;
  durationMs?: number;
  totalCostUsd?: number;
  subtype?: string;
  eventType?: string;
  data?: unknown;
  ts: number;
}

export interface Instance {
  id: string;
  name: string;
  prompt: string;
  cwd: string;
  status: InstanceStatus;
  pid: number | null;
  stdinAvailable: boolean;
  messages: InstanceMessage[];
}

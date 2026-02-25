import { Instance, InstanceMessage, InstanceStatus } from './instance.model';

// --- Inbound (server → client) ---

export interface SnapshotMessage {
  type: 'snapshot';
  instances: Instance[];
}

export interface InstanceCreatedMessage {
  type: 'instance_created';
  id: string;
  name: string;
  prompt: string;
  cwd: string;
  status: InstanceStatus;
  pid: number | null;
  stdinAvailable?: boolean;
}

export interface InstanceMessageEvent {
  type: 'message';
  id: string;
  message: InstanceMessage;
}

export interface InstanceStatusMessage {
  type: 'instance_status';
  id: string;
  status: InstanceStatus;
  exitCode?: number;
  error?: string;
}

export interface InstanceRenamedMessage {
  type: 'instance_renamed';
  id: string;
  name: string;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type ServerMessage =
  | SnapshotMessage
  | InstanceCreatedMessage
  | InstanceMessageEvent
  | InstanceStatusMessage
  | InstanceRenamedMessage
  | ErrorMessage;

// --- Outbound (client → server) ---

export interface SpawnAction {
  action: 'spawn';
  name?: string;
  prompt: string;
  cwd?: string;
}

export interface KillAction {
  action: 'kill';
  id: string;
}

export interface ApproveAction {
  action: 'approve';
  id: string;
}

export interface RejectAction {
  action: 'reject';
  id: string;
}

export interface InputAction {
  action: 'input';
  id: string;
  text: string;
}

export type ClientAction =
  | SpawnAction
  | KillAction
  | ApproveAction
  | RejectAction
  | InputAction;

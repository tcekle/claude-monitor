import { Injectable, signal, computed, inject } from '@angular/core';
import { Instance, InstanceMessage } from '../models/instance.model';
import { WebSocketService } from './websocket.service';
import { ServerMessage } from '../models/ws-messages.model';

@Injectable({ providedIn: 'root' })
export class InstanceStoreService {
  private ws = inject(WebSocketService);

  private _instances = signal<Map<string, Instance>>(new Map());
  private _activeInstanceId = signal<string | null>(null);

  readonly instances = computed(() => [...this._instances().values()]);
  readonly activeInstanceId = this._activeInstanceId.asReadonly();

  readonly activeInstance = computed(() => {
    const id = this._activeInstanceId();
    return id ? this._instances().get(id) ?? null : null;
  });

  readonly activeMessages = computed(() => {
    return this.activeInstance()?.messages ?? [];
  });

  readonly totalCost = computed(() => {
    let cost = 0;
    for (const inst of this._instances().values()) {
      const lastResult = [...inst.messages].reverse().find((m) => m.type === 'result');
      if (lastResult?.totalCostUsd) cost += lastResult.totalCostUsd;
    }
    return cost;
  });

  readonly hasAwaitingApproval = computed(() => {
    for (const inst of this._instances().values()) {
      if (inst.status === 'awaiting_approval') return true;
    }
    return false;
  });

  constructor() {
    this.ws.messages$.subscribe((msg) => this._handleMessage(msg));
  }

  selectInstance(id: string): void {
    this._activeInstanceId.set(id);
  }

  approve(pendingId: string): void {
    this.ws.send({ action: 'approve', pendingId } as any);
  }

  reject(pendingId: string, reason?: string): void {
    this.ws.send({ action: 'reject', pendingId, reason } as any);
  }

  renameInstance(id: string, name: string): void {
    this.ws.send({ action: 'rename', id, name } as any);
    // Optimistic update
    this._instances.update((map) => {
      const inst = map.get(id);
      if (!inst) return map;
      const next = new Map(map);
      next.set(id, { ...inst, name });
      return next;
    });
  }

  approveSession(sessionId: string): void {
    this.ws.send({ action: 'approve_session', sessionId } as any);
  }

  private _handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'snapshot':
        this._handleSnapshot(msg.instances);
        break;
      case 'instance_created':
        this._handleInstanceCreated(msg);
        break;
      case 'message':
        this._handleInstanceMessage(msg.id, msg.message);
        break;
      case 'instance_status':
        this._handleStatusChange(msg.id, msg.status);
        break;
      case 'instance_renamed':
        this._handleRename(msg.id, msg.name);
        break;
      case 'error':
        console.error('[store] Server error:', msg.message);
        break;
    }
  }

  private _handleSnapshot(instances: Instance[]): void {
    const map = new Map<string, Instance>();
    for (const inst of instances) {
      map.set(inst.id, { ...inst });
    }
    this._instances.set(map);

    // Auto-select first instance if none selected
    if (!this._activeInstanceId() && instances.length > 0) {
      this._activeInstanceId.set(instances[0].id);
    }
  }

  private _handleInstanceCreated(msg: any): void {
    const inst: Instance = {
      id: msg.id,
      name: msg.name,
      prompt: msg.prompt,
      cwd: msg.cwd,
      status: msg.status,
      pid: msg.pid,
      stdinAvailable: msg.stdinAvailable ?? true,
      messages: [],
    };
    this._instances.update((map) => {
      const next = new Map(map);
      next.set(inst.id, inst);
      return next;
    });
    // Auto-select newly created instance
    this._activeInstanceId.set(inst.id);
  }

  private _handleInstanceMessage(id: string, message: InstanceMessage): void {
    this._instances.update((map) => {
      const inst = map.get(id);
      if (!inst) return map;
      const next = new Map(map);
      next.set(id, {
        ...inst,
        messages: [...inst.messages, message],
      });
      return next;
    });
  }

  private _handleRename(id: string, name: string): void {
    this._instances.update((map) => {
      const inst = map.get(id);
      if (!inst) return map;
      const next = new Map(map);
      next.set(id, { ...inst, name });
      return next;
    });
  }

  private _handleStatusChange(id: string, status: string): void {
    this._instances.update((map) => {
      const inst = map.get(id);
      if (!inst) return map;
      const next = new Map(map);
      next.set(id, { ...inst, status: status as any });
      return next;
    });
  }
}

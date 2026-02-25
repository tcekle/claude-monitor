import { Component, inject, signal, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { Badge } from 'primeng/badge';
import { InstanceStoreService } from '../../services/instance-store.service';
import { WebSocketService } from '../../services/websocket.service';
import { InstanceStatus } from '../../models/instance.model';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [FormsModule, ToggleSwitch, Badge],
  template: `
    <div class="flex flex-col h-full bg-surface-900 text-surface-100 w-64 select-none">

      <!-- App title -->
      <div class="flex items-center justify-between px-4 py-4 border-b border-surface-700">
        <div class="flex items-center gap-2">
          <span class="font-bold text-base">Claude Monitor</span>
          <span class="w-2 h-2 rounded-full inline-block" [class]="connectionDot()"></span>
        </div>
        <!-- Close button — mobile only -->
        <button
          class="lg:hidden p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-100 transition-colors"
          (click)="close.emit()"
        >
          <i class="pi pi-times text-sm"></i>
        </button>
      </div>

      <!-- Sessions section -->
      <div class="flex-1 overflow-y-auto py-3">
        <div class="px-4 pb-2">
          <span class="text-xs font-semibold uppercase tracking-wider text-surface-500">Sessions</span>
        </div>

        @if (instances().length === 0) {
          <div class="px-4 py-2 text-sm text-surface-500 italic">No active sessions</div>
        }

        @for (inst of instances(); track inst.id) {
          <div class="group relative px-2">
            <button
              [class]="navItemClass(inst.id)"
              (click)="selectSession(inst.id)"
              (dblclick)="startRename(inst.id, inst.name, $event)"
            >
              <span class="w-2 h-2 rounded-full flex-shrink-0" [class]="statusDot(inst.status)"></span>

              @if (editingId() === inst.id) {
                <input
                  #renameInput
                  class="flex-1 bg-transparent border-b border-surface-400 outline-none text-sm min-w-0"
                  [value]="inst.name"
                  (keydown.enter)="commitRename(inst.id, renameInput.value)"
                  (keydown.escape)="cancelRename()"
                  (blur)="commitRename(inst.id, renameInput.value)"
                  (click)="$event.stopPropagation()"
                />
              } @else {
                <span class="flex-1 text-sm truncate text-left">{{ inst.name }}</span>
              }

              @if (inst.status === 'awaiting_approval') {
                <span class="w-2 h-2 rounded-full bg-yellow-400 animate-pulse flex-shrink-0"></span>
              }
            </button>
          </div>
        }
      </div>

      <!-- Footer controls -->
      <div class="border-t border-surface-700 px-4 py-3 space-y-3">
        @if (totalCost() > 0) {
          <div class="flex items-center justify-between text-xs text-surface-400">
            <span class="flex items-center gap-1.5">
              <i class="pi pi-dollar text-[10px]"></i>
              Total cost
            </span>
            <span class="font-mono text-surface-200">{{ formatCost(totalCost()) }}</span>
          </div>
        }
        <div class="flex items-center justify-between">
          <span class="text-xs text-surface-400 flex items-center gap-1.5">
            <i class="pi pi-moon text-[10px]"></i>
            Dark mode
          </span>
          <p-toggleswitch [(ngModel)]="isDarkMode" (onChange)="toggleDarkMode()" />
        </div>
      </div>

    </div>
  `,
})
export class Sidebar {
  close = output<void>();

  store = inject(InstanceStoreService);
  private ws = inject(WebSocketService);

  instances = this.store.instances;
  activeInstanceId = this.store.activeInstanceId;
  totalCost = this.store.totalCost;
  connectionStatus = this.ws.connectionStatus;
  editingId = signal<string | null>(null);
  isDarkMode = true;

  constructor() {
    document.documentElement.classList.add('dark-mode');
  }

  connectionDot(): string {
    switch (this.connectionStatus()) {
      case 'connected': return 'bg-green-500';
      case 'reconnecting': return 'bg-yellow-500 animate-pulse';
      default: return 'bg-red-500';
    }
  }

  selectSession(id: string): void {
    this.store.selectInstance(id);
    this.close.emit(); // auto-close on mobile after selecting
  }

  navItemClass(id: string): string {
    const base = 'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer';
    if (this.activeInstanceId() === id) {
      return `${base} bg-surface-700 text-white`;
    }
    return `${base} text-surface-300 hover:bg-surface-800 hover:text-white`;
  }

  statusDot(status: InstanceStatus): string {
    switch (status) {
      case 'running': return 'bg-green-500';
      case 'idle': return 'bg-green-300';
      case 'awaiting_approval': return 'bg-yellow-500 animate-pulse';
      case 'monitoring': return 'bg-blue-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-surface-500';
    }
  }

  startRename(id: string, _name: string, event: Event): void {
    event.stopPropagation();
    this.editingId.set(id);
    setTimeout(() => {
      const input = (event.target as HTMLElement)
        .closest('button')
        ?.querySelector('input') as HTMLInputElement | null;
      input?.select();
    });
  }

  commitRename(id: string, newName: string): void {
    const trimmed = newName.trim();
    if (trimmed && this.editingId() === id) {
      this.store.renameInstance(id, trimmed);
    }
    this.editingId.set(null);
  }

  cancelRename(): void {
    this.editingId.set(null);
  }

  toggleDarkMode(): void {
    if (this.isDarkMode) {
      document.documentElement.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
    }
  }

  formatCost(cost: number): string {
    return `$${cost.toFixed(4)}`;
  }
}

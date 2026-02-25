import { Component, inject, signal, computed, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { InstanceStoreService } from '../../services/instance-store.service';
import { WebSocketService } from '../../services/websocket.service';
import { Instance } from '../../models/instance.model';

interface LocationGroup {
  cwd: string;
  label: string;
  instances: Instance[];
  latestAt: number;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, ToggleSwitch],
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
      <div class="flex-1 overflow-y-auto py-3 flex flex-col gap-1">

        <!-- Sort mode toggle -->
        <div class="px-3 mb-1">
          <div class="flex bg-surface-800 rounded-md p-0.5 gap-0.5">
            <button [class]="sortButtonClass('date')" (click)="sortMode.set('date')">Date</button>
            <button [class]="sortButtonClass('location')" (click)="sortMode.set('location')">Location</button>
          </div>
        </div>

        @if (instances().length === 0) {
          <div class="px-4 py-2 text-sm text-surface-500 italic">No active sessions</div>
        }

        <!-- Date mode: Active / Waiting / Idle sections -->
        @if (sortMode() === 'date') {

          @if (activeInstances().length > 0) {
            <div class="px-5 pt-1 pb-0.5">
              <span class="text-[10px] font-semibold uppercase tracking-widest text-green-500">Active</span>
            </div>
            @for (inst of activeInstances(); track inst.id) {
              <ng-container *ngTemplateOutlet="sessionItem; context: { $implicit: inst, indent: 'px-2' }"></ng-container>
            }
          }

          @if (waitingInstances().length > 0) {
            <div class="px-5 pb-0.5" [class.pt-2]="activeInstances().length > 0" [class.pt-1]="!activeInstances().length">
              <span class="text-[10px] font-semibold uppercase tracking-widest text-surface-500">Running</span>
            </div>
            @for (inst of waitingInstances(); track inst.id) {
              <ng-container *ngTemplateOutlet="sessionItem; context: { $implicit: inst, indent: 'px-2' }"></ng-container>
            }
          }

          @if (idleInstances().length > 0) {
            <div class="px-5 pb-0.5" [class.pt-2]="activeInstances().length > 0 || waitingInstances().length > 0" [class.pt-1]="!activeInstances().length && !waitingInstances().length">
              <span class="text-[10px] font-semibold uppercase tracking-widest text-surface-500">Idle</span>
            </div>
            @for (inst of idleInstances(); track inst.id) {
              <ng-container *ngTemplateOutlet="sessionItem; context: { $implicit: inst, indent: 'px-2' }"></ng-container>
            }
          }

        }

        <!-- Location mode: grouped + expandable -->
        @if (sortMode() === 'location') {
          @for (group of groupedInstances(); track group.cwd) {

            <!-- Group header -->
            <div class="px-2">
              <button
                class="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-surface-400 hover:text-surface-100 hover:bg-surface-800 transition-colors"
                (click)="toggleGroup(group.cwd)"
              >
                <i class="text-[10px]" [class]="isGroupExpanded(group.cwd) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"></i>
                <span class="flex-1 text-xs font-semibold uppercase tracking-wider truncate text-left">{{ group.label }}</span>
                <span class="text-[10px] bg-surface-700 text-surface-400 rounded px-1.5 py-0.5 font-mono">{{ group.instances.length }}</span>
              </button>
            </div>

            <!-- Sessions in this group -->
            @if (isGroupExpanded(group.cwd)) {
              @for (inst of group.instances; track inst.id) {
                <ng-container *ngTemplateOutlet="sessionItem; context: { $implicit: inst, indent: 'pl-4 pr-2' }"></ng-container>
              }
            }

          }
        }

      </div>

      <!-- Reusable session row -->
      <ng-template #sessionItem let-inst let-indent="indent">
        <div [class]="indent">
          <button
            [class]="navItemClass(inst.id)"
            (click)="selectSession(inst.id)"
            (dblclick)="startRename(inst.id, inst.name, $event)"
          >
            <span class="w-2 h-2 rounded-full flex-shrink-0" [class]="statusDot(inst)"></span>

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
      </ng-template>

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

  sortMode = signal<'date' | 'location'>('date');
  private collapsedGroups = signal<Set<string>>(new Set());

  private _byDate = (a: Instance, b: Instance) => b.createdAt - a.createdAt;
  private _byActivity = (a: Instance, b: Instance) => b.lastActivityAt - a.lastActivityAt;
  private _isRunning = (inst: Instance) =>
    inst.status === 'running' || inst.status === 'awaiting_approval' || inst.status === 'monitoring';

  activeInstances = computed(() =>
    this.instances()
      .filter(i => this._isRunning(i) && i.lastActivityAt > 0)
      .sort(this._byActivity)
  );

  waitingInstances = computed(() =>
    this.instances()
      .filter(i => this._isRunning(i) && !i.lastActivityAt)
      .sort(this._byDate)
  );

  idleInstances = computed(() =>
    this.instances().filter(i => !this._isRunning(i)).sort(this._byDate)
  );

  groupedInstances = computed((): LocationGroup[] => {
    const groups = new Map<string, Instance[]>();
    for (const inst of this.instances()) {
      const key = inst.cwd || '';
      const list = groups.get(key) ?? [];
      list.push(inst);
      groups.set(key, list);
    }

    const result: LocationGroup[] = [];
    for (const [cwd, insts] of groups) {
      const sorted = [...insts].sort((a, b) => b.createdAt - a.createdAt);
      result.push({
        cwd,
        label: this._locationLabel(cwd),
        instances: sorted,
        latestAt: sorted[0].createdAt,
      });
    }

    return result.sort((a, b) => b.latestAt - a.latestAt);
  });

  constructor() {
    document.documentElement.classList.add('dark-mode');
  }

  private _locationLabel(cwd: string): string {
    if (!cwd) return 'Unknown';
    return cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || cwd;
  }

  toggleGroup(cwd: string): void {
    this.collapsedGroups.update((set) => {
      const next = new Set(set);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });
  }

  isGroupExpanded(cwd: string): boolean {
    return !this.collapsedGroups().has(cwd);
  }

  connectionDot(): string {
    switch (this.connectionStatus()) {
      case 'connected': return 'bg-green-500';
      case 'reconnecting': return 'bg-yellow-500 animate-pulse';
      default: return 'bg-red-500';
    }
  }

  sortButtonClass(mode: 'date' | 'location'): string {
    const base = 'flex-1 text-xs py-1 rounded transition-colors font-medium';
    if (this.sortMode() === mode) {
      return `${base} bg-surface-600 text-white`;
    }
    return `${base} text-surface-400 hover:text-surface-200`;
  }

  selectSession(id: string): void {
    this.store.selectInstance(id);
    this.close.emit();
  }

  navItemClass(id: string): string {
    const base = 'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer';
    if (this.activeInstanceId() === id) {
      return `${base} bg-surface-700 text-white`;
    }
    return `${base} text-surface-300 hover:bg-surface-800 hover:text-white`;
  }

  statusDot(inst: Instance): string {
    switch (inst.status) {
      case 'running':
        return inst.lastActivityAt ? 'bg-green-400' : 'bg-green-900';
      case 'idle': return 'bg-green-700';
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

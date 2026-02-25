import { Component, inject, signal } from '@angular/core';
import { InstanceStoreService } from '../../services/instance-store.service';
import { InstanceStatus } from '../../models/instance.model';

@Component({
  selector: 'app-tab-bar',
  standalone: true,
  imports: [],
  templateUrl: './tab-bar.html',
  styleUrl: './tab-bar.css',
})
export class TabBar {
  store = inject(InstanceStoreService);

  instances = this.store.instances;
  activeInstanceId = this.store.activeInstanceId;
  editingId = signal<string | null>(null);

  selectTab(id: string): void {
    this.store.selectInstance(id);
  }

  startRename(id: string, currentName: string, event: Event): void {
    event.stopPropagation();
    this.editingId.set(id);
    // Focus the input after it renders
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

  tabClass(id: string): string {
    const base = 'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors cursor-pointer';
    if (this.activeInstanceId() === id) {
      return `${base} bg-primary text-primary-contrast`;
    }
    return `${base} bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700`;
  }

  statusSeverity(status: InstanceStatus): 'success' | 'warn' | 'danger' | 'info' | 'secondary' {
    switch (status) {
      case 'running': return 'success';
      case 'awaiting_approval': return 'warn';
      case 'monitoring': return 'info';
      case 'error': return 'danger';
      default: return 'secondary';
    }
  }

  statusDot(status: InstanceStatus): string {
    switch (status) {
      case 'running': return 'bg-green-500';
      case 'idle': return 'bg-green-300';
      case 'awaiting_approval': return 'bg-yellow-500 animate-pulse';
      case 'monitoring': return 'bg-blue-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-400';
    }
  }
}

import { Component, inject, signal, computed, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { InstanceStoreService } from '../../services/instance-store.service';

export interface StatusItem {
  id: string;
  icon: string;
  label: string;
  value: string;
  title?: string;
}

@Component({
  selector: 'app-status-bar',
  standalone: true,
  imports: [],
  template: `
    <div class="flex items-center gap-4 px-3 py-0.5 border-t border-surface bg-surface-50 dark:bg-surface-900 text-xs text-surface-500 dark:text-surface-400 select-none">
      @for (item of items(); track item.id) {
        <div class="flex items-center gap-1.5" [title]="item.title ?? ''">
          <i class="pi text-[10px]" [class]="item.icon"></i>
          <span>{{ item.label ? item.label + ': ' : '' }}{{ item.value }}</span>
        </div>
        @if (!$last) {
          <span class="text-surface-300 dark:text-surface-700">|</span>
        }
      }
    </div>
  `,
})
export class StatusBar {
  private store = inject(InstanceStoreService);
  private http = inject(HttpClient);

  private branch = signal<string>('—');
  private activeInstance = this.store.activeInstance;

  private readonly CONTEXT_WINDOW = 200_000;

  items = computed<StatusItem[]>(() => {
    const inst = this.activeInstance();
    const usage = inst?.usage;

    let contextStr = '—';
    let contextTitle = 'Token usage from last completed turn';

    if (usage) {
      const inputTotal = (usage.input_tokens ?? 0)
        + (usage.cache_creation_input_tokens ?? 0)
        + (usage.cache_read_input_tokens ?? 0);
      const pct = Math.round((inputTotal / this.CONTEXT_WINDOW) * 100);
      contextStr = `${this.formatTokens(inputTotal)} (${pct}%)`;
      contextTitle = `Input: ${inputTotal.toLocaleString()} / ${this.CONTEXT_WINDOW.toLocaleString()} tokens — Output: ${(usage.output_tokens ?? 0).toLocaleString()}`;
    }

    return [
      {
        id: 'branch',
        icon: 'pi-code-branch',
        label: '',
        value: this.branch(),
        title: 'Git branch of active session working directory',
      },
      {
        id: 'context',
        icon: 'pi-database',
        label: 'ctx',
        value: contextStr,
        title: contextTitle,
      },
    ];
  });

  constructor() {
    effect(() => {
      const cwd = this.activeInstance()?.cwd;
      if (cwd) {
        this.http.get<{ branch: string | null }>(`/api/git-branch?cwd=${encodeURIComponent(cwd)}`)
          .subscribe({
            next: (res) => this.branch.set(res.branch ?? 'no branch'),
            error: () => this.branch.set('—'),
          });
      } else {
        this.branch.set('—');
      }
    }, { allowSignalWrites: true });
  }

  private formatTokens(n: number): string {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }
}

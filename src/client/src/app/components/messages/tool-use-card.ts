import { Component, input, output, signal, computed } from '@angular/core';
import { Button } from 'primeng/button';
import { InstanceMessage } from '../../models/instance.model';

@Component({
  selector: 'app-tool-use-card',
  standalone: true,
  imports: [Button],
  template: `
    <div class="my-2 rounded-lg border overflow-hidden"
         [class]="awaitingApproval() ? 'border-yellow-500 animate-pulse-border' : 'border-surface-200 dark:border-surface-700'">
      <!-- Header: tool name + summary -->
      <button
        class="w-full px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
        [class.bg-yellow-500/10]="awaitingApproval()"
        (click)="expanded.set(!expanded())"
      >
        <div class="flex items-center gap-2 min-w-0">
          <i class="pi text-[10px]" [class]="expanded() ? 'pi-chevron-down' : 'pi-chevron-right'"></i>
          <i class="pi pi-wrench text-xs" [class]="awaitingApproval() ? 'text-yellow-600' : 'text-surface-400'"></i>
          <span class="font-mono text-sm font-semibold" [class]="awaitingApproval() ? 'text-yellow-600 dark:text-yellow-400' : ''">{{ message().toolName }}</span>
          <span class="text-xs text-surface-400 truncate">{{ toolSummary() }}</span>
        </div>
        @if (awaitingApproval()) {
          <div class="flex gap-2 ml-2" (click)="$event.stopPropagation()">
            <p-button
              label="Approve"
              severity="success"
              size="small"
              (onClick)="approved.emit()" />
            <p-button
              label="Yes, don't ask again"
              severity="success"
              size="small"
              [outlined]="true"
              (onClick)="approvedSession.emit(message().pendingId ?? '')" />
            <p-button
              label="Reject"
              severity="danger"
              size="small"
              (onClick)="rejected.emit()" />
          </div>
        }
      </button>

      <!-- Expanded detail -->
      @if (expanded()) {
        <div class="px-3 pb-2 border-t border-surface-200 dark:border-surface-700">
          @if (detailMode() === 'diff') {
            <div class="mt-2 rounded bg-surface-50 dark:bg-surface-900 overflow-x-auto max-h-64 overflow-y-auto">
              @for (line of diffLines(); track $index) {
                <div class="font-mono text-xs px-2 leading-relaxed"
                     [class]="line.type === 'remove' ? 'bg-red-500/15 text-red-400' : line.type === 'add' ? 'bg-green-500/15 text-green-400' : 'text-surface-400'">{{ line.text }}</div>
              }
            </div>
          } @else if (detailMode() === 'filepath') {
            <div class="mt-2 text-xs font-mono text-surface-400 p-2 bg-surface-50 dark:bg-surface-900 rounded">{{ filePath() }}</div>
          } @else {
            <pre class="text-xs overflow-x-auto m-0 p-2 mt-2 bg-surface-50 dark:bg-surface-900 rounded font-mono max-h-64 overflow-y-auto text-surface-400">{{ formatInput() }}</pre>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .animate-pulse-border {
      animation: pulse-border 2s ease-in-out infinite;
    }
    @keyframes pulse-border {
      0%, 100% { border-color: rgba(234, 179, 8, 0.5); }
      50% { border-color: rgba(234, 179, 8, 1); }
    }
  `],
})
export class ToolUseCard {
  message = input.required<InstanceMessage>();
  awaitingApproval = input<boolean>(false);
  approved = output<void>();
  approvedSession = output<string>();
  rejected = output<void>();
  expanded = signal(false);

  detailMode = computed<'diff' | 'filepath' | 'json'>(() => {
    const inp = this.message().input as Record<string, unknown> | undefined;
    if (!inp) return 'json';
    if ('old_string' in inp && 'new_string' in inp) return 'diff';
    if ('file_path' in inp && !('old_string' in inp) && !('command' in inp)) return 'filepath';
    return 'json';
  });

  filePath = computed(() => {
    const inp = this.message().input as Record<string, unknown> | undefined;
    return String(inp?.['file_path'] || inp?.['filePath'] || '');
  });

  diffLines = computed(() => {
    const inp = this.message().input as Record<string, unknown> | undefined;
    if (!inp) return [];

    const oldStr = String(inp['old_string'] || inp['oldString'] || '');
    const newStr = String(inp['new_string'] || inp['newString'] || '');

    const oldLines = oldStr.split('\n');
    const newLines = newStr.split('\n');

    const result: { type: 'remove' | 'add' | 'context'; text: string }[] = [];

    // Simple diff: find common prefix/suffix, show removed then added for the changed middle
    let prefixLen = 0;
    while (prefixLen < oldLines.length && prefixLen < newLines.length && oldLines[prefixLen] === newLines[prefixLen]) {
      prefixLen++;
    }

    let suffixLen = 0;
    while (
      suffixLen < (oldLines.length - prefixLen) &&
      suffixLen < (newLines.length - prefixLen) &&
      oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
    ) {
      suffixLen++;
    }

    // Context lines before (up to 2)
    const ctxBefore = Math.max(0, prefixLen - 2);
    for (let i = ctxBefore; i < prefixLen; i++) {
      result.push({ type: 'context', text: '  ' + oldLines[i] });
    }

    // Removed lines
    const oldEnd = oldLines.length - suffixLen;
    for (let i = prefixLen; i < oldEnd; i++) {
      result.push({ type: 'remove', text: '- ' + oldLines[i] });
    }

    // Added lines
    const newEnd = newLines.length - suffixLen;
    for (let i = prefixLen; i < newEnd; i++) {
      result.push({ type: 'add', text: '+ ' + newLines[i] });
    }

    // Context lines after (up to 2)
    const ctxAfterStart = oldLines.length - suffixLen;
    const ctxAfterEnd = Math.min(oldLines.length, ctxAfterStart + 2);
    for (let i = ctxAfterStart; i < ctxAfterEnd; i++) {
      result.push({ type: 'context', text: '  ' + oldLines[i] });
    }

    return result;
  });

  toolSummary(): string {
    const inp = this.message().input;
    if (!inp || typeof inp !== 'object') return '';

    const tool = this.message().toolName;

    if (tool === 'Edit' || tool === 'Write' || tool === 'Read') {
      const filePath = (inp as any)['file_path'] || (inp as any)['filePath'] || '';
      if (filePath) {
        const parts = String(filePath).replace(/\\/g, '/').split('/');
        return parts.slice(-2).join('/');
      }
    }

    if (tool === 'Bash') {
      const cmd = (inp as any)['command'] || '';
      if (cmd) {
        const trimmed = String(cmd).trim();
        return trimmed.length > 80 ? trimmed.substring(0, 80) + '...' : trimmed;
      }
    }

    if (tool === 'Glob' || tool === 'Grep') {
      const pattern = (inp as any)['pattern'] || (inp as any)['glob'] || '';
      return pattern ? String(pattern) : '';
    }

    if (tool === 'Task') {
      const desc = (inp as any)['description'] || '';
      return desc ? String(desc) : '';
    }

    if (tool === 'WebFetch' || tool === 'WebSearch') {
      return (inp as any)['url'] || (inp as any)['query'] || '';
    }

    for (const [, val] of Object.entries(inp)) {
      if (typeof val === 'string' && val.length > 0) {
        const trimmed = val.length > 60 ? val.substring(0, 60) + '...' : val;
        return trimmed;
      }
    }

    return '';
  }

  formatInput(): string {
    try {
      return JSON.stringify(this.message().input, null, 2);
    } catch {
      return String(this.message().input);
    }
  }
}

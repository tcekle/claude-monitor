import { Component, input, signal } from '@angular/core';
import { InstanceMessage } from '../../models/instance.model';

@Component({
  selector: 'app-tool-result-card',
  standalone: true,
  template: `
    <div class="my-1">
      <button
        class="flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors cursor-pointer"
        (click)="expanded.set(!expanded())"
      >
        <i class="pi text-[10px]" [class]="expanded() ? 'pi-chevron-down' : 'pi-chevron-right'"></i>
        <i class="pi pi-check-circle text-[10px]"></i>
        <span>{{ summary() }}</span>
      </button>
      @if (expanded()) {
        <div class="ml-5 mt-1 pl-3 border-l border-surface-200 dark:border-surface-700">
          <pre class="text-xs text-surface-400 font-mono whitespace-pre-wrap leading-relaxed m-0 max-h-64 overflow-y-auto">{{ outputText() }}</pre>
        </div>
      }
    </div>
  `,
})
export class ToolResultCard {
  message = input.required<InstanceMessage>();
  expanded = signal(false);

  summary(): string {
    const content = this.message().content;
    if (!content) return 'Done';

    const obj = this.asObj(content);

    // Edit: "Edited hook-manager.js"
    if (obj && 'newString' in obj && 'filePath' in obj) {
      return `Edited ${this.shortPath(obj['filePath'] as string)}`;
    }

    // Read: { type: "text", file: { filePath, content, numLines, ... } }
    if (obj && 'file' in obj && this.asObj(obj['file'])) {
      const file = obj['file'] as Record<string, unknown>;
      const lines = file['numLines'] || 0;
      return `Read ${this.shortPath(file['filePath'] as string)} (${lines} lines)`;
    }

    // Write: "Wrote filename"
    if (obj && 'filePath' in obj && !('newString' in obj) && !('content' in obj)) {
      return `Wrote ${this.shortPath(obj['filePath'] as string)}`;
    }

    // Glob: "3 files found"
    if (obj && 'filenames' in obj) {
      const n = (obj['numFiles'] as number) || (obj['filenames'] as unknown[])?.length || 0;
      return `${n} file${n !== 1 ? 's' : ''} found`;
    }

    // Grep: "N matches"
    if (obj && 'numMatches' in obj) {
      return `${obj['numMatches']} match${(obj['numMatches'] as number) !== 1 ? 'es' : ''}`;
    }

    // Read: line count
    if (obj && 'content' in obj && typeof obj['content'] === 'string') {
      const lines = (obj['content'] as string).split('\n').length;
      return `${lines} line${lines !== 1 ? 's' : ''} read`;
    }

    // Bash: last meaningful line of stdout
    if (obj && ('stdout' in obj || 'stderr' in obj)) {
      const stdout = typeof obj['stdout'] === 'string' ? obj['stdout'] : '';
      const stderr = typeof obj['stderr'] === 'string' ? obj['stderr'] : '';
      const text = (stdout || stderr).trim();
      if (!text) return 'Done (no output)';
      const lastLine = text.split('\n').filter((l: string) => l.trim()).pop() || '';
      const trimmed = lastLine.trim();
      return trimmed.length > 80 ? trimmed.substring(0, 80) + '...' : trimmed;
    }

    // String content
    if (typeof content === 'string') {
      const text = content.trim();
      if (!text) return 'Done';
      const lastLine = text.split('\n').filter((l: string) => l.trim()).pop() || '';
      const trimmed = lastLine.trim();
      return trimmed.length > 80 ? trimmed.substring(0, 80) + '...' : trimmed;
    }

    // Array of content blocks
    if (Array.isArray(content)) {
      return `${content.length} block${content.length !== 1 ? 's' : ''}`;
    }

    return 'Done';
  }

  outputText(): string {
    const content = this.message().content;
    if (!content) return '';

    const obj = this.asObj(content);

    // Edit: show the newString (what was written)
    if (obj && 'newString' in obj) {
      return obj['newString'] as string;
    }

    // Read: { type: "text", file: { filePath, content, ... } }
    if (obj && 'file' in obj && this.asObj(obj['file'])) {
      const file = obj['file'] as Record<string, unknown>;
      return (file['content'] as string) || '';
    }

    // Bash: stdout + stderr
    if (obj && ('stdout' in obj || 'stderr' in obj)) {
      const parts: string[] = [];
      if (obj['stdout'] && typeof obj['stdout'] === 'string') parts.push(obj['stdout']);
      if (obj['stderr'] && typeof obj['stderr'] === 'string') {
        parts.push(parts.length ? `--- stderr ---\n${obj['stderr']}` : obj['stderr']);
      }
      return parts.join('\n').trim();
    }

    // Glob: list filenames
    if (obj && 'filenames' in obj && Array.isArray(obj['filenames'])) {
      return (obj['filenames'] as string[]).join('\n');
    }

    // Read: file content
    if (obj && 'content' in obj && typeof obj['content'] === 'string') {
      return obj['content'] as string;
    }

    // String
    if (typeof content === 'string') return content;

    // Array of content blocks
    if (Array.isArray(content)) {
      return content
        .map((block: any) => {
          if (typeof block === 'string') return block;
          if (block?.text) return block.text;
          return JSON.stringify(block, null, 2);
        })
        .join('\n');
    }

    // Fallback: JSON
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  }

  private asObj(content: unknown): Record<string, unknown> | null {
    return (typeof content === 'object' && content && !Array.isArray(content))
      ? content as Record<string, unknown>
      : null;
  }

  private shortPath(filePath: string): string {
    const parts = String(filePath).replace(/\\/g, '/').split('/');
    return parts.slice(-2).join('/');
  }
}

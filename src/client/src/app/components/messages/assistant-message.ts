import { Component, input, computed, inject } from '@angular/core';
import { InstanceMessage } from '../../models/instance.model';
import { MarkdownService } from '../../services/markdown.service';

@Component({
  selector: 'app-assistant-message',
  standalone: true,
  template: `
    <div class="py-2 pl-3 border-l-2 border-primary/30">
      <div class="text-xs text-surface-500 mb-1">Assistant</div>
      <div class="markdown-body" [innerHTML]="rendered()"></div>
    </div>
  `,
})
export class AssistantMessage {
  private md = inject(MarkdownService);
  message = input.required<InstanceMessage>();

  rendered = computed(() => this.md.render(this.message().text ?? ''));
}

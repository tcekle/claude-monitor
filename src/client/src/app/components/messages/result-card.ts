import { Component, input, computed, inject } from '@angular/core';
import { Card } from 'primeng/card';
import { InstanceMessage } from '../../models/instance.model';
import { MarkdownService } from '../../services/markdown.service';

@Component({
  selector: 'app-result-card',
  standalone: true,
  imports: [Card],
  templateUrl: './result-card.html',
})
export class ResultCard {
  private md = inject(MarkdownService);
  message = input.required<InstanceMessage>();

  rendered = computed(() => this.md.render(this.message().text ?? ''));

  formatCost(value: number): string {
    return '$' + value.toFixed(4);
  }

  formatDuration(ms: number): string {
    return (ms / 1000).toFixed(1) + 's';
  }
}

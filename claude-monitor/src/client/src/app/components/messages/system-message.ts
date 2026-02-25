import { Component, input } from '@angular/core';
import { InstanceMessage } from '../../models/instance.model';

@Component({
  selector: 'app-system-message',
  standalone: true,
  template: `
    <div class="text-xs text-surface-400 font-mono py-0.5 pl-2 border-l border-surface-300">
      {{ message().text }}
    </div>
  `,
})
export class SystemMessage {
  message = input.required<InstanceMessage>();
}

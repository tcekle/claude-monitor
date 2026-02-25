import { Component, input } from '@angular/core';
import { InstanceMessage } from '../../models/instance.model';

@Component({
  selector: 'app-user-input-message',
  standalone: true,
  template: `
    <div class="flex justify-end my-1">
      <div class="bg-primary/10 text-primary rounded-lg px-3 py-1.5 text-sm max-w-[80%]">
        <span class="text-xs opacity-60">You</span>
        <div class="font-mono">{{ message().text }}</div>
      </div>
    </div>
  `,
})
export class UserInputMessage {
  message = input.required<InstanceMessage>();
}

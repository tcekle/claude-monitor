import {
  Component, inject, ElementRef, viewChild,
  effect, signal,
} from '@angular/core';
import { JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { InstanceStoreService } from '../../services/instance-store.service';
import { NotificationService } from '../../services/notification.service';
import { AssistantMessage } from '../messages/assistant-message';
import { ToolUseCard } from '../messages/tool-use-card';
import { ToolResultCard } from '../messages/tool-result-card';
import { UserInputMessage } from '../messages/user-input-message';
import { SystemMessage } from '../messages/system-message';

@Component({
  selector: 'app-instance-panel',
  standalone: true,
  imports: [
    JsonPipe, FormsModule, Button, Tag, ToggleSwitch,
    AssistantMessage, ToolUseCard, ToolResultCard,
    UserInputMessage, SystemMessage,
  ],
  templateUrl: './instance-panel.html',
  styleUrl: './instance-panel.css',
})
export class InstancePanel {
  store = inject(InstanceStoreService);
  private notifications = inject(NotificationService);

  private scrollContainer = viewChild<ElementRef>('scrollContainer');

  instance = this.store.activeInstance;
  messages = this.store.activeMessages;

  showToolResults = false;
  showSystemMessages = false;
  pinnedToBottom = signal(true);
  private lastMessageCount = 0;

  constructor() {
    // Auto-scroll effect
    effect(() => {
      const msgs = this.messages();
      if (msgs.length > this.lastMessageCount && this.pinnedToBottom()) {
        this.lastMessageCount = msgs.length;
        setTimeout(() => this.scrollToBottom(), 0);
      }

      // Notify on new tool_use requiring approval
      const latest = msgs[msgs.length - 1];
      if (latest?.type === 'tool_use' && this.instance()?.status === 'awaiting_approval') {
        this.notifications.notifyApprovalNeeded(
          this.instance()!.name,
          latest.toolName ?? 'unknown',
        );
      }
    });
  }

  onScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    this.pinnedToBottom.set(atBottom);
  }

  scrollToBottom(): void {
    const el = this.scrollContainer()?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  approve(msg: any): void {
    if (msg?.pendingId) {
      this.store.approve(msg.pendingId);
    }
  }

  approveSession(pendingId: string): void {
    const id = this.instance()?.id;
    if (id) {
      // Approve the current pending decision first, then enable auto-approve
      if (pendingId) {
        this.store.approve(pendingId);
      }
      this.store.approveSession(id);
    }
  }

  reject(msg: any): void {
    if (msg?.pendingId) {
      this.store.reject(msg.pendingId);
    }
  }

  statusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' | 'secondary' {
    switch (status) {
      case 'running': return 'success';
      case 'idle': return 'info';
      case 'awaiting_approval': return 'warn';
      case 'monitoring': return 'info';
      case 'error': return 'danger';
      default: return 'secondary';
    }
  }
}

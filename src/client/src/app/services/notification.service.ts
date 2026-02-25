import { Injectable, inject } from '@angular/core';
import { MessageService } from 'primeng/api';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private messageService = inject(MessageService);
  private permissionGranted = false;

  requestPermission(): void {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then((result) => {
        this.permissionGranted = result === 'granted';
      });
    } else if ('Notification' in window) {
      this.permissionGranted = Notification.permission === 'granted';
    }
  }

  notifyApprovalNeeded(instanceName: string, toolName: string): void {
    // In-app toast
    this.messageService.add({
      severity: 'warn',
      summary: `Approval needed: ${instanceName}`,
      detail: `Tool: ${toolName}`,
      life: 10000,
    });

    // Browser notification
    if (this.permissionGranted) {
      new Notification(`Claude Monitor — ${instanceName}`, {
        body: `Tool "${toolName}" needs approval`,
        icon: '/favicon.ico',
        tag: `approval-${instanceName}`,
      });
    }
  }

  notifyError(message: string): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: message,
      life: 5000,
    });
  }

  notifyInfo(message: string): void {
    this.messageService.add({
      severity: 'info',
      summary: 'Info',
      detail: message,
      life: 3000,
    });
  }
}

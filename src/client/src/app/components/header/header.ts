import { Component, inject, computed } from '@angular/core';
import { Toolbar } from 'primeng/toolbar';
import { Badge } from 'primeng/badge';
import { Tag } from 'primeng/tag';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { FormsModule } from '@angular/forms';
import { WebSocketService } from '../../services/websocket.service';
import { InstanceStoreService } from '../../services/instance-store.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [Toolbar, Badge, Tag, ToggleSwitch, FormsModule],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class Header {
  private ws = inject(WebSocketService);
  private store = inject(InstanceStoreService);

  connectionStatus = this.ws.connectionStatus;
  isConnected = this.ws.isConnected;
  totalCost = this.store.totalCost;
  hasAwaitingApproval = this.store.hasAwaitingApproval;

  isDarkMode = false;

  statusColor = computed(() => {
    switch (this.connectionStatus()) {
      case 'connected': return 'success';
      case 'reconnecting': return 'warn';
      default: return 'danger';
    }
  });

  constructor() {
    // Default to dark mode
    this.isDarkMode = true;
    document.documentElement.classList.add('dark-mode');
  }

  toggleDarkMode(): void {
    if (this.isDarkMode) {
      document.documentElement.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
    }
  }

  formatCost(cost: number): string {
    return cost > 0 ? `$${cost.toFixed(4)}` : '$0.00';
  }
}

import { Component, inject, signal, OnInit } from '@angular/core';
import { Toast } from 'primeng/toast';
import { WebSocketService } from './services/websocket.service';
import { NotificationService } from './services/notification.service';
import { Sidebar } from './components/sidebar/sidebar';
import { InstancePanel } from './components/instance-panel/instance-panel';
import { StatusBar } from './components/status-bar/status-bar';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [Toast, Sidebar, InstancePanel, StatusBar],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private ws = inject(WebSocketService);
  private notifications = inject(NotificationService);

  sidebarOpen = signal(false);

  ngOnInit(): void {
    this.ws.connect();
    this.notifications.requestPermission();
  }

  sidebarClass(): string {
    const base = 'fixed lg:relative inset-y-0 left-0 z-30 flex-shrink-0 transition-transform duration-300 ease-in-out';
    return `${base} ${this.sidebarOpen() ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`;
  }
}

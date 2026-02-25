import { Component, inject, OnInit } from '@angular/core';
import { Toast } from 'primeng/toast';
import { WebSocketService } from './services/websocket.service';
import { NotificationService } from './services/notification.service';
import { Header } from './components/header/header';
import { TabBar } from './components/tab-bar/tab-bar';
import { InstancePanel } from './components/instance-panel/instance-panel';
import { StatusBar } from './components/status-bar/status-bar';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [Toast, Header, TabBar, InstancePanel, StatusBar],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private ws = inject(WebSocketService);
  private notifications = inject(NotificationService);

  ngOnInit(): void {
    this.ws.connect();
    this.notifications.requestPermission();
  }
}

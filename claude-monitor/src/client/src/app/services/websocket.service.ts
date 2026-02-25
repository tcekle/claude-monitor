import { Injectable, signal, computed } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { retry, Subject } from 'rxjs';
import { ClientAction, ServerMessage } from '../models/ws-messages.model';

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private ws$: WebSocketSubject<ServerMessage | ClientAction> | null = null;
  private _connectionStatus = signal<ConnectionStatus>('disconnected');
  private _messages$ = new Subject<ServerMessage>();

  readonly connectionStatus = this._connectionStatus.asReadonly();
  readonly isConnected = computed(() => this._connectionStatus() === 'connected');
  readonly messages$ = this._messages$.asObservable();

  connect(): void {
    if (this.ws$) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws`;

    this._connectionStatus.set('reconnecting');

    this.ws$ = webSocket<ServerMessage | ClientAction>({
      url,
      openObserver: {
        next: () => {
          console.log('[ws] Connected');
          this._connectionStatus.set('connected');
        },
      },
      closeObserver: {
        next: () => {
          console.log('[ws] Disconnected');
          this._connectionStatus.set('reconnecting');
        },
      },
    });

    this.ws$
      .pipe(retry({ delay: 2000 }))
      .subscribe({
        next: (msg) => this._messages$.next(msg as ServerMessage),
        error: (err) => {
          console.error('[ws] Error:', err);
          this._connectionStatus.set('disconnected');
          this.ws$ = null;
        },
      });
  }

  send(action: ClientAction): void {
    if (this.ws$) {
      this.ws$.next(action);
    }
  }

  disconnect(): void {
    if (this.ws$) {
      this.ws$.complete();
      this.ws$ = null;
      this._connectionStatus.set('disconnected');
    }
  }
}

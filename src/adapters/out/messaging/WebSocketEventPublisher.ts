import WebSocket from 'ws';
import { IEventPublisher } from '../../../core/application/ports/out/IEventPublisher';
import { DomainEvent } from '../../../core/domain/events/DomainEvent';
import { GameStateSnapshot } from '../../../core/domain/types/GameStateSnapshot';

export type ClientRegistry = Map<string, Set<WebSocket>>;

export class WebSocketEventPublisher implements IEventPublisher {
  constructor(private readonly registry: ClientRegistry) {}

  publishStateSnapshot(sessionId: string, snapshot: GameStateSnapshot): void {
    const clients = this.registry.get(sessionId);
    if (!clients || clients.size === 0) return;
    const payload = JSON.stringify({ type: 'state_update', snapshot });
    clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    });
  }

  publishToSession(sessionId: string, events: DomainEvent[]): void {
    const clients = this.registry.get(sessionId);
    if (!clients || clients.size === 0) return;
    for (const event of events) {
      const payload = JSON.stringify({ type: event.type });
      clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      });
    }
  }

  sendTo(ws: WebSocket, data: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }
}

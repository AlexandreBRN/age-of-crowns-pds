import WebSocket from 'ws';
import { IEventPublisher } from '../../../core/application/ports/out/IEventPublisher';
import { DomainEvent } from '../../../core/domain/events/DomainEvent';
import { PlayerJoined } from '../../../core/domain/events/PlayerJoined';
import { PlayerMoved } from '../../../core/domain/events/PlayerMoved';
import { PlayerLeft } from '../../../core/domain/events/PlayerLeft';

export type ClientRegistry = Map<string, Set<WebSocket>>;

export class WebSocketEventPublisher implements IEventPublisher {
  constructor(private readonly registry: ClientRegistry) {}

  publishToSession(sessionId: string, events: DomainEvent[]): void {
    const clients = this.registry.get(sessionId);
    if (!clients || clients.size === 0) return;

    for (const event of events) {
      const message = this.serialize(event);
      if (!message) continue;

      const payload = JSON.stringify(message);
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
    }
  }

  private serialize(event: DomainEvent): object | null {
    if (event instanceof PlayerJoined) {
      return { type: 'player_joined', player: event.player.toJSON() };
    }
    if (event instanceof PlayerMoved) {
      return {
        type: 'player_moved',
        playerId: event.playerId.value,
        position: event.newPosition.toJSON(),
      };
    }
    if (event instanceof PlayerLeft) {
      return { type: 'player_left', playerId: event.playerId.value };
    }
    return null;
  }
}

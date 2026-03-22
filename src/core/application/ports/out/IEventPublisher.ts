import { DomainEvent } from '../../../domain/events/DomainEvent';
import { GameStateSnapshot } from '../../../domain/types/GameStateSnapshot';

export interface IEventPublisher {
  publishToSession(sessionId: string, events: DomainEvent[]): void;
  publishStateSnapshot(sessionId: string, snapshot: GameStateSnapshot): void;
}

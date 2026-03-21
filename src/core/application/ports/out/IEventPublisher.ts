import { DomainEvent } from '../../../domain/events/DomainEvent';

export interface IEventPublisher {
  publishToSession(sessionId: string, events: DomainEvent[]): void;
}

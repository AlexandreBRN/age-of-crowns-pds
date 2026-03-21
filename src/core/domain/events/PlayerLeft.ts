import { DomainEvent } from './DomainEvent';
import { PlayerId } from '../value-objects/PlayerId';

export class PlayerLeft implements DomainEvent {
  public readonly type = 'PlayerLeft';
  public readonly occurredAt = new Date();

  constructor(public readonly playerId: PlayerId) {}
}

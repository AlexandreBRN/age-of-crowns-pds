import { DomainEvent } from './DomainEvent';
import { Player } from '../entities/Player';

export class PlayerJoined implements DomainEvent {
  public readonly type = 'PlayerJoined';
  public readonly occurredAt = new Date();

  constructor(public readonly player: Player) {}
}

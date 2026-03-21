import { DomainEvent } from './DomainEvent';
import { PlayerId } from '../value-objects/PlayerId';
import { Position } from '../value-objects/Position';

export class PlayerMoved implements DomainEvent {
  public readonly type = 'PlayerMoved';
  public readonly occurredAt = new Date();

  constructor(
    public readonly playerId: PlayerId,
    public readonly newPosition: Position,
  ) {}
}

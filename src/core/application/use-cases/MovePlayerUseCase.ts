import { IMovePlayerUseCase, MovePlayerCommand } from '../ports/in/IMovePlayerUseCase';
import { ISessionRepository } from '../ports/out/ISessionRepository';
import { IEventPublisher } from '../ports/out/IEventPublisher';
import { PlayerId } from '../../domain/value-objects/PlayerId';

export class MovePlayerUseCase implements IMovePlayerUseCase {
  constructor(
    private readonly sessionRepository: ISessionRepository,
    private readonly eventPublisher: IEventPublisher,
  ) {}

  execute(command: MovePlayerCommand): void {
    const session = this.sessionRepository.findDefault();
    const playerId = new PlayerId(command.playerId);

    session.movePlayer(playerId, command.direction);
    this.sessionRepository.save(session);

    const events = session.pullEvents();
    this.eventPublisher.publishToSession(session.id, events);
  }
}

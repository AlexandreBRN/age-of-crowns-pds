import { ILeaveSessionUseCase, LeaveSessionCommand } from '../ports/in/ILeaveSessionUseCase';
import { ISessionRepository } from '../ports/out/ISessionRepository';
import { IEventPublisher } from '../ports/out/IEventPublisher';
import { PlayerId } from '../../domain/value-objects/PlayerId';

export class LeaveSessionUseCase implements ILeaveSessionUseCase {
  constructor(
    private readonly sessionRepository: ISessionRepository,
    private readonly eventPublisher: IEventPublisher,
  ) {}

  execute(command: LeaveSessionCommand): void {
    const session = this.sessionRepository.findDefault();
    const playerId = new PlayerId(command.playerId);

    session.removePlayer(playerId);
    this.sessionRepository.save(session);

    const events = session.pullEvents();
    this.eventPublisher.publishToSession(session.id, events);
  }
}

import { ILeaveSessionUseCase, LeaveSessionCommand } from '../ports/in/ILeaveSessionUseCase';
import { ISessionRepository } from '../ports/out/ISessionRepository';

export class LeaveSessionUseCase implements ILeaveSessionUseCase {
  constructor(private readonly sessionRepository: ISessionRepository) {}

  execute(command: LeaveSessionCommand): void {
    const session = this.sessionRepository.findDefault();
    session.removePlayer(command.playerId);
    this.sessionRepository.save(session);
  }
}

import { IMoveVillagerUseCase, MoveVillagerCommand } from '../ports/in/IMoveVillagerUseCase';
import { ISessionRepository } from '../ports/out/ISessionRepository';

export class MoveVillagerUseCase implements IMoveVillagerUseCase {
  constructor(private readonly sessionRepository: ISessionRepository) {}

  execute(command: MoveVillagerCommand): void {
    const session = this.sessionRepository.findDefault();
    session.commandVillagerMove(
      command.villagerId,
      command.destination.x,
      command.destination.y,
    );
    this.sessionRepository.save(session);
  }
}

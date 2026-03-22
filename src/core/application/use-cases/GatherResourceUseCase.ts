import { IGatherResourceUseCase, GatherResourceCommand } from '../ports/in/IGatherResourceUseCase';
import { ISessionRepository } from '../ports/out/ISessionRepository';

export class GatherResourceUseCase implements IGatherResourceUseCase {
  constructor(private readonly sessionRepository: ISessionRepository) {}

  execute(command: GatherResourceCommand): void {
    const session = this.sessionRepository.findDefault();
    session.commandVillagerGather(command.villagerId, command.nodeId);
    this.sessionRepository.save(session);
  }
}

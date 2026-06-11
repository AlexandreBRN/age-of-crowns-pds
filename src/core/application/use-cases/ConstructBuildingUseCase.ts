import { IConstructBuildingUseCase, ConstructBuildingCommand } from '../ports/in/IConstructBuildingUseCase';
import { ISessionRepository } from '../ports/out/ISessionRepository';

export class ConstructBuildingUseCase implements IConstructBuildingUseCase {
  constructor(private readonly sessionRepository: ISessionRepository) {}

  execute(command: ConstructBuildingCommand): void {
    const session = this.sessionRepository.findDefault();
    session.commandVillagerConstruct(command.villagerId, command.buildingId);
    this.sessionRepository.save(session);
  }
}

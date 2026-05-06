import { IPlaceBuildingUseCase, PlaceBuildingCommand } from '../ports/in/IPlaceBuildingUseCase';
import { ISessionRepository } from '../ports/out/ISessionRepository';

export class PlaceBuildingUseCase implements IPlaceBuildingUseCase {
  constructor(private readonly sessionRepository: ISessionRepository) {}

  execute(command: PlaceBuildingCommand): void {
    const session = this.sessionRepository.findDefault();
    session.placeBuilding(command.playerId, command.buildingType, command.x, command.y, command.villagerId);
    this.sessionRepository.save(session);
  }
}

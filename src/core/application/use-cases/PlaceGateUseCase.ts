import { IPlaceGateUseCase, PlaceGateCommand } from '../ports/in/IPlaceGateUseCase';
import { ISessionRepository } from '../ports/out/ISessionRepository';

export class PlaceGateUseCase implements IPlaceGateUseCase {
  constructor(private readonly sessionRepository: ISessionRepository) {}

  execute(command: PlaceGateCommand): void {
    const session = this.sessionRepository.findDefault();
    session.placeGate(command.playerId, command.x, command.y, command.villagerId);
    this.sessionRepository.save(session);
  }
}

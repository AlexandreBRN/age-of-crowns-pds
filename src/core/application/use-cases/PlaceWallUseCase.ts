import { IPlaceWallUseCase, PlaceWallCommand } from '../ports/in/IPlaceWallUseCase';
import { ISessionRepository } from '../ports/out/ISessionRepository';

export class PlaceWallUseCase implements IPlaceWallUseCase {
  constructor(private readonly sessionRepository: ISessionRepository) {}

  execute(command: PlaceWallCommand): void {
    const session = this.sessionRepository.findDefault();
    session.placeWall(
      command.playerId,
      command.startX,
      command.startY,
      command.endX,
      command.endY,
      command.villagerId,
    );
    this.sessionRepository.save(session);
  }
}

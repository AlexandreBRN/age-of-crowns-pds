import { ITrainVillagerUseCase, TrainVillagerCommand } from '../ports/in/ITrainVillagerUseCase';
import { ISessionRepository } from '../ports/out/ISessionRepository';

export class TrainVillagerUseCase implements ITrainVillagerUseCase {
  constructor(private readonly sessionRepository: ISessionRepository) {}

  execute(command: TrainVillagerCommand): void {
    const session = this.sessionRepository.findDefault();
    session.startTrainingUnit(command.playerId, command.unitType ?? 'villager');
    this.sessionRepository.save(session);
  }
}

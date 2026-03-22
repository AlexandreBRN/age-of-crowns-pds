import { ITrainVillagerUseCase, TrainVillagerCommand } from '../ports/in/ITrainVillagerUseCase';
import { ISessionRepository } from '../ports/out/ISessionRepository';

export class TrainVillagerUseCase implements ITrainVillagerUseCase {
  constructor(private readonly sessionRepository: ISessionRepository) {}

  execute(command: TrainVillagerCommand): void {
    const session = this.sessionRepository.findDefault();
    session.startTrainingVillager(command.playerId);
    this.sessionRepository.save(session);
  }
}

import { UnitType } from '../../../domain/entities/Villager';

export interface TrainVillagerCommand {
  playerId: string;
  unitType?: UnitType;
}

export interface ITrainVillagerUseCase {
  execute(command: TrainVillagerCommand): void;
}

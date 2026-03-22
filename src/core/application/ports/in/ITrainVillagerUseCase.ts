export interface TrainVillagerCommand {
  playerId: string;
}

export interface ITrainVillagerUseCase {
  execute(command: TrainVillagerCommand): void;
}

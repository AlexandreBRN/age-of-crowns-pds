export interface ConstructBuildingCommand {
  playerId: string;
  villagerId: string;
  buildingId: string;
}

export interface IConstructBuildingUseCase {
  execute(command: ConstructBuildingCommand): void;
}

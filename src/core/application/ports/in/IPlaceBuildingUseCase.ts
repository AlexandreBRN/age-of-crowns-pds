import { PlayerBuildingType } from '../../../domain/entities/PlayerBuilding';

export interface PlaceBuildingCommand {
  playerId: string;
  buildingType: PlayerBuildingType;
  x: number;
  y: number;
  villagerId?: string;
}

export interface IPlaceBuildingUseCase {
  execute(command: PlaceBuildingCommand): void;
}

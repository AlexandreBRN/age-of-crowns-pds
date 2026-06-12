export interface PlaceWallCommand {
  playerId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  villagerId?: string;
}

export interface IPlaceWallUseCase {
  execute(command: PlaceWallCommand): void;
}

export interface PlaceGateCommand {
  playerId: string;
  x: number;
  y: number;
  villagerId?: string;
}

export interface IPlaceGateUseCase {
  execute(command: PlaceGateCommand): void;
}

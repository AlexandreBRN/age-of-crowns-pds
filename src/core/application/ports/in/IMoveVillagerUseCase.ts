export interface MoveVillagerCommand {
  playerId: string;
  villagerId: string;
  destination: { x: number; y: number };
}

export interface IMoveVillagerUseCase {
  execute(command: MoveVillagerCommand): void;
}

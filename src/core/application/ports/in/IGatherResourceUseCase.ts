export interface GatherResourceCommand {
  playerId: string;
  villagerId: string;
  nodeId: string;
}

export interface IGatherResourceUseCase {
  execute(command: GatherResourceCommand): void;
}

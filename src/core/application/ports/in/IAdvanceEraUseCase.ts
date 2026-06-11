export interface AdvanceEraCommand {
  playerId: string;
}

export interface IAdvanceEraUseCase {
  execute(command: AdvanceEraCommand): void;
}

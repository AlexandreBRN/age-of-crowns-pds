export interface JoinSessionCommand {
  playerName: string;
}

export interface JoinSessionResult {
  playerId: string;
  sessionId: string;
}

export interface IJoinSessionUseCase {
  execute(command: JoinSessionCommand): JoinSessionResult;
}

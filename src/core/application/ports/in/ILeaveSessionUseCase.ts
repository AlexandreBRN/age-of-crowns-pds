export interface LeaveSessionCommand {
  playerId: string;
}

export interface ILeaveSessionUseCase {
  execute(command: LeaveSessionCommand): void;
}

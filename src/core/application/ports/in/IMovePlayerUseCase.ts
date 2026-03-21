export type Direction = 'up' | 'down' | 'left' | 'right';

export interface MovePlayerCommand {
  playerId: string;
  direction: Direction;
}

export interface IMovePlayerUseCase {
  execute(command: MovePlayerCommand): void;
}

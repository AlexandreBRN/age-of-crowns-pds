import { GameSession } from '../../../domain/entities/GameSession';

export interface ISessionRepository {
  findById(id: string): GameSession | undefined;
  findDefault(): GameSession;
  save(session: GameSession): void;
}

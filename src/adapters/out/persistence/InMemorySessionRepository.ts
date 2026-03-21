import { ISessionRepository } from '../../../core/application/ports/out/ISessionRepository';
import { GameSession } from '../../../core/domain/entities/GameSession';

const DEFAULT_SESSION_ID = 'default-session';

export class InMemorySessionRepository implements ISessionRepository {
  private readonly sessions: Map<string, GameSession> = new Map();

  constructor() {
    this.sessions.set(DEFAULT_SESSION_ID, new GameSession(DEFAULT_SESSION_ID));
  }

  findById(id: string): GameSession | undefined {
    return this.sessions.get(id);
  }

  findDefault(): GameSession {
    return this.sessions.get(DEFAULT_SESSION_ID)!;
  }

  save(session: GameSession): void {
    this.sessions.set(session.id, session);
  }
}

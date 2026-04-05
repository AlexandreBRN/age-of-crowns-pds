import { ISessionRepository } from '../../../core/application/ports/out/ISessionRepository';
import { GameSession } from '../../../core/domain/entities/GameSession';
import { MapGeneratorService } from '../../../core/application/services/MapGeneratorService';

const DEFAULT_SESSION_ID = 'default-session';

export class InMemorySessionRepository implements ISessionRepository {
  private readonly sessions: Map<string, GameSession> = new Map();

  constructor() {
    const map = MapGeneratorService.generate(100, 100);
    const session = new GameSession(DEFAULT_SESSION_ID, map.tiles, map.resourceNodes);
    this.sessions.set(DEFAULT_SESSION_ID, session);
    console.log(`[Mapa] Gerado com ${map.resourceNodes.length} nós de recursos`);
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

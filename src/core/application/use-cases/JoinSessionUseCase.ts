import { IJoinSessionUseCase, JoinSessionCommand, JoinSessionResult } from '../ports/in/IJoinSessionUseCase';
import { ISessionRepository } from '../ports/out/ISessionRepository';
import { IEventPublisher } from '../ports/out/IEventPublisher';
import { Player } from '../../domain/entities/Player';
import { PlayerId } from '../../domain/value-objects/PlayerId';

export class JoinSessionUseCase implements IJoinSessionUseCase {
  constructor(
    private readonly sessionRepository: ISessionRepository,
    private readonly eventPublisher: IEventPublisher,
  ) {}

  execute(command: JoinSessionCommand): JoinSessionResult {
    const session = this.sessionRepository.findDefault();

    if (session.isFull) {
      throw new Error('Session is full — max 2 players');
    }

    const playerId = PlayerId.generate();
    const spawnPosition = session.getSpawnPosition();
    const player = new Player(playerId, command.playerName, spawnPosition);

    session.addPlayer(player);
    this.sessionRepository.save(session);

    const events = session.pullEvents();
    this.eventPublisher.publishToSession(session.id, events);

    return { playerId: playerId.value, sessionId: session.id };
  }
}

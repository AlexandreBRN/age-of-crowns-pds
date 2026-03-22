import { IJoinSessionUseCase, JoinSessionCommand, JoinSessionResult } from '../ports/in/IJoinSessionUseCase';
import { ISessionRepository } from '../ports/out/ISessionRepository';
import { v4 as uuidv4 } from 'uuid';

export class JoinSessionUseCase implements IJoinSessionUseCase {
  constructor(private readonly sessionRepository: ISessionRepository) {}

  execute(command: JoinSessionCommand): JoinSessionResult {
    const session = this.sessionRepository.findDefault();

    if (session.isFull) {
      throw new Error('Sessão cheia — máximo 2 jogadores');
    }

    const playerId = uuidv4();
    session.addPlayer(playerId, command.playerName);
    this.sessionRepository.save(session);

    return { playerId, sessionId: session.id };
  }
}

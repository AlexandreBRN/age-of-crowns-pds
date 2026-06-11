import { IAdvanceEraUseCase, AdvanceEraCommand } from '../ports/in/IAdvanceEraUseCase';
import { ISessionRepository } from '../ports/out/ISessionRepository';

export class AdvanceEraUseCase implements IAdvanceEraUseCase {
  constructor(private readonly sessionRepository: ISessionRepository) {}

  execute(command: AdvanceEraCommand): void {
    const session = this.sessionRepository.findDefault();
    session.commandAdvanceEra(command.playerId);
    this.sessionRepository.save(session);
  }
}

import { ISessionRepository } from '../ports/out/ISessionRepository';
import { IEventPublisher } from '../ports/out/IEventPublisher';

const TICK_MS = 250;

export class GameLoopService {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sessionRepository: ISessionRepository,
    private readonly eventPublisher: IEventPublisher,
  ) {}

  start(): void {
    if (this.intervalHandle !== null) return;
    this.intervalHandle = setInterval(() => this.tick(), TICK_MS);
    console.log('[GameLoop] Iniciado');
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      console.log('[GameLoop] Parado');
    }
  }

  get isRunning(): boolean {
    return this.intervalHandle !== null;
  }

  private tick(): void {
    const session = this.sessionRepository.findDefault();

    if (session.players.length < 2) return;

    // Partida encerrada: o estado fica congelado (advanceTick é no-op), mas
    // continuamos transmitindo o snapshot final a cada tick. Assim os DOIS
    // jogadores recebem, de forma simultânea e confiável, as barras de vida
    // finais e a tela de vitória/derrota — sem depender de um único frame.
    if (!session.isGameOver) {
      session.advanceTick();
      this.sessionRepository.save(session);
    }

    const snapshot = session.toStateSnapshot();
    this.eventPublisher.publishStateSnapshot(session.id, snapshot);
  }
}

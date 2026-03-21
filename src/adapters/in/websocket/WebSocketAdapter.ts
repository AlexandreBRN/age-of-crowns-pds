import WebSocket from 'ws';
import { IJoinSessionUseCase } from '../../../core/application/ports/in/IJoinSessionUseCase';
import { IMovePlayerUseCase } from '../../../core/application/ports/in/IMovePlayerUseCase';
import { ILeaveSessionUseCase } from '../../../core/application/ports/in/ILeaveSessionUseCase';
import { ISessionRepository } from '../../../core/application/ports/out/ISessionRepository';
import { ClientRegistry } from '../../out/messaging/WebSocketEventPublisher';

export class WebSocketAdapter {
  constructor(
    private readonly joinSessionUseCase: IJoinSessionUseCase,
    private readonly movePlayerUseCase: IMovePlayerUseCase,
    private readonly leaveSessionUseCase: ILeaveSessionUseCase,
    private readonly sessionRepository: ISessionRepository,
    private readonly clientRegistry: ClientRegistry,
  ) {}

  handleConnection(ws: WebSocket): void {
    let playerId: string | null = null;
    let sessionId: string | null = null;

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString());
        const result = this.handleMessage(ws, message, playerId);
        if (result) {
          playerId = result.playerId;
          sessionId = result.sessionId;
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        ws.send(JSON.stringify({ type: 'error', message: errorMessage }));
      }
    });

    ws.on('close', () => {
      if (playerId && sessionId) {
        this.handleDisconnect(ws, playerId, sessionId);
      }
    });
  }

  private handleMessage(
    ws: WebSocket,
    message: Record<string, unknown>,
    currentPlayerId: string | null,
  ): { playerId: string; sessionId: string } | null {
    switch (message.type) {
      case 'join':
        return this.handleJoin(ws, String(message.playerName ?? 'Player'));

      case 'move':
        if (!currentPlayerId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Not joined yet' }));
          return null;
        }
        this.movePlayerUseCase.execute({
          playerId: currentPlayerId,
          direction: message.direction as 'up' | 'down' | 'left' | 'right',
        });
        return null;

      default:
        ws.send(JSON.stringify({ type: 'error', message: `Unknown type: ${message.type}` }));
        return null;
    }
  }

  private handleJoin(ws: WebSocket, playerName: string): { playerId: string; sessionId: string } {
    const result = this.joinSessionUseCase.execute({ playerName });

    if (!this.clientRegistry.has(result.sessionId)) {
      this.clientRegistry.set(result.sessionId, new Set());
    }
    this.clientRegistry.get(result.sessionId)!.add(ws);

    const session = this.sessionRepository.findById(result.sessionId);
    ws.send(
      JSON.stringify({
        type: 'session_state',
        playerId: result.playerId,
        session: session?.toJSON(),
      }),
    );

    return result;
  }

  private handleDisconnect(ws: WebSocket, playerId: string, sessionId: string): void {
    // Remove ws BEFORE publishing so the disconnecting client is skipped
    const clients = this.clientRegistry.get(sessionId);
    if (clients) {
      clients.delete(ws);
    }

    this.leaveSessionUseCase.execute({ playerId });
  }
}

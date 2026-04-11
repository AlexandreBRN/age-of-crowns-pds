import WebSocket from 'ws';
import { IJoinSessionUseCase } from '../../../core/application/ports/in/IJoinSessionUseCase';
import { ILeaveSessionUseCase } from '../../../core/application/ports/in/ILeaveSessionUseCase';
import { IMoveVillagerUseCase } from '../../../core/application/ports/in/IMoveVillagerUseCase';
import { IGatherResourceUseCase } from '../../../core/application/ports/in/IGatherResourceUseCase';
import { ITrainVillagerUseCase } from '../../../core/application/ports/in/ITrainVillagerUseCase';
import { IPlaceBuildingUseCase } from '../../../core/application/ports/in/IPlaceBuildingUseCase';
import { ISessionRepository } from '../../../core/application/ports/out/ISessionRepository';
import { GameLoopService } from '../../../core/application/services/GameLoopService';
import { ClientRegistry, WebSocketEventPublisher } from '../../out/messaging/WebSocketEventPublisher';

export class WebSocketAdapter {
  constructor(
    private readonly joinSessionUseCase: IJoinSessionUseCase,
    private readonly leaveSessionUseCase: ILeaveSessionUseCase,
    private readonly moveVillagerUseCase: IMoveVillagerUseCase,
    private readonly gatherResourceUseCase: IGatherResourceUseCase,
    private readonly trainVillagerUseCase: ITrainVillagerUseCase,
    private readonly placeBuildingUseCase: IPlaceBuildingUseCase,
    private readonly sessionRepository: ISessionRepository,
    private readonly clientRegistry: ClientRegistry,
    private readonly publisher: WebSocketEventPublisher,
    private readonly gameLoopService: GameLoopService,
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
        const msg = err instanceof Error ? err.message : 'Erro desconhecido';
        this.publisher.sendTo(ws, { type: 'error', message: msg });
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
    if (message.type === 'join') {
      return this.handleJoin(ws, String(message.playerName ?? 'Jogador'));
    }

    if (!currentPlayerId) {
      this.publisher.sendTo(ws, { type: 'error', message: 'Entre na sessão primeiro' });
      return null;
    }

    switch (message.type) {
      case 'move_villager':
        this.moveVillagerUseCase.execute({
          playerId: currentPlayerId,
          villagerId: String(message.villagerId),
          destination: message.destination as { x: number; y: number },
        });
        break;

      case 'gather_resource':
        this.gatherResourceUseCase.execute({
          playerId: currentPlayerId,
          villagerId: String(message.villagerId),
          nodeId: String(message.nodeId),
        });
        break;

      case 'train_villager':
        this.trainVillagerUseCase.execute({ playerId: currentPlayerId });
        break;

      case 'place_building':
        this.placeBuildingUseCase.execute({
          playerId: currentPlayerId,
          buildingType: message.buildingType as any,
          x: Number(message.x),
          y: Number(message.y),
        });
        break;

      default:
        this.publisher.sendTo(ws, {
          type: 'error',
          message: `Tipo de mensagem desconhecido: ${message.type}`,
        });
    }

    return null;
  }

  private handleJoin(ws: WebSocket, playerName: string): { playerId: string; sessionId: string } {
    const result = this.joinSessionUseCase.execute({ playerName });

    if (!this.clientRegistry.has(result.sessionId)) {
      this.clientRegistry.set(result.sessionId, new Set());
    }
    this.clientRegistry.get(result.sessionId)!.add(ws);

    const session = this.sessionRepository.findById(result.sessionId);
    const isSecondPlayer = session?.isFull ?? false;

    // Send map tiles + join confirmation
    this.publisher.sendTo(ws, {
      type: 'game_joined',
      playerId: result.playerId,
      sessionId: result.sessionId,
      waitingForOpponent: !isSecondPlayer,
      mapTiles: session?.mapTiles ?? [],
      initialSnapshot: session?.toStateSnapshot() ?? null,
    });

    // Notify other players that someone joined
    const clients = this.clientRegistry.get(result.sessionId);
    clients?.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        this.publisher.sendTo(client, {
          type: 'opponent_joined',
          playerName,
        });
      }
    });

    // Start game loop when 2nd player joins
    if (isSecondPlayer && !this.gameLoopService.isRunning) {
      this.gameLoopService.start();
    }

    return result;
  }

  private handleDisconnect(ws: WebSocket, playerId: string, sessionId: string): void {
    this.gameLoopService.stop();

    const clients = this.clientRegistry.get(sessionId);
    if (clients) {
      clients.delete(ws);
    }

    // Notify remaining clients
    clients?.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        this.publisher.sendTo(client, { type: 'opponent_left' });
      }
    });

    this.leaveSessionUseCase.execute({ playerId });
  }
}

import { HttpServer } from './infrastructure/server/HttpServer';
import { WebSocketServer } from './infrastructure/server/WebSocketServer';
import { InMemorySessionRepository } from './adapters/out/persistence/InMemorySessionRepository';
import { WebSocketEventPublisher, ClientRegistry } from './adapters/out/messaging/WebSocketEventPublisher';
import { WebSocketAdapter } from './adapters/in/websocket/WebSocketAdapter';
import { JoinSessionUseCase } from './core/application/use-cases/JoinSessionUseCase';
import { LeaveSessionUseCase } from './core/application/use-cases/LeaveSessionUseCase';
import { MoveVillagerUseCase } from './core/application/use-cases/MoveVillagerUseCase';
import { GatherResourceUseCase } from './core/application/use-cases/GatherResourceUseCase';
import { TrainVillagerUseCase } from './core/application/use-cases/TrainVillagerUseCase';
import { PlaceBuildingUseCase } from './core/application/use-cases/PlaceBuildingUseCase';
import { GameLoopService } from './core/application/services/GameLoopService';

const PORT = Number(process.env.PORT ?? 4000);

// --- Shared state ---
const clientRegistry: ClientRegistry = new Map();

// --- Output adapters ---
const sessionRepository = new InMemorySessionRepository();
const eventPublisher = new WebSocketEventPublisher(clientRegistry);

// --- Application services ---
const gameLoopService = new GameLoopService(sessionRepository, eventPublisher);

// --- Use cases ---
const joinSessionUseCase = new JoinSessionUseCase(sessionRepository);
const leaveSessionUseCase = new LeaveSessionUseCase(sessionRepository);
const moveVillagerUseCase = new MoveVillagerUseCase(sessionRepository);
const gatherResourceUseCase = new GatherResourceUseCase(sessionRepository);
const trainVillagerUseCase = new TrainVillagerUseCase(sessionRepository);
const placeBuildingUseCase = new PlaceBuildingUseCase(sessionRepository);

// --- Input adapters ---
const wsAdapter = new WebSocketAdapter(
  joinSessionUseCase,
  leaveSessionUseCase,
  moveVillagerUseCase,
  gatherResourceUseCase,
  trainVillagerUseCase,
  placeBuildingUseCase,
  sessionRepository,
  clientRegistry,
  eventPublisher,
  gameLoopService,
);

// --- Infrastructure ---
const httpServer = new HttpServer(PORT);
new WebSocketServer(httpServer.httpServer, wsAdapter);
httpServer.start();

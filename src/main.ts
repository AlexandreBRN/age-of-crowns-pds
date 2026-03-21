import { HttpServer } from './infrastructure/server/HttpServer';
import { WebSocketServer } from './infrastructure/server/WebSocketServer';
import { InMemorySessionRepository } from './adapters/out/persistence/InMemorySessionRepository';
import { WebSocketEventPublisher, ClientRegistry } from './adapters/out/messaging/WebSocketEventPublisher';
import { WebSocketAdapter } from './adapters/in/websocket/WebSocketAdapter';
import { JoinSessionUseCase } from './core/application/use-cases/JoinSessionUseCase';
import { MovePlayerUseCase } from './core/application/use-cases/MovePlayerUseCase';
import { LeaveSessionUseCase } from './core/application/use-cases/LeaveSessionUseCase';

const PORT = Number(process.env.PORT ?? 3000);

// --- Shared state (outbound adapter infrastructure) ---
const clientRegistry: ClientRegistry = new Map();

// --- Output adapters ---
const sessionRepository = new InMemorySessionRepository();
const eventPublisher = new WebSocketEventPublisher(clientRegistry);

// --- Use cases (application core) ---
const joinSessionUseCase = new JoinSessionUseCase(sessionRepository, eventPublisher);
const movePlayerUseCase = new MovePlayerUseCase(sessionRepository, eventPublisher);
const leaveSessionUseCase = new LeaveSessionUseCase(sessionRepository, eventPublisher);

// --- Input adapters ---
const wsAdapter = new WebSocketAdapter(
  joinSessionUseCase,
  movePlayerUseCase,
  leaveSessionUseCase,
  sessionRepository,
  clientRegistry,
);

// --- Infrastructure ---
const httpServer = new HttpServer(PORT);
new WebSocketServer(httpServer.httpServer, wsAdapter);
httpServer.start();

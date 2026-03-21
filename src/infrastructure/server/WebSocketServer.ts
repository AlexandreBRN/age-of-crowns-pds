import { Server } from 'http';
import { WebSocketServer as WsServer } from 'ws';
import { WebSocketAdapter } from '../../adapters/in/websocket/WebSocketAdapter';

export class WebSocketServer {
  private readonly wss: WsServer;

  constructor(server: Server, adapter: WebSocketAdapter) {
    this.wss = new WsServer({ server });
    this.wss.on('connection', (ws) => {
      console.log('Client connected');
      adapter.handleConnection(ws);
    });
    console.log('WebSocket server ready');
  }
}

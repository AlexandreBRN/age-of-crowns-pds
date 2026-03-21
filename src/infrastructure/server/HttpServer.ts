import express from 'express';
import { createServer, Server } from 'http';
import path from 'path';

export class HttpServer {
  private readonly app = express();
  public readonly httpServer: Server;

  constructor(private readonly port: number) {
    this.httpServer = createServer(this.app);
    this.app.use(express.static(path.join(__dirname, '../../../public')));
  }

  start(): void {
    this.httpServer.listen(this.port, () => {
      console.log(`Server running → http://localhost:${this.port}`);
    });
  }
}

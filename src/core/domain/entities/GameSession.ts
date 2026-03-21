import { Player } from './Player';
import { PlayerId } from '../value-objects/PlayerId';
import { Position } from '../value-objects/Position';
import { DomainEvent } from '../events/DomainEvent';
import { PlayerJoined } from '../events/PlayerJoined';
import { PlayerMoved } from '../events/PlayerMoved';
import { PlayerLeft } from '../events/PlayerLeft';

const MAX_PLAYERS = 2;

type Direction = { dx: number; dy: number };

const DIRECTIONS: Record<string, Direction> = {
  up:    { dx:  0, dy: -1 },
  down:  { dx:  0, dy:  1 },
  left:  { dx: -1, dy:  0 },
  right: { dx:  1, dy:  0 },
};

export class GameSession {
  private readonly _players: Map<string, Player> = new Map();
  private _domainEvents: DomainEvent[] = [];

  constructor(
    private readonly _id: string,
    public readonly mapWidth: number = 20,
    public readonly mapHeight: number = 15,
  ) {}

  get id(): string {
    return this._id;
  }

  get players(): Player[] {
    return Array.from(this._players.values());
  }

  get isFull(): boolean {
    return this._players.size >= MAX_PLAYERS;
  }

  addPlayer(player: Player): void {
    if (this.isFull) {
      throw new Error('Session is full');
    }
    this._players.set(player.id.value, player);
    this._domainEvents.push(new PlayerJoined(player));
  }

  removePlayer(playerId: PlayerId): void {
    if (!this._players.has(playerId.value)) return;
    this._players.delete(playerId.value);
    this._domainEvents.push(new PlayerLeft(playerId));
  }

  movePlayer(playerId: PlayerId, directionKey: string): void {
    const player = this._players.get(playerId.value);
    if (!player) throw new Error(`Player ${playerId.value} not found`);

    const dir = DIRECTIONS[directionKey];
    if (!dir) throw new Error(`Invalid direction: ${directionKey}`);

    const newPosition = player.position.move(dir.dx, dir.dy, this.mapWidth, this.mapHeight);
    player.moveTo(newPosition);
    this._domainEvents.push(new PlayerMoved(playerId, newPosition));
  }

  pullEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents = [];
    return events;
  }

  getSpawnPosition(): Position {
    const occupied = new Set(this.players.map((p) => `${p.position.x},${p.position.y}`));
    const candidates = [
      new Position(1, 1),
      new Position(this.mapWidth - 2, this.mapHeight - 2),
    ];
    for (const pos of candidates) {
      if (!occupied.has(`${pos.x},${pos.y}`)) return pos;
    }
    return new Position(0, 0);
  }

  toJSON() {
    return {
      id: this._id,
      mapWidth: this.mapWidth,
      mapHeight: this.mapHeight,
      players: this.players.map((p) => p.toJSON()),
    };
  }
}

export class Position {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}

  move(dx: number, dy: number, mapWidth: number, mapHeight: number): Position {
    const newX = Math.max(0, Math.min(mapWidth - 1, this.x + dx));
    const newY = Math.max(0, Math.min(mapHeight - 1, this.y + dy));
    return new Position(newX, newY);
  }

  equals(other: Position): boolean {
    return this.x === other.x && this.y === other.y;
  }

  toJSON() {
    return { x: this.x, y: this.y };
  }
}

const TRAIN_COST_TICKS = 20; // 5 seconds at 250ms/tick

export class TownCenter {
  private _trainTicksRemaining = 0;

  constructor(
    private readonly _id: string,
    private readonly _ownerId: string,
    private readonly _anchorX: number,
    private readonly _anchorY: number,
  ) {}

  get id(): string { return this._id; }
  get ownerId(): string { return this._ownerId; }
  get anchorX(): number { return this._anchorX; }
  get anchorY(): number { return this._anchorY; }
  get isTraining(): boolean { return this._trainTicksRemaining > 0; }
  get trainTicksRemaining(): number { return this._trainTicksRemaining; }

  /** Returns occupied tile positions (3x3 grid). */
  get occupiedTiles(): { x: number; y: number }[] {
    const tiles: { x: number; y: number }[] = [];
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        tiles.push({ x: this._anchorX + dx, y: this._anchorY + dy });
      }
    }
    return tiles;
  }

  startTraining(): void {
    if (this._trainTicksRemaining > 0) {
      throw new Error('Centro de cidade já está treinando um aldeão');
    }
    this._trainTicksRemaining = TRAIN_COST_TICKS;
  }

  /** Returns true when training completes this tick. */
  tickTraining(): boolean {
    if (this._trainTicksRemaining <= 0) return false;
    this._trainTicksRemaining--;
    return this._trainTicksRemaining === 0;
  }

  toJSON() {
    return {
      id: this._id,
      ownerId: this._ownerId,
      anchorPosition: { x: this._anchorX, y: this._anchorY },
      isTraining: this.isTraining,
      trainTicksRemaining: this._trainTicksRemaining,
    };
  }
}

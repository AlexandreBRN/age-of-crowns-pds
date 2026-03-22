import { VillagerId } from '../value-objects/VillagerId';

export type VillagerState = 'idle' | 'moving' | 'gathering';

export class Villager {
  private _x: number;
  private _y: number;
  private _state: VillagerState = 'idle';
  private _moveTargetX: number | null = null;
  private _moveTargetY: number | null = null;
  private _gatherTargetId: string | null = null;
  private _gatherTargetX: number | null = null;
  private _gatherTargetY: number | null = null;
  private _gatherTickCounter = 0;

  constructor(
    private readonly _id: VillagerId,
    private readonly _ownerId: string,
    startX: number,
    startY: number,
  ) {
    this._x = startX;
    this._y = startY;
  }

  get id(): VillagerId { return this._id; }
  get ownerId(): string { return this._ownerId; }
  get x(): number { return this._x; }
  get y(): number { return this._y; }
  get state(): VillagerState { return this._state; }
  get moveTargetX(): number | null { return this._moveTargetX; }
  get moveTargetY(): number | null { return this._moveTargetY; }
  get gatherTargetId(): string | null { return this._gatherTargetId; }
  get gatherTickCounter(): number { return this._gatherTickCounter; }

  commandMove(destX: number, destY: number): void {
    this._moveTargetX = destX;
    this._moveTargetY = destY;
    this._gatherTargetId = null;
    this._gatherTargetX = null;
    this._gatherTargetY = null;
    this._gatherTickCounter = 0;
    this._state = 'moving';
  }

  commandGather(nodeId: string, nodeX: number, nodeY: number): void {
    this._gatherTargetId = nodeId;
    this._gatherTargetX = nodeX;
    this._gatherTargetY = nodeY;
    this._moveTargetX = nodeX;
    this._moveTargetY = nodeY;
    this._gatherTickCounter = 0;
    this._state = 'moving';
  }

  commandIdle(): void {
    this._state = 'idle';
    this._moveTargetX = null;
    this._moveTargetY = null;
    this._gatherTargetId = null;
    this._gatherTargetX = null;
    this._gatherTargetY = null;
    this._gatherTickCounter = 0;
  }

  /** Moves one tile toward current target. Returns true if position changed. */
  stepTowardTarget(): boolean {
    if (this._moveTargetX === null || this._moveTargetY === null) return false;

    if (this._x === this._moveTargetX && this._y === this._moveTargetY) {
      // Arrived at destination
      if (this._gatherTargetId !== null) {
        this._state = 'gathering';
        this._moveTargetX = null;
        this._moveTargetY = null;
      } else {
        this._state = 'idle';
        this._moveTargetX = null;
        this._moveTargetY = null;
      }
      return false;
    }

    const dx = Math.sign(this._moveTargetX - this._x);
    const dy = Math.sign(this._moveTargetY - this._y);

    if (dx !== 0) {
      this._x += dx;
    } else if (dy !== 0) {
      this._y += dy;
    }

    return true;
  }

  incrementGatherCounter(): void {
    this._gatherTickCounter++;
  }

  resetGatherCounter(): void {
    this._gatherTickCounter = 0;
  }

  setIdle(): void {
    this._state = 'idle';
    this._gatherTargetId = null;
    this._gatherTargetX = null;
    this._gatherTargetY = null;
    this._moveTargetX = null;
    this._moveTargetY = null;
  }

  toJSON() {
    const moveTarget =
      this._moveTargetX !== null && this._moveTargetY !== null
        ? { x: this._moveTargetX, y: this._moveTargetY }
        : null;
    return {
      id: this._id.value,
      ownerId: this._ownerId,
      position: { x: this._x, y: this._y },
      state: this._state,
      moveTarget,
      gatherTarget: this._gatherTargetId,
    };
  }
}

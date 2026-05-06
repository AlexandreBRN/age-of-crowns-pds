import { UnitType } from './Villager';

const TOWN_CENTER_MAX_HP = 500;

export class TownCenter {
  private _trainTicksRemaining = 0;
  private _trainingUnitType: UnitType | null = null;
  private _hp = TOWN_CENTER_MAX_HP;

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
  get trainingUnitType(): UnitType | null { return this._trainingUnitType; }
  get hp(): number { return this._hp; }
  get maxHp(): number { return TOWN_CENTER_MAX_HP; }
  get isDestroyed(): boolean { return this._hp <= 0; }

  get occupiedTiles(): { x: number; y: number }[] {
    const tiles: { x: number; y: number }[] = [];
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        tiles.push({ x: this._anchorX + dx, y: this._anchorY + dy });
      }
    }
    return tiles;
  }

  startTraining(unitType: UnitType, ticks: number): void {
    if (this._trainTicksRemaining > 0) {
      throw new Error('Centro de cidade já está treinando uma unidade');
    }
    this._trainingUnitType = unitType;
    this._trainTicksRemaining = ticks;
  }

  /** Returns true when training completes this tick. */
  tickTraining(): boolean {
    if (this._trainTicksRemaining <= 0) return false;
    this._trainTicksRemaining--;
    if (this._trainTicksRemaining === 0) {
      return true;
    }
    return false;
  }

  takeDamage(amount: number): void {
    this._hp = Math.max(0, this._hp - amount);
  }

  toJSON() {
    return {
      id: this._id,
      ownerId: this._ownerId,
      anchorPosition: { x: this._anchorX, y: this._anchorY },
      isTraining: this.isTraining,
      trainTicksRemaining: this._trainTicksRemaining,
      trainingUnitType: this._trainingUnitType,
      hp: this._hp,
      maxHp: TOWN_CENTER_MAX_HP,
    };
  }
}

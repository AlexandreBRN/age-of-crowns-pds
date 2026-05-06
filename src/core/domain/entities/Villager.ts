import { VillagerId } from '../value-objects/VillagerId';

export type UnitType = 'villager' | 'archer' | 'cavalry';
export type AttackTargetKind = 'unit' | 'building' | 'town_center';

export interface UnitConfig {
  label: string;
  maxHp: number;
  attackDamage: number;   // 0 = cannot attack
  attackRange: number;    // Chebyshev tiles; 0 = cannot attack
  attackCooldownTicks: number;
  moveSpeedTiles: number; // steps per tick
  trainCost: Record<string, number>;
  trainTicks: number;
}

export const UNIT_CONFIGS: Record<UnitType, UnitConfig> = {
  villager: {
    label: 'Aldeão',
    maxHp: 50,
    attackDamage: 0,
    attackRange: 0,
    attackCooldownTicks: 0,
    moveSpeedTiles: 1,
    trainCost: { food: 50 },
    trainTicks: 20,
  },
  archer: {
    label: 'Arqueiro',
    maxHp: 40,
    attackDamage: 8,
    attackRange: 5,
    attackCooldownTicks: 4,  // 1 attack/sec
    moveSpeedTiles: 1,
    trainCost: { food: 50, wood: 30 },
    trainTicks: 24,
  },
  cavalry: {
    label: 'Cavaleiro',
    maxHp: 80,
    attackDamage: 15,
    attackRange: 1,
    attackCooldownTicks: 3,  // ~1.3 attacks/sec
    moveSpeedTiles: 2,        // 2 tiles/tick
    trainCost: { food: 80, gold: 50 },
    trainTicks: 40,
  },
};

export type VillagerState = 'idle' | 'moving' | 'gathering' | 'constructing' | 'attacking';

export class Villager {
  private _x: number;
  private _y: number;
  private _hp: number;
  private _state: VillagerState = 'idle';
  private _moveTargetX: number | null = null;
  private _moveTargetY: number | null = null;
  private _gatherTargetId: string | null = null;
  private _gatherTargetX: number | null = null;
  private _gatherTargetY: number | null = null;
  private _gatherTickCounter = 0;
  private _constructTargetId: string | null = null;
  private _attackTargetId: string | null = null;
  private _attackTargetKind: AttackTargetKind | null = null;
  private _attackTickCounter = 0;

  constructor(
    private readonly _id: VillagerId,
    private readonly _ownerId: string,
    startX: number,
    startY: number,
    private readonly _unitType: UnitType = 'villager',
  ) {
    this._x = startX;
    this._y = startY;
    this._hp = UNIT_CONFIGS[_unitType].maxHp;
  }

  get id(): VillagerId { return this._id; }
  get ownerId(): string { return this._ownerId; }
  get x(): number { return this._x; }
  get y(): number { return this._y; }
  get hp(): number { return this._hp; }
  get maxHp(): number { return UNIT_CONFIGS[this._unitType].maxHp; }
  get state(): VillagerState { return this._state; }
  get unitType(): UnitType { return this._unitType; }
  get config(): UnitConfig { return UNIT_CONFIGS[this._unitType]; }
  get isDead(): boolean { return this._hp <= 0; }
  get moveTargetX(): number | null { return this._moveTargetX; }
  get moveTargetY(): number | null { return this._moveTargetY; }
  get gatherTargetId(): string | null { return this._gatherTargetId; }
  get constructTargetId(): string | null { return this._constructTargetId; }
  get attackTargetId(): string | null { return this._attackTargetId; }
  get attackTargetKind(): AttackTargetKind | null { return this._attackTargetKind; }
  get attackTickCounter(): number { return this._attackTickCounter; }
  get gatherTickCounter(): number { return this._gatherTickCounter; }

  commandMove(destX: number, destY: number): void {
    this._moveTargetX = destX;
    this._moveTargetY = destY;
    this._gatherTargetId = null;
    this._gatherTargetX = null;
    this._gatherTargetY = null;
    this._constructTargetId = null;
    this._attackTargetId = null;
    this._attackTargetKind = null;
    this._gatherTickCounter = 0;
    this._state = 'moving';
  }

  commandGather(nodeId: string, nodeX: number, nodeY: number): void {
    this._gatherTargetId = nodeId;
    this._gatherTargetX = nodeX;
    this._gatherTargetY = nodeY;
    this._moveTargetX = nodeX;
    this._moveTargetY = nodeY;
    this._constructTargetId = null;
    this._attackTargetId = null;
    this._attackTargetKind = null;
    this._gatherTickCounter = 0;
    this._state = 'moving';
  }

  commandConstruct(buildingId: string, destX: number, destY: number): void {
    this._constructTargetId = buildingId;
    this._moveTargetX = destX;
    this._moveTargetY = destY;
    this._gatherTargetId = null;
    this._gatherTargetX = null;
    this._gatherTargetY = null;
    this._attackTargetId = null;
    this._attackTargetKind = null;
    this._gatherTickCounter = 0;
    this._state = 'moving';
  }

  commandAttack(targetId: string, targetKind: AttackTargetKind): void {
    if (this.config.attackDamage === 0) return; // villagers cannot attack
    this._attackTargetId = targetId;
    this._attackTargetKind = targetKind;
    this._gatherTargetId = null;
    this._constructTargetId = null;
    this._moveTargetX = null;
    this._moveTargetY = null;
    this._attackTickCounter = 0;
    this._state = 'attacking';
  }

  commandIdle(): void {
    this._state = 'idle';
    this._moveTargetX = null;
    this._moveTargetY = null;
    this._gatherTargetId = null;
    this._gatherTargetX = null;
    this._gatherTargetY = null;
    this._constructTargetId = null;
    this._attackTargetId = null;
    this._attackTargetKind = null;
    this._gatherTickCounter = 0;
    this._attackTickCounter = 0;
  }

  takeDamage(amount: number): void {
    this._hp = Math.max(0, this._hp - amount);
  }

  incrementGatherCounter(): void { this._gatherTickCounter++; }
  resetGatherCounter(): void { this._gatherTickCounter = 0; }
  incrementAttackCounter(): void { this._attackTickCounter++; }
  resetAttackCounter(): void { this._attackTickCounter = 0; }

  /** Move by (dx, dy) directly — used during attack-move approach. */
  nudge(dx: number, dy: number): void {
    this._x += dx;
    this._y += dy;
  }

  /**
   * Moves one tile toward current move target, respecting blocked tiles.
   * Returns true if position changed.
   */
  stepTowardTarget(isBlocked?: (x: number, y: number) => boolean): boolean {
    if (this._moveTargetX === null || this._moveTargetY === null) return false;

    if (this._x === this._moveTargetX && this._y === this._moveTargetY) {
      if (this._constructTargetId !== null) {
        this._state = 'constructing';
        this._moveTargetX = null;
        this._moveTargetY = null;
      } else if (this._gatherTargetId !== null) {
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
    const blocked = isBlocked ?? (() => false);

    if (dx !== 0 && !blocked(this._x + dx, this._y)) {
      this._x += dx;
      return true;
    }
    if (dy !== 0 && !blocked(this._x, this._y + dy)) {
      this._y += dy;
      return true;
    }
    return false;
  }

  setIdle(): void {
    this._state = 'idle';
    this._gatherTargetId = null;
    this._gatherTargetX = null;
    this._gatherTargetY = null;
    this._moveTargetX = null;
    this._moveTargetY = null;
    this._constructTargetId = null;
    this._attackTargetId = null;
    this._attackTargetKind = null;
    this._attackTickCounter = 0;
  }

  toJSON() {
    const moveTarget =
      this._moveTargetX !== null && this._moveTargetY !== null
        ? { x: this._moveTargetX, y: this._moveTargetY }
        : null;
    return {
      id: this._id.value,
      ownerId: this._ownerId,
      unitType: this._unitType,
      position: { x: this._x, y: this._y },
      hp: this._hp,
      maxHp: UNIT_CONFIGS[this._unitType].maxHp,
      state: this._state,
      moveTarget,
      gatherTarget: this._gatherTargetId,
      constructTarget: this._constructTargetId,
      attackTargetId: this._attackTargetId,
      attackTargetKind: this._attackTargetKind,
    };
  }
}

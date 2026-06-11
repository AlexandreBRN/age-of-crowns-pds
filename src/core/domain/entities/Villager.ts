import { VillagerId } from '../value-objects/VillagerId';
import { findPath, PathTile } from '../services/Pathfinder';

export type UnitType = 'villager' | 'archer' | 'cavalry';
export type AttackTargetKind = 'unit' | 'building' | 'town_center';

export interface UnitConfig {
  label: string;
  maxHp: number;
  attackDamage: number;   // 0 = cannot attack
  attackRange: number;    // Chebyshev tiles; 0 = cannot attack
  attackCooldownTicks: number;
  moveSpeedTiles: number; // tiles per tick (may be fractional, e.g. 0.5 = half a tile per tick)
  trainCost: Record<string, number>;
  trainTicks: number;
}

// Distância (em tiles, Chebyshev) que o Cavaleiro precisa estar do alvo para
// atacar em combate corpo a corpo. Fora desse alcance ele interrompe a animação
// de ataque e continua se aproximando. Ajuste aqui para mudar o alcance no futuro.
export const CAVALRY_ATTACK_RANGE = 1;

export const UNIT_CONFIGS: Record<UnitType, UnitConfig> = {
  villager: {
    label: 'Aldeão',
    maxHp: 50,
    attackDamage: 4,             // small — lets villagers defend / test attacks
    attackRange: 1,
    attackCooldownTicks: 4,      // 1 attack/sec
    moveSpeedTiles: 0.20,        // 0.25 tile/tick = 1 tile/sec at 4 ticks/sec
    trainCost: { food: 50 },
    trainTicks: 20,
  },
  archer: {
    label: 'Arqueiro',
    maxHp: 40,
    attackDamage: 8,
    attackRange: 5,
    attackCooldownTicks: 4,  // 1 attack/sec
    moveSpeedTiles: 0.25,
    trainCost: { food: 50, wood: 30 },
    trainTicks: 24,
  },
  cavalry: {
    label: 'Cavaleiro',
    maxHp: 80,
    attackDamage: 15,
    attackRange: CAVALRY_ATTACK_RANGE,
    attackCooldownTicks: 3,  // ~1.3 attacks/sec
    moveSpeedTiles: 0.40,     // ~1.6 tiles/sec — 2× villager, faster than archer
    trainCost: { food: 80, gold: 50 },
    trainTicks: 40,
  },
};

export type VillagerState = 'idle' | 'moving' | 'gathering' | 'constructing' | 'attacking' | 'dying';

// Ticks a unit lingers in 'dying' state before being cleaned up — gives the
// client time to play the death animation before the unit disappears.
// 12 * 250ms = 3.0s (covers the longer "dead" anim: 46 frames @ 17fps ≈ 2.7s).
export const DYING_LINGER_TICKS = 12;

export class Villager {
  private _x: number;
  private _y: number;
  private _hp: number;
  private _state: VillagerState = 'idle';
  private _moveTargetX: number | null = null;
  private _moveTargetY: number | null = null;
  private _path: PathTile[] = [];
  private _gatherTargetId: string | null = null;
  private _gatherTargetX: number | null = null;
  private _gatherTargetY: number | null = null;
  private _gatherTickCounter = 0;
  private _constructTargetId: string | null = null;
  private _attackTargetId: string | null = null;
  private _attackTargetKind: AttackTargetKind | null = null;
  private _attackTickCounter = 0;
  private _attackInRange = false; // true só quando o alvo está dentro do alcance de ataque
  private _dyingTickCounter = 0; // ticks spent in 'dying' state after hp <= 0

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
  get isDying(): boolean { return this._state === 'dying'; }
  get shouldBeRemoved(): boolean { return this._state === 'dying' && this._dyingTickCounter >= DYING_LINGER_TICKS; }
  get dyingTickCounter(): number { return this._dyingTickCounter; }
  get moveTargetX(): number | null { return this._moveTargetX; }
  get moveTargetY(): number | null { return this._moveTargetY; }
  get gatherTargetId(): string | null { return this._gatherTargetId; }
  get constructTargetId(): string | null { return this._constructTargetId; }
  get attackTargetId(): string | null { return this._attackTargetId; }
  get attackTargetKind(): AttackTargetKind | null { return this._attackTargetKind; }
  get attackTickCounter(): number { return this._attackTickCounter; }
  get gatherTickCounter(): number { return this._gatherTickCounter; }
  get attackInRange(): boolean { return this._attackInRange; }

  /** Atualizado a cada tick pela fase de combate: alvo dentro do alcance? */
  setAttackInRange(inRange: boolean): void { this._attackInRange = inRange; }

  commandMove(destX: number, destY: number): void {
    this._moveTargetX = destX;
    this._moveTargetY = destY;
    this._path = [];
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
    this._path = [];
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
    this._path = [];
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
    this._path = [];
    this._attackTickCounter = 0;
    this._attackInRange = false; // começa se aproximando até a fase de combate confirmar alcance
    this._state = 'attacking';
  }

  commandIdle(): void {
    this._state = 'idle';
    this._moveTargetX = null;
    this._moveTargetY = null;
    this._path = [];
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

  /** Transition into the 'dying' state — drops all targets, freezes movement. */
  enterDying(): void {
    this._state = 'dying';
    this._dyingTickCounter = 0;
    this._moveTargetX = null;
    this._moveTargetY = null;
    this._path = [];
    this._gatherTargetId = null;
    this._gatherTargetX = null;
    this._gatherTargetY = null;
    this._constructTargetId = null;
    this._attackTargetId = null;
    this._attackTargetKind = null;
  }

  tickDying(): void { this._dyingTickCounter++; }

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
   * Advances along an A*-computed path by `config.moveSpeedTiles` tiles
   * (may be fractional — supports speeds like 0.5 tile/tick for smooth movement).
   * Supports 8-directional movement with corner-cutting prevention.
   * Returns true if position changed.
   */
  stepTowardTarget(isBlocked?: (x: number, y: number) => boolean): boolean {
    if (this._moveTargetX === null || this._moveTargetY === null) return false;

    const EPS = 1e-4;
    const atTarget = Math.abs(this._x - this._moveTargetX) < EPS
                  && Math.abs(this._y - this._moveTargetY) < EPS;
    if (atTarget) {
      this._x = this._moveTargetX;
      this._y = this._moveTargetY;
      this._path = [];
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

    const blocked = isBlocked ?? (() => false);

    if (this._path.length === 0) {
      const startX = Math.round(this._x);
      const startY = Math.round(this._y);
      this._path = findPath(startX, startY, this._moveTargetX, this._moveTargetY, blocked);
      if (this._path.length === 0) return false;
      // If recompute happened mid-tile, prepend the tile center as a snap waypoint so
      // the first sub-step is purely orthogonal (one of the 8 directions).
      if (Math.abs(this._x - startX) > EPS || Math.abs(this._y - startY) > EPS) {
        this._path.unshift({ x: startX, y: startY });
      }
    }

    // Advance along the path. Carry the unused fraction of `speed` over to the
    // next path waypoint ONLY when both segments share the same 8-dir direction
    // — that keeps movement smooth along straight runs (no stutter at the end
    // of diagonal tiles) while still preventing two different direction vectors
    // from being mixed inside the same tick (which would break the
    // axis-aligned animation guarantee at corners).
    const speed = this.config.moveSpeedTiles;
    let remaining = speed;
    let moved = false;
    let lastSegDx: number | null = null;
    let lastSegDy: number | null = null;
    while (remaining > EPS && this._path.length > 0) {
      const next = this._path[0];
      const dx = next.x - this._x;
      const dy = next.y - this._y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= EPS) { this._path.shift(); continue; }
      const segDx = Math.abs(dx) < EPS ? 0 : (dx > 0 ? 1 : -1);
      const segDy = Math.abs(dy) < EPS ? 0 : (dy > 0 ? 1 : -1);
      if (lastSegDx !== null && (segDx !== lastSegDx || segDy !== lastSegDy)) {
        // Direction changes between segments — stop here, drop carry-over.
        break;
      }
      lastSegDx = segDx;
      lastSegDy = segDy;
      if (blocked(next.x, next.y)) {
        this._path = [];
        return moved;
      }
      // Corner-cutting check: only valid when we're exactly at a tile center
      // (start of a segment). Mid-segment positions round to the wrong tile and
      // would check unrelated neighbors — A* already validated the corner at
      // segment start, so re-checking from a fractional position is bogus.
      const atTileCenter = Math.abs(this._x - Math.round(this._x)) < EPS
                        && Math.abs(this._y - Math.round(this._y)) < EPS;
      if (segDx !== 0 && segDy !== 0 && atTileCenter) {
        const cx = Math.round(this._x), cy = Math.round(this._y);
        if (blocked(cx + segDx, cy) || blocked(cx, cy + segDy)) {
          this._path = [];
          return moved;
        }
      }
      if (dist <= remaining) {
        this._x = next.x;
        this._y = next.y;
        this._path.shift();
        remaining -= dist;
      } else {
        this._x += (dx / dist) * remaining;
        this._y += (dy / dist) * remaining;
        remaining = 0;
      }
      moved = true;
    }
    return moved;
  }

  setIdle(): void {
    this._state = 'idle';
    this._gatherTargetId = null;
    this._gatherTargetX = null;
    this._gatherTargetY = null;
    this._moveTargetX = null;
    this._moveTargetY = null;
    this._path = [];
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
      position: { x: Math.round(this._x), y: Math.round(this._y) },
      subPosition: { x: this._x, y: this._y },
      hp: this._hp,
      maxHp: UNIT_CONFIGS[this._unitType].maxHp,
      state: this._state,
      moveTarget,
      gatherTarget: this._gatherTargetId,
      constructTarget: this._constructTargetId,
      attackTargetId: this._attackTargetId,
      attackTargetKind: this._attackTargetKind,
      attackInRange: this._attackInRange,
      dyingTicks: this._dyingTickCounter,
    };
  }
}

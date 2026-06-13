export type PlayerBuildingType =
  | 'wall'
  | 'gate'
  | 'watchtower'
  | 'lumber_camp'
  | 'gold_mine'
  | 'farm'
  | 'stone_quarry';

export type BuildingStatus = 'under_construction' | 'complete';

export interface BuildingCost {
  gold?: number;
  wood?: number;
  stone?: number;
  food?: number;
}

export interface BuildingConfig {
  label: string;
  description: string;
  width: number;
  height: number;
  cost: BuildingCost;
  constructionTicks: number;
  maxHp: number;
  generates?: BuildingCost;
  visionRadius?: number;
  blocksMovement: boolean;
}

// Quanto tempo (em ticks) cada segmento de muro leva para ser construído após o
// aldeão iniciar. 8 ticks = ~2 segundos (loop a 250ms) — dá tempo de ver a
// animação de martelar. Ajuste aqui para alterar a velocidade de construção.
export const TICKS_PER_WALL_SEGMENT = 8;

export const BUILDING_CONFIGS: Record<PlayerBuildingType, BuildingConfig> = {
  wall: {
    label: 'Muro',
    description: 'Bloqueia a passagem de unidades inimigas.',
    width: 1, height: 1,
    cost: { stone: 2 },
    constructionTicks: TICKS_PER_WALL_SEGMENT, // cada segmento leva 1s e é construído sozinho
    maxHp: 150,
    blocksMovement: true,
  },
  gate: {
    label: 'Portão',
    description: 'Passagem na muralha: suas tropas atravessam, inimigos não.',
    width: 1, height: 1,
    cost: { wood: 10, stone: 5 },
    constructionTicks: 8,
    maxHp: 200,
    blocksMovement: true,
  },
  watchtower: {
    label: 'Torre de Vigia',
    description: 'Revela uma grande área do mapa constantemente.',
    width: 1, height: 1,
    cost: { stone: 20, wood: 10 },
    constructionTicks: 24,
    maxHp: 300,
    visionRadius: 8,
    blocksMovement: true,
  },
  lumber_camp: {
    label: 'Serraria',
    description: 'Gera +8 madeira a cada 2 segundos automaticamente.',
    width: 2, height: 2,
    cost: { wood: 30, stone: 5 },
    constructionTicks: 20,
    maxHp: 200,
    generates: { wood: 8 },
    blocksMovement: true,
  },
  gold_mine: {
    label: 'Mina de Ouro',
    description: 'Gera +5 ouro a cada 2 segundos automaticamente.',
    width: 2, height: 2,
    cost: { stone: 40, wood: 20 },
    constructionTicks: 28,
    maxHp: 200,
    generates: { gold: 5 },
    blocksMovement: true,
  },
  farm: {
    label: 'Fazenda',
    description: 'Gera +8 comida a cada 2 segundos automaticamente.',
    width: 2, height: 2,
    cost: { wood: 25 },
    constructionTicks: 16,
    maxHp: 150,
    generates: { food: 8 },
    blocksMovement: true,
  },
  stone_quarry: {
    label: 'Pedreira',
    description: 'Gera +4 pedra a cada 2 segundos automaticamente.',
    width: 2, height: 2,
    cost: { wood: 30, stone: 10 },
    constructionTicks: 20,
    maxHp: 200,
    generates: { stone: 4 },
    blocksMovement: true,
  },
};

export class PlayerBuilding {
  private _status: BuildingStatus;
  private _constructionTicksRemaining: number;
  private readonly _constructionTotalTicks: number;
  private _hp: number;
  private readonly _maxHp: number;
  // Footprint explícito em tiles. Usado por muros, que são uma única construção
  // contínua cobrindo vários tiles em linha. null = construção retangular normal.
  private readonly _cells: { x: number; y: number }[] | null;

  constructor(
    private readonly _id: string,
    private readonly _ownerId: string,
    private readonly _type: PlayerBuildingType,
    private readonly _x: number,
    private readonly _y: number,
    hpMultiplier = 1.0,
    cells?: { x: number; y: number }[],
  ) {
    const cfg = BUILDING_CONFIGS[_type];
    this._cells = cells && cells.length > 0 ? cells.map(c => ({ x: c.x, y: c.y })) : null;
    const segments = this._cells ? this._cells.length : 1;
    // Footprint contínuo (muro): cada segmento leva TICKS_PER_WALL_SEGMENT; o tempo
    // total é a soma. HP também escala por segmento.
    const totalTicks = this._cells ? segments * TICKS_PER_WALL_SEGMENT : cfg.constructionTicks;
    this._constructionTotalTicks = totalTicks;
    this._constructionTicksRemaining = totalTicks;
    this._status = 'under_construction';
    this._maxHp = Math.floor(cfg.maxHp * hpMultiplier) * segments;
    this._hp = this._maxHp;
  }

  get id(): string { return this._id; }
  get ownerId(): string { return this._ownerId; }
  get type(): PlayerBuildingType { return this._type; }
  get x(): number { return this._x; }
  get y(): number { return this._y; }
  get status(): BuildingStatus { return this._status; }
  get isComplete(): boolean { return this._status === 'complete'; }
  get isDestroyed(): boolean { return this._hp <= 0; }
  get constructionTicksRemaining(): number { return this._constructionTicksRemaining; }
  get constructionTotalTicks(): number { return this._constructionTotalTicks; }
  get config(): BuildingConfig { return BUILDING_CONFIGS[this._type]; }
  get width(): number { return this.config.width; }
  get height(): number { return this.config.height; }
  get hp(): number { return this._hp; }
  get maxHp(): number { return this._maxHp; }

  takeDamage(amount: number): void {
    this._hp = Math.max(0, this._hp - amount);
  }

  /** Conclui a construção imediatamente — usado ao dividir uma muralha em segmentos. */
  markComplete(): void {
    this._constructionTicksRemaining = 0;
    this._status = 'complete';
  }

  /** Decrement construction counter. Returns true when construction just completed. */
  tickConstruction(): boolean {
    if (this._status === 'complete') return false;
    this._constructionTicksRemaining--;
    if (this._constructionTicksRemaining <= 0) {
      this._constructionTicksRemaining = 0;
      this._status = 'complete';
      return true;
    }
    return false;
  }

  get occupiedTiles(): { x: number; y: number }[] {
    if (this._cells) return this._cells.map(c => ({ x: c.x, y: c.y }));
    const tiles: { x: number; y: number }[] = [];
    for (let dy = 0; dy < this.height; dy++) {
      for (let dx = 0; dx < this.width; dx++) {
        tiles.push({ x: this._x + dx, y: this._y + dy });
      }
    }
    return tiles;
  }

  toJSON() {
    return {
      id: this._id,
      ownerId: this._ownerId,
      type: this._type,
      x: this._x,
      y: this._y,
      width: this.width,
      height: this.height,
      status: this._status,
      constructionTicksRemaining: this._constructionTicksRemaining,
      constructionTotalTicks: this._constructionTotalTicks,
      hp: this._hp,
      maxHp: this._cells ? this._maxHp : this.config.maxHp,
      ...(this._cells ? { cells: this._cells.map(c => ({ x: c.x, y: c.y })) } : {}),
    };
  }
}

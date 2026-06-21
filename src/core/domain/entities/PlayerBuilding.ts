export type PlayerBuildingType =
  | 'wall'
  | 'gate'
  | 'watchtower'
  | 'house'
  | 'mill'
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
  occupantCapacity?: number;   // vagas de trabalhadores (construções de produção)
  populationBonus?: number;    // quanto a Casa aumenta o limite de população (+X)
  visionRadius?: number;
  blocksMovement: boolean;
}

// Quanto cada Casa adiciona ao limite máximo de população (configurável).
export const POPULATION_PER_HOUSE = 5;

// Capacidade padrão de trabalhadores das construções de produção (mín. recomendado).
export const PRODUCTION_OCCUPANT_CAPACITY = 3;
// A produção começa cheia e fica cada vez mais difícil a cada ciclo, com um piso.
// Avançar de era reseta a escala para o máximo (volta a render bastante).
// Decaimento suave (~0.985/ciclo de 2s): leva uns minutos para chegar ao piso,
// então a construção gera recurso por bastante tempo antes de cair de rendimento.
const PRODUCTION_SCALE_MAX = 1.0;
const PRODUCTION_SCALE_DECAY = 0.985;
const PRODUCTION_SCALE_FLOOR = 0.30;

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
  house: {
    label: 'Casa',
    description: 'Aumenta o limite máximo de população.',
    width: 2, height: 2,
    cost: { wood: 25 },
    constructionTicks: 12,
    maxHp: 150,
    populationBonus: POPULATION_PER_HOUSE,
    blocksMovement: true,
  },
  mill: {
    label: 'Moinho',
    description: 'Centro agrícola — permite até 8 Fazendas, uma em cada espaço ao redor.',
    width: 2, height: 2,        // mesmo tamanho da Fazenda (4 tiles)
    cost: { wood: 25 },
    constructionTicks: 12,
    maxHp: 180,
    blocksMovement: true,
  },
  lumber_camp: {
    label: 'Serraria',
    description: 'Gera madeira enquanto houver aldeões trabalhando dentro.',
    width: 2, height: 2,
    cost: { wood: 30, stone: 5 },
    constructionTicks: 20,
    maxHp: 200,
    generates: { wood: 8 },
    occupantCapacity: PRODUCTION_OCCUPANT_CAPACITY,
    blocksMovement: true,
  },
  gold_mine: {
    label: 'Mina de Ouro',
    description: 'Gera ouro enquanto houver aldeões trabalhando dentro.',
    width: 2, height: 2,
    cost: { stone: 40, wood: 20 },
    constructionTicks: 28,
    maxHp: 200,
    generates: { gold: 5 },
    occupantCapacity: PRODUCTION_OCCUPANT_CAPACITY,
    blocksMovement: true,
  },
  farm: {
    label: 'Fazenda',
    description: 'Lavoura construída ao lado de um Moinho — 1 aldeão colhe comida.',
    width: 2, height: 2,        // mesmo tamanho do Moinho (4 tiles)
    cost: { wood: 15 },
    constructionTicks: 10,
    maxHp: 120,
    generates: { food: 4 },
    occupantCapacity: 1,        // só 1 aldeão por Fazenda
    blocksMovement: false,      // o aldeão fica na lavoura (tile andável)
  },
  stone_quarry: {
    label: 'Pedreira',
    description: 'Gera pedra enquanto houver aldeões trabalhando dentro.',
    width: 2, height: 2,
    cost: { wood: 30, stone: 10 },
    constructionTicks: 20,
    maxHp: 200,
    generates: { stone: 4 },
    occupantCapacity: PRODUCTION_OCCUPANT_CAPACITY,
    blocksMovement: true,
  },
};

// Máximo de arqueiros que podem guarnecer uma torre defensiva.
export const TOWER_GARRISON_MAX = 3;

export class PlayerBuilding {
  private _status: BuildingStatus;
  private _constructionTicksRemaining: number;
  private readonly _constructionTotalTicks: number;
  private _hp: number;
  private readonly _maxHp: number;
  // Combate de torre guarnecida (só usado por watchtower): alvo atual e cooldown.
  private _towerTargetId: string | null = null;
  private _towerCooldown = 0;
  // Escala de produção (construções de produção): decai a cada ciclo, reseta na era.
  private _prodScale = PRODUCTION_SCALE_MAX;
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

  get needsRepair(): boolean { return this._status === 'complete' && this._hp < this._maxHp; }

  /** Quanto de vida o reparo recupera por tick — proporcional ao tempo de construção. */
  get repairPerTick(): number { return Math.max(1, Math.ceil(this._maxHp / this.config.constructionTicks)); }

  /** Recupera vida (somente em construções concluídas). Retorna true ao atingir o máximo. */
  repair(amount: number): boolean {
    if (this._status !== 'complete') return false;
    this._hp = Math.min(this._maxHp, this._hp + amount);
    return this._hp >= this._maxHp;
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

  // ── Produção por ocupação ───────────────────────────────────────────────────
  get isProduction(): boolean { return !!this.config.generates; }
  get occupantCapacity(): number { return this.config.occupantCapacity ?? 0; }
  get productionScale(): number { return this._prodScale; }
  /** Produção fica cada vez mais difícil a cada ciclo (até o piso). */
  decayProduction(): void { this._prodScale = Math.max(PRODUCTION_SCALE_FLOOR, this._prodScale * PRODUCTION_SCALE_DECAY); }
  /** Volta a render bastante — chamado ao avançar de era. */
  resetProduction(): void { this._prodScale = PRODUCTION_SCALE_MAX; }

  // ── Combate de torre guarnecida ────────────────────────────────────────────
  get towerTargetId(): string | null { return this._towerTargetId; }
  setTowerTarget(id: string): void { this._towerTargetId = id; }
  clearTowerTarget(): void { this._towerTargetId = null; }
  tickTowerCooldown(): void { if (this._towerCooldown > 0) this._towerCooldown--; }
  get canTowerFire(): boolean { return this._towerCooldown <= 0; }
  resetTowerCooldown(ticks: number): void { this._towerCooldown = ticks; }

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

  toJSON(insideCount?: number) {
    const base = {
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
    if (this._type === 'watchtower') {
      return { ...base, garrison: insideCount ?? 0, garrisonMax: TOWER_GARRISON_MAX, towerTargetId: this._towerTargetId };
    }
    if (this.isProduction) {
      return { ...base, occupants: insideCount ?? 0, occupantsMax: this.occupantCapacity, producing: (insideCount ?? 0) > 0 };
    }
    return base;
  }
}

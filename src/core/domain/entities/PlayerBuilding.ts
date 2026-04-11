export type PlayerBuildingType =
  | 'wall'
  | 'watchtower'
  | 'lumber_camp'
  | 'gold_mine'
  | 'farm'
  | 'stone_quarry';

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
  generates?: BuildingCost;   // resources added every BUILDING_GEN_INTERVAL_TICKS
  visionRadius?: number;
  blocksMovement: boolean;
}

export const BUILDING_CONFIGS: Record<PlayerBuildingType, BuildingConfig> = {
  wall: {
    label: 'Muro',
    description: 'Bloqueia a passagem de unidades inimigas.',
    width: 1, height: 1,
    cost: { stone: 2 },
    blocksMovement: true,
  },
  watchtower: {
    label: 'Torre de Vigia',
    description: 'Revela uma grande área do mapa constantemente.',
    width: 1, height: 1,
    cost: { stone: 20, wood: 10 },
    visionRadius: 8,
    blocksMovement: false,
  },
  lumber_camp: {
    label: 'Serraria',
    description: 'Gera +8 madeira a cada 2 segundos automaticamente.',
    width: 2, height: 2,
    cost: { wood: 30, stone: 5 },
    generates: { wood: 8 },
    blocksMovement: false,
  },
  gold_mine: {
    label: 'Mina de Ouro',
    description: 'Gera +5 ouro a cada 2 segundos automaticamente.',
    width: 2, height: 2,
    cost: { stone: 40, wood: 20 },
    generates: { gold: 5 },
    blocksMovement: false,
  },
  farm: {
    label: 'Fazenda',
    description: 'Gera +8 comida a cada 2 segundos automaticamente.',
    width: 2, height: 2,
    cost: { wood: 25 },
    generates: { food: 8 },
    blocksMovement: false,
  },
  stone_quarry: {
    label: 'Pedreira',
    description: 'Gera +4 pedra a cada 2 segundos automaticamente.',
    width: 2, height: 2,
    cost: { wood: 30, stone: 10 },
    generates: { stone: 4 },
    blocksMovement: false,
  },
};

export class PlayerBuilding {
  constructor(
    private readonly _id: string,
    private readonly _ownerId: string,
    private readonly _type: PlayerBuildingType,
    private readonly _x: number,
    private readonly _y: number,
  ) {}

  get id(): string { return this._id; }
  get ownerId(): string { return this._ownerId; }
  get type(): PlayerBuildingType { return this._type; }
  get x(): number { return this._x; }
  get y(): number { return this._y; }
  get config(): BuildingConfig { return BUILDING_CONFIGS[this._type]; }
  get width(): number { return this.config.width; }
  get height(): number { return this.config.height; }

  get occupiedTiles(): { x: number; y: number }[] {
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
    };
  }
}

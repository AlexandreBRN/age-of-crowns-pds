import { v4 as uuidv4 } from 'uuid';
import { Villager } from './Villager';
import { TownCenter } from './TownCenter';
import { ResourceNode, RESOURCE_YIELD } from './ResourceNode';
import { PlayerBuilding, PlayerBuildingType, BUILDING_CONFIGS } from './PlayerBuilding';
import { VillagerId } from '../value-objects/VillagerId';
import { Resources } from '../value-objects/Resources';
import { TileType, TILE_WALKABLE } from '../value-objects/TileType';
import { GameStateSnapshot } from '../types/GameStateSnapshot';

export interface PlayerData {
  id: string;
  name: string;
  resources: Resources;
}

export interface ResourceNodeSpec {
  id: string;
  type: string;
  position: { x: number; y: number };
  initialYield?: number;
}

const SPAWN_CONFIGS = [
  {
    tcAnchorX: 2, tcAnchorY: 2,
    villagerOffsets: [{ dx: 5, dy: 0 }, { dx: 5, dy: 1 }, { dx: 5, dy: 2 }],
  },
  {
    tcAnchorX: 93, tcAnchorY: 93,
    villagerOffsets: [{ dx: -2, dy: 0 }, { dx: -2, dy: 1 }, { dx: -2, dy: 2 }],
  },
];

const GATHER_INTERVAL_TICKS = 4;
const BUILDING_GEN_INTERVAL_TICKS = 8;  // 2 seconds
const VILLAGER_TRAIN_COST = { food: 50 };

export class GameSession {
  private readonly _players: Map<string, PlayerData> = new Map();
  private readonly _villagers: Map<string, Villager> = new Map();
  private readonly _townCenters: Map<string, TownCenter> = new Map();
  private readonly _resourceNodes: Map<string, ResourceNode> = new Map();
  private readonly _playerBuildings: Map<string, PlayerBuilding> = new Map();
  private _tick = 0;

  constructor(
    private readonly _id: string,
    private readonly _mapTiles: TileType[][],
    resourceNodeSpecs: ResourceNodeSpec[],
  ) {
    for (const spec of resourceNodeSpecs) {
      const node = new ResourceNode(
        { value: spec.id } as any,
        spec.type as any,
        spec.position.x,
        spec.position.y,
        spec.initialYield,
      );
      this._resourceNodes.set(spec.id, node);
    }
  }

  get id(): string { return this._id; }
  get tick(): number { return this._tick; }
  get mapTiles(): TileType[][] { return this._mapTiles; }
  get isFull(): boolean { return this._players.size >= 2; }
  get players(): PlayerData[] { return Array.from(this._players.values()); }
  get villagers(): Villager[] { return Array.from(this._villagers.values()); }
  get townCenters(): TownCenter[] { return Array.from(this._townCenters.values()); }
  get resourceNodes(): ResourceNode[] { return Array.from(this._resourceNodes.values()); }
  get playerBuildings(): PlayerBuilding[] { return Array.from(this._playerBuildings.values()); }

  addPlayer(playerId: string, playerName: string): void {
    if (this._players.size >= 2) throw new Error('Sessão cheia');
    if (this._players.has(playerId)) return;

    const spawnIndex = this._players.size;
    const spawn = SPAWN_CONFIGS[spawnIndex];

    const tc = new TownCenter(`tc-${playerId}`, playerId, spawn.tcAnchorX, spawn.tcAnchorY);
    this._townCenters.set(tc.id, tc);

    for (const offset of spawn.villagerOffsets) {
      const villager = new Villager(
        VillagerId.generate(),
        playerId,
        spawn.tcAnchorX + offset.dx,
        spawn.tcAnchorY + offset.dy,
      );
      this._villagers.set(villager.id.value, villager);
    }

    this._players.set(playerId, {
      id: playerId,
      name: playerName,
      resources: Resources.initial(),
    });
  }

  removePlayer(playerId: string): void {
    this._players.delete(playerId);
    for (const [id, v] of this._villagers) {
      if (v.ownerId === playerId) this._villagers.delete(id);
    }
    for (const [id, tc] of this._townCenters) {
      if (tc.ownerId === playerId) this._townCenters.delete(id);
    }
  }

  commandVillagerMove(villagerId: string, destX: number, destY: number): void {
    const villager = this._villagers.get(villagerId);
    if (!villager) throw new Error('Aldeão não encontrado');
    if (!this._isTileWalkable(destX, destY)) throw new Error('Destino inválido');
    if (this._isTileOccupiedByBuilding(destX, destY)) throw new Error('Tile ocupado por construção');
    villager.commandMove(destX, destY);
  }

  commandVillagerGather(villagerId: string, nodeId: string): void {
    const villager = this._villagers.get(villagerId);
    if (!villager) throw new Error('Aldeão não encontrado');
    const node = this._resourceNodes.get(nodeId);
    if (!node) throw new Error('Recurso não encontrado');
    if (node.isDepleted) throw new Error('Recurso esgotado');
    villager.commandGather(nodeId, node.x, node.y);
  }

  startTrainingVillager(playerId: string): void {
    const player = this._players.get(playerId);
    if (!player) throw new Error('Jogador não encontrado');
    if (!player.resources.canAfford(VILLAGER_TRAIN_COST)) {
      throw new Error('Comida insuficiente (custo: 50)');
    }
    const tc = this._getTownCenterOf(playerId);
    tc.startTraining();
    this._players.set(playerId, {
      ...player,
      resources: player.resources.subtract(VILLAGER_TRAIN_COST),
    });
  }

  placeBuilding(playerId: string, type: PlayerBuildingType, x: number, y: number): void {
    const player = this._players.get(playerId);
    if (!player) throw new Error('Jogador não encontrado');

    const config = BUILDING_CONFIGS[type];
    if (!config) throw new Error('Tipo de construção inválido');

    if (!player.resources.canAfford(config.cost)) {
      throw new Error(`Recursos insuficientes para construir ${config.label}`);
    }

    // Validate all tiles in the footprint
    for (let dy = 0; dy < config.height; dy++) {
      for (let dx = 0; dx < config.width; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (!this._isTileWalkable(tx, ty)) {
          throw new Error('Não é possível construir neste terreno');
        }
        if (this._isTileOccupiedByBuilding(tx, ty)) {
          throw new Error('Tile já ocupado por outra construção');
        }
      }
    }

    const building = new PlayerBuilding(uuidv4(), playerId, type, x, y);
    this._playerBuildings.set(building.id, building);
    this._players.set(playerId, {
      ...player,
      resources: player.resources.subtract(config.cost),
    });
  }

  advanceTick(): void {
    this._tick++;

    // Movement
    for (const villager of this._villagers.values()) {
      if (villager.state === 'moving') {
        villager.stepTowardTarget();
      }
    }

    // Resource gathering by villagers
    if (this._tick % GATHER_INTERVAL_TICKS === 0) {
      for (const villager of this._villagers.values()) {
        if (villager.state !== 'gathering' || !villager.gatherTargetId) continue;
        const node = this._resourceNodes.get(villager.gatherTargetId);
        if (!node || node.isDepleted) {
          villager.setIdle();
          continue;
        }
        const harvested = node.harvest(RESOURCE_YIELD[node.type]);
        const player = this._players.get(villager.ownerId);
        if (player) {
          this._players.set(villager.ownerId, {
            ...player,
            resources: player.resources.add({ [node.resourceKind]: harvested }),
          });
        }
      }
    }

    // Resource generation from buildings
    if (this._tick % BUILDING_GEN_INTERVAL_TICKS === 0) {
      for (const building of this._playerBuildings.values()) {
        const gen = building.config.generates;
        if (!gen) continue;
        const player = this._players.get(building.ownerId);
        if (player) {
          this._players.set(building.ownerId, {
            ...player,
            resources: player.resources.add(gen),
          });
        }
      }
    }

    // Town center training
    for (const tc of this._townCenters.values()) {
      if (!tc.isTraining) continue;
      const done = tc.tickTraining();
      if (done) {
        this._spawnTrainedVillager(tc.ownerId, tc.anchorX, tc.anchorY);
      }
    }
  }

  toStateSnapshot(): GameStateSnapshot {
    return {
      sessionId: this._id,
      tick: this._tick,
      players: Array.from(this._players.values()).map(p => ({
        id: p.id,
        name: p.name,
        resources: p.resources.toJSON(),
      })),
      villagers: Array.from(this._villagers.values()).map(v => v.toJSON()),
      townCenters: Array.from(this._townCenters.values()).map(tc => tc.toJSON()),
      resourceNodes: Array.from(this._resourceNodes.values())
        .filter(n => !n.isDepleted)
        .map(n => n.toJSON()),
      playerBuildings: Array.from(this._playerBuildings.values()).map(b => b.toJSON()),
    };
  }

  private _isTileWalkable(x: number, y: number): boolean {
    const row = this._mapTiles[y];
    if (!row) return false;
    const tile = row[x];
    if (!tile) return false;
    return TILE_WALKABLE[tile];
  }

  private _isTileOccupiedByBuilding(x: number, y: number): boolean {
    for (const b of this._playerBuildings.values()) {
      for (const t of b.occupiedTiles) {
        if (t.x === x && t.y === y) return true;
      }
    }
    // Also check town center tiles
    for (const tc of this._townCenters.values()) {
      for (const t of tc.occupiedTiles) {
        if (t.x === x && t.y === y) return true;
      }
    }
    return false;
  }

  private _getTownCenterOf(playerId: string): TownCenter {
    for (const tc of this._townCenters.values()) {
      if (tc.ownerId === playerId) return tc;
    }
    throw new Error('Centro de cidade não encontrado');
  }

  private _spawnTrainedVillager(playerId: string, tcAnchorX: number, tcAnchorY: number): void {
    const candidates = [
      { x: tcAnchorX + 3, y: tcAnchorY },
      { x: tcAnchorX + 3, y: tcAnchorY + 1 },
      { x: tcAnchorX + 3, y: tcAnchorY + 2 },
      { x: tcAnchorX, y: tcAnchorY + 3 },
      { x: tcAnchorX - 1, y: tcAnchorY },
    ];
    const occupied = new Set(
      Array.from(this._villagers.values()).map(v => `${v.x},${v.y}`)
    );
    for (const pos of candidates) {
      if (!occupied.has(`${pos.x},${pos.y}`) && this._isTileWalkable(pos.x, pos.y)) {
        const v = new Villager(VillagerId.generate(), playerId, pos.x, pos.y);
        this._villagers.set(v.id.value, v);
        return;
      }
    }
    const v = new Villager(VillagerId.generate(), playerId, tcAnchorX + 3, tcAnchorY);
    this._villagers.set(v.id.value, v);
  }
}

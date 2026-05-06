import { v4 as uuidv4 } from 'uuid';
import { Villager, UnitType, UNIT_CONFIGS, AttackTargetKind } from './Villager';
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
    tcAnchorX: 54, tcAnchorY: 54,
    villagerOffsets: [{ dx: -2, dy: 0 }, { dx: -2, dy: 1 }, { dx: -2, dy: 2 }],
  },
];

const GATHER_INTERVAL_TICKS = 4;
const BUILDING_GEN_INTERVAL_TICKS = 8;

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
    if (villager.state === 'constructing' || villager.constructTargetId !== null) {
      throw new Error('Aldeão ocupado construindo');
    }
    if (!this._isTileWalkable(destX, destY)) throw new Error('Destino inválido');
    if (this._isTileBlockedByCompleteBuilding(destX, destY)) throw new Error('Tile bloqueado por muro');
    villager.commandMove(destX, destY);
  }

  commandVillagerGather(villagerId: string, nodeId: string): void {
    const villager = this._villagers.get(villagerId);
    if (!villager) throw new Error('Aldeão não encontrado');
    if (villager.state === 'constructing' || villager.constructTargetId !== null) {
      throw new Error('Aldeão ocupado construindo');
    }
    const node = this._resourceNodes.get(nodeId);
    if (!node) throw new Error('Recurso não encontrado');
    if (node.isDepleted) throw new Error('Recurso esgotado');
    villager.commandGather(nodeId, node.x, node.y);
  }

  commandVillagerAttack(villagerId: string, targetId: string, targetKind: AttackTargetKind): void {
    const attacker = this._villagers.get(villagerId);
    if (!attacker) throw new Error('Unidade não encontrada');
    if (attacker.config.attackDamage === 0) throw new Error('Esta unidade não pode atacar');
    const targetOwner = this._getTargetOwner(targetId, targetKind);
    if (!targetOwner || targetOwner === attacker.ownerId) throw new Error('Alvo inválido');
    attacker.commandAttack(targetId, targetKind);
  }

  startTrainingUnit(playerId: string, unitType: UnitType): void {
    const player = this._players.get(playerId);
    if (!player) throw new Error('Jogador não encontrado');
    const cfg = UNIT_CONFIGS[unitType];
    if (!player.resources.canAfford(cfg.trainCost)) {
      throw new Error(`Recursos insuficientes para treinar ${cfg.label}`);
    }
    const tc = this._getTownCenterOf(playerId);
    tc.startTraining(unitType, cfg.trainTicks);
    this._players.set(playerId, {
      ...player,
      resources: player.resources.subtract(cfg.trainCost),
    });
  }

  placeBuilding(playerId: string, type: PlayerBuildingType, x: number, y: number, villagerId?: string): void {
    const player = this._players.get(playerId);
    if (!player) throw new Error('Jogador não encontrado');

    const config = BUILDING_CONFIGS[type];
    if (!config) throw new Error('Tipo de construção inválido');

    if (!player.resources.canAfford(config.cost)) {
      throw new Error(`Recursos insuficientes para construir ${config.label}`);
    }

    for (let dy = 0; dy < config.height; dy++) {
      for (let dx = 0; dx < config.width; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (!this._isTileWalkable(tx, ty)) throw new Error('Não é possível construir neste terreno');
        if (this._isTileOccupiedByBuilding(tx, ty)) throw new Error('Tile já ocupado por outra construção');
      }
    }

    const building = new PlayerBuilding(uuidv4(), playerId, type, x, y);
    this._playerBuildings.set(building.id, building);
    this._players.set(playerId, {
      ...player,
      resources: player.resources.subtract(config.cost),
    });

    const builder = this._findBuilder(playerId, villagerId, x, y, config.width, config.height);
    if (builder) {
      const dest = this._adjacentTile(x, y, config.width, config.height);
      if (dest) builder.commandConstruct(building.id, dest.x, dest.y);
    }
  }

  advanceTick(): void {
    this._tick++;

    const isTileBlocked = (x: number, y: number) =>
      !this._isTileWalkable(x, y) || this._isTileBlockedByCompleteBuilding(x, y);

    // ── Movement (multi-speed for cavalry) ───────────────────────────────────
    for (const villager of this._villagers.values()) {
      if (villager.state !== 'moving') continue;
      const steps = villager.config.moveSpeedTiles;
      for (let i = 0; i < steps; i++) {
        if (!villager.stepTowardTarget(isTileBlocked)) break;
      }
    }

    // ── Construction ─────────────────────────────────────────────────────────
    for (const villager of this._villagers.values()) {
      if (villager.state !== 'constructing' || !villager.constructTargetId) continue;
      const building = this._playerBuildings.get(villager.constructTargetId);
      if (!building || building.isComplete) { villager.setIdle(); continue; }
      building.tickConstruction();
      if (building.isComplete) villager.setIdle();
    }

    // ── Combat ───────────────────────────────────────────────────────────────
    for (const attacker of this._villagers.values()) {
      if (attacker.state !== 'attacking' || !attacker.attackTargetId) continue;
      const cfg = attacker.config;

      const targetPos = this._getTargetCenter(attacker.attackTargetId, attacker.attackTargetKind!);
      if (!targetPos) { attacker.setIdle(); continue; } // target gone

      const dist = Math.max(
        Math.abs(attacker.x - targetPos.x),
        Math.abs(attacker.y - targetPos.y),
      );

      if (dist <= cfg.attackRange) {
        // In range: deal damage on cooldown
        attacker.incrementAttackCounter();
        if (attacker.attackTickCounter >= cfg.attackCooldownTicks) {
          this._applyDamage(attacker.attackTargetId, attacker.attackTargetKind!, cfg.attackDamage);
          attacker.resetAttackCounter();
        }
      } else {
        // Out of range: move toward target (cavalry takes 2 steps)
        for (let step = 0; step < cfg.moveSpeedTiles; step++) {
          const dx = Math.sign(targetPos.x - attacker.x);
          const dy = Math.sign(targetPos.y - attacker.y);
          if (dx !== 0 && !isTileBlocked(attacker.x + dx, attacker.y)) {
            attacker.nudge(dx, 0);
          } else if (dy !== 0 && !isTileBlocked(attacker.x, attacker.y + dy)) {
            attacker.nudge(0, dy);
          } else {
            break;
          }
        }
      }
    }

    // ── Auto-attack idle combat units ────────────────────────────────────────
    for (const unit of this._villagers.values()) {
      if (unit.state !== 'idle' || unit.config.attackDamage === 0) continue;
      const enemy = this._findNearestEnemyInRange(unit);
      if (enemy) unit.commandAttack(enemy.id, enemy.kind);
    }

    // ── Resource gathering ────────────────────────────────────────────────────
    if (this._tick % GATHER_INTERVAL_TICKS === 0) {
      for (const villager of this._villagers.values()) {
        if (villager.state !== 'gathering' || !villager.gatherTargetId) continue;
        const node = this._resourceNodes.get(villager.gatherTargetId);
        if (!node || node.isDepleted) { villager.setIdle(); continue; }
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

    // ── Building resource generation ──────────────────────────────────────────
    if (this._tick % BUILDING_GEN_INTERVAL_TICKS === 0) {
      for (const building of this._playerBuildings.values()) {
        if (!building.isComplete) continue;
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

    // ── Town center training ──────────────────────────────────────────────────
    for (const tc of this._townCenters.values()) {
      if (!tc.isTraining) continue;
      const done = tc.tickTraining();
      if (done) {
        this._spawnTrainedUnit(tc.ownerId, tc.anchorX, tc.anchorY, tc.trainingUnitType ?? 'villager');
      }
    }

    // ── Cleanup dead/destroyed entities ──────────────────────────────────────
    for (const [id, v] of this._villagers) {
      if (v.isDead) this._villagers.delete(id);
    }
    for (const [id, b] of this._playerBuildings) {
      if (b.isDestroyed) this._playerBuildings.delete(id);
    }
    for (const [id, tc] of this._townCenters) {
      if (tc.isDestroyed) this._townCenters.delete(id);
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

  // ── Private helpers ─────────────────────────────────────────────────────────

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
    for (const tc of this._townCenters.values()) {
      for (const t of tc.occupiedTiles) {
        if (t.x === x && t.y === y) return true;
      }
    }
    return false;
  }

  private _isTileBlockedByCompleteBuilding(x: number, y: number): boolean {
    for (const b of this._playerBuildings.values()) {
      if (!b.isComplete || !b.config.blocksMovement) continue;
      for (const t of b.occupiedTiles) {
        if (t.x === x && t.y === y) return true;
      }
    }
    return false;
  }

  private _getTargetOwner(targetId: string, kind: AttackTargetKind): string | null {
    if (kind === 'unit') return this._villagers.get(targetId)?.ownerId ?? null;
    if (kind === 'building') return this._playerBuildings.get(targetId)?.ownerId ?? null;
    if (kind === 'town_center') return this._townCenters.get(targetId)?.ownerId ?? null;
    return null;
  }

  private _getTargetCenter(targetId: string, kind: AttackTargetKind): { x: number; y: number } | null {
    if (kind === 'unit') {
      const v = this._villagers.get(targetId);
      return v && !v.isDead ? { x: v.x, y: v.y } : null;
    }
    if (kind === 'building') {
      const b = this._playerBuildings.get(targetId);
      if (!b || b.isDestroyed) return null;
      return { x: b.x + Math.floor(b.width / 2), y: b.y + Math.floor(b.height / 2) };
    }
    if (kind === 'town_center') {
      const tc = this._townCenters.get(targetId);
      if (!tc || tc.isDestroyed) return null;
      return { x: tc.anchorX + 1, y: tc.anchorY + 1 };
    }
    return null;
  }

  private _applyDamage(targetId: string, kind: AttackTargetKind, amount: number): void {
    if (kind === 'unit') this._villagers.get(targetId)?.takeDamage(amount);
    else if (kind === 'building') this._playerBuildings.get(targetId)?.takeDamage(amount);
    else if (kind === 'town_center') this._townCenters.get(targetId)?.takeDamage(amount);
  }

  private _findNearestEnemyInRange(unit: Villager): { id: string; kind: AttackTargetKind } | null {
    const range = unit.config.attackRange;
    let best: { id: string; kind: AttackTargetKind } | null = null;
    let bestDist = range + 1;

    for (const v of this._villagers.values()) {
      if (v.ownerId === unit.ownerId || v.isDead) continue;
      const d = Math.max(Math.abs(v.x - unit.x), Math.abs(v.y - unit.y));
      if (d < bestDist) { bestDist = d; best = { id: v.id.value, kind: 'unit' }; }
    }
    for (const b of this._playerBuildings.values()) {
      if (b.ownerId === unit.ownerId || !b.isComplete || b.isDestroyed) continue;
      const bx = b.x + Math.floor(b.width / 2);
      const by = b.y + Math.floor(b.height / 2);
      const d = Math.max(Math.abs(bx - unit.x), Math.abs(by - unit.y));
      if (d < bestDist) { bestDist = d; best = { id: b.id, kind: 'building' }; }
    }
    for (const tc of this._townCenters.values()) {
      if (tc.ownerId === unit.ownerId || tc.isDestroyed) continue;
      const d = Math.max(Math.abs(tc.anchorX + 1 - unit.x), Math.abs(tc.anchorY + 1 - unit.y));
      if (d < bestDist) { bestDist = d; best = { id: tc.id, kind: 'town_center' }; }
    }

    return best;
  }

  private _findBuilder(
    playerId: string,
    preferredId: string | undefined,
    bx: number, by: number, bw: number, bh: number,
  ): Villager | null {
    if (preferredId) {
      const v = this._villagers.get(preferredId);
      if (v && v.ownerId === playerId && v.unitType === 'villager') return v;
    }
    let best: Villager | null = null;
    let bestDist = Infinity;
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    for (const v of this._villagers.values()) {
      if (v.ownerId !== playerId || v.unitType !== 'villager') continue;
      if (v.state === 'constructing') continue;
      const d = Math.abs(v.x - cx) + Math.abs(v.y - cy);
      if (d < bestDist) { bestDist = d; best = v; }
    }
    return best;
  }

  private _adjacentTile(bx: number, by: number, bw: number, bh: number): { x: number; y: number } | null {
    const candidates: { x: number; y: number }[] = [];
    for (let dy = 0; dy < bh; dy++) candidates.push({ x: bx + bw, y: by + dy });
    for (let dx = 0; dx < bw; dx++) candidates.push({ x: bx + dx, y: by + bh });
    for (let dy = 0; dy < bh; dy++) candidates.push({ x: bx - 1, y: by + dy });
    for (let dx = 0; dx < bw; dx++) candidates.push({ x: bx + dx, y: by - 1 });
    for (const c of candidates) {
      if (this._isTileWalkable(c.x, c.y) && !this._isTileBlockedByCompleteBuilding(c.x, c.y)) return c;
    }
    return null;
  }

  private _getTownCenterOf(playerId: string): TownCenter {
    for (const tc of this._townCenters.values()) {
      if (tc.ownerId === playerId) return tc;
    }
    throw new Error('Centro de cidade não encontrado');
  }

  private _spawnTrainedUnit(playerId: string, tcAnchorX: number, tcAnchorY: number, unitType: UnitType): void {
    const candidates = [
      { x: tcAnchorX + 3, y: tcAnchorY },
      { x: tcAnchorX + 3, y: tcAnchorY + 1 },
      { x: tcAnchorX + 3, y: tcAnchorY + 2 },
      { x: tcAnchorX, y: tcAnchorY + 3 },
      { x: tcAnchorX - 1, y: tcAnchorY },
    ];
    const occupied = new Set(Array.from(this._villagers.values()).map(v => `${v.x},${v.y}`));
    for (const pos of candidates) {
      if (!occupied.has(`${pos.x},${pos.y}`) && this._isTileWalkable(pos.x, pos.y)) {
        const v = new Villager(VillagerId.generate(), playerId, pos.x, pos.y, unitType);
        this._villagers.set(v.id.value, v);
        return;
      }
    }
    const v = new Villager(VillagerId.generate(), playerId, tcAnchorX + 3, tcAnchorY, unitType);
    this._villagers.set(v.id.value, v);
  }
}

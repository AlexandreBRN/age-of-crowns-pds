import { v4 as uuidv4 } from 'uuid';
import { Villager, UnitType, UNIT_CONFIGS, AttackTargetKind, ERA_UNIT_TRAIN_MULT } from './Villager';
import { TownCenter } from './TownCenter';
import { ResourceNode, RESOURCE_YIELD } from './ResourceNode';
import { PlayerBuilding, PlayerBuildingType, BUILDING_CONFIGS, BuildingCost, TOWER_GARRISON_MAX } from './PlayerBuilding';
import { VillagerId } from '../value-objects/VillagerId';
import { Resources } from '../value-objects/Resources';
import { TileType, TILE_WALKABLE } from '../value-objects/TileType';
import { GameStateSnapshot } from '../types/GameStateSnapshot';
import { findPath } from '../services/Pathfinder';

export interface PlayerData {
  id: string;
  name: string;
  resources: Resources;
  era: number;
}

// Flecha em voo: parte da torre e persegue o alvo; causa dano ao atingi-lo.
interface Projectile {
  id: string;
  ownerId: string;
  x: number; y: number;          // posição atual (tiles)
  targetId: string;
  targetKind: AttackTargetKind;
  damage: number;
  tx: number; ty: number;        // última posição conhecida do alvo (para o render)
}

const ARROW_SPEED = 1.4;         // tiles por tick

// Raio de percepção: unidades militares engajam inimigos próximos automaticamente.
const DETECTION_RADIUS = 7;      // tiles
// Distância mínima entre unidades (colisão suave — evita empilhamento).
const UNIT_MIN_SEPARATION = 0.8; // tiles

// Cost to advance to era index N (index 0 unused). Era 1 is the initial state.
export const ERA_UP_COSTS: ReadonlyArray<{ gold: number; wood: number; stone: number; food: number } | null> = [
  null,                                                  // era 1 (initial)
  { gold: 500,  wood: 500,  stone: 300,  food: 300  },   // 1 → 2
  { gold: 1500, wood: 1500, stone: 1000, food: 1000 },   // 2 → 3
];

// Passive bonuses by era (index = current era). Era 1 is the baseline.
const ERA_GEN_MULT = [1.0, 1.0, 1.5, 2.0];
const ERA_HP_MULT  = [1.0, 1.0, 1.25, 1.5];
export const MAX_ERA = 3;

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

// ─────────────────────────────────────────────────────────────────────────────
// DEV/TESTE — configuração TEMPORÁRIA para acelerar a validação de mecânicas.
// A cada nova partida o jogador já começa com tropas prontas e recursos de sobra,
// evitando ter de coletar/treinar do zero para testar construção, treino e combate.
// NÃO faz parte do balanceamento final. Para desativar: troque DEV_FAST_START
// para false (ou remova este bloco e a chamada a _applyDevFastStart em addPlayer).
// ─────────────────────────────────────────────────────────────────────────────
const DEV_FAST_START = true;
const DEV_START_RESOURCES = 1000;     // de cada recurso (madeira, pedra, ouro, comida)
const DEV_START_CAVALRY = 4;
const DEV_START_ARCHERS = 4;

// População inicial fornecida pela Torre Principal e teto absoluto de população.
const BASE_POPULATION = 10;
const POPULATION_HARD_CAP = 200;

export class GameSession {
  private readonly _players: Map<string, PlayerData> = new Map();
  private readonly _villagers: Map<string, Villager> = new Map();
  private readonly _townCenters: Map<string, TownCenter> = new Map();
  private readonly _resourceNodes: Map<string, ResourceNode> = new Map();
  private readonly _playerBuildings: Map<string, PlayerBuilding> = new Map();
  // Arqueiros guarnecidos por torre (removidos do campo enquanto dentro dela).
  private readonly _garrisons: Map<string, Villager[]> = new Map();
  // Aldeões trabalhando dentro de construções de produção (também saem do campo).
  private readonly _occupants: Map<string, Villager[]> = new Map();
  // Flechas em voo disparadas pelas torres guarnecidas.
  private readonly _projectiles: Map<string, Projectile> = new Map();
  private _tick = 0;
  private _gameOver = false;
  private _winnerId: string | null = null;

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
  get isGameOver(): boolean { return this._gameOver; }
  get winnerId(): string | null { return this._winnerId; }
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
      era: 1,
    });

    if (DEV_FAST_START) this._applyDevFastStart(playerId, spawn.tcAnchorX, spawn.tcAnchorY);
  }

  /**
   * DEV/TESTE: dá recursos de sobra e tropas prontas ao jogador no início.
   * Remova este método (e sua chamada em addPlayer) ao entrar em balanceamento.
   */
  private _applyDevFastStart(playerId: string, tcAnchorX: number, tcAnchorY: number): void {
    const player = this._players.get(playerId);
    if (player) {
      this._players.set(playerId, {
        ...player,
        resources: new Resources(DEV_START_RESOURCES, DEV_START_RESOURCES, DEV_START_RESOURCES, DEV_START_RESOURCES),
      });
    }
    const troops: UnitType[] = [
      ...Array<UnitType>(DEV_START_CAVALRY).fill('cavalry'),
      ...Array<UnitType>(DEV_START_ARCHERS).fill('archer'),
    ];
    const spots = this._freeSpawnTilesNear(tcAnchorX, tcAnchorY, troops.length);
    troops.forEach((type, i) => {
      const pos = spots[i];
      if (!pos) return;
      const v = new Villager(VillagerId.generate(), playerId, pos.x, pos.y, type);
      this._villagers.set(v.id.value, v);
    });
  }

  /** Coleta tiles livres ao redor da Torre Principal (para o spawn de teste). */
  private _freeSpawnTilesNear(ax: number, ay: number, count: number): { x: number; y: number }[] {
    const result: { x: number; y: number }[] = [];
    const occupied = new Set(Array.from(this._villagers.values()).map(v => `${Math.round(v.x)},${Math.round(v.y)}`));
    const cx = ax + 1, cy = ay + 1; // centro do TC 3×3
    for (let r = 1; r <= 10 && result.length < count; r++) {
      for (let dy = -r; dy <= r && result.length < count; dy++) {
        for (let dx = -r; dx <= r && result.length < count; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // só o anel externo
          const x = cx + dx, y = cy + dy;
          const key = `${x},${y}`;
          if (occupied.has(key)) continue;
          if (!this._isTileWalkable(x, y) || this._isTileOccupiedByBuilding(x, y)) continue;
          occupied.add(key);
          result.push({ x, y });
        }
      }
    }
    return result;
  }

  commandAdvanceEra(playerId: string): void {
    const player = this._players.get(playerId);
    if (!player) throw new Error('Jogador não encontrado');
    if (player.era >= MAX_ERA) throw new Error('Era máxima atingida');
    // Custo para avançar A PARTIR da era atual (1→2 = índice 1, 2→3 = índice 2).
    // Avança exatamente uma era por vez — não é possível pular etapas.
    const cost = ERA_UP_COSTS[player.era];
    if (!cost) throw new Error('Era máxima atingida');
    if (!player.resources.canAfford(cost)) {
      throw new Error('Recursos insuficientes para avançar de era');
    }
    const newEra = player.era + 1;
    this._players.set(playerId, {
      ...player,
      era: newEra,
      resources: player.resources.subtract(cost),
    });

    // Aplica os bônus de era às unidades EXISTENTES do jogador (campo + dentro de
    // construções). setEra usa a era absoluta, então o bônus nunca é aplicado duas vezes.
    for (const v of this._villagers.values()) if (v.ownerId === playerId) v.setEra(newEra);
    for (const list of this._garrisons.values()) for (const u of list) if (u.ownerId === playerId) u.setEra(newEra);
    for (const list of this._occupants.values()) for (const u of list) if (u.ownerId === playerId) u.setEra(newEra);

    // Avançar de era recupera totalmente a vida da Torre Principal (única forma de curá-la).
    for (const tc of this._townCenters.values()) {
      if (tc.ownerId === playerId) { tc.restoreFullHp(); break; }
    }
    // ...e revigora a produção das construções do jogador (volta a render bastante).
    for (const b of this._playerBuildings.values()) {
      if (b.ownerId === playerId && b.isProduction) b.resetProduction();
    }
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
    if (this._isTileBlockedByCompleteBuildingFor(villager.ownerId, destX, destY)) throw new Error('Tile bloqueado por muro');
    villager.commandMove(destX, destY);
  }

  commandVillagerGather(villagerId: string, nodeId: string): void {
    const villager = this._villagers.get(villagerId);
    if (!villager) throw new Error('Aldeão não encontrado');
    if (villager.unitType !== 'villager') throw new Error('Apenas aldeões podem coletar recursos');
    if (villager.state === 'constructing' || villager.constructTargetId !== null) {
      throw new Error('Aldeão ocupado construindo');
    }
    const node = this._resourceNodes.get(nodeId);
    if (!node) throw new Error('Recurso não encontrado');
    if (node.isDepleted) throw new Error('Recurso esgotado');
    villager.commandGather(nodeId, node.x, node.y);
  }

  commandVillagerConstruct(villagerId: string, buildingId: string): void {
    const villager = this._villagers.get(villagerId);
    if (!villager) throw new Error('Aldeão não encontrado');
    if (villager.unitType !== 'villager') throw new Error('Apenas aldeões podem construir');
    if (villager.isDying) throw new Error('Unidade está morrendo');
    const building = this._playerBuildings.get(buildingId);
    if (!building) throw new Error('Construção não encontrada');
    if (building.ownerId !== villager.ownerId) throw new Error('Construção não pertence a você');
    // Concluída e com vida cheia: nada a fazer. Se estiver danificada, é um reparo.
    if (building.isComplete && !building.needsRepair) throw new Error('Construção já concluída');
    // Muro: o aldeão vai até o segmento mais próximo. Demais construções: adjacente à área.
    let dest: { x: number; y: number } | null;
    if (building.type === 'wall') {
      const near = this._nearestCell(building.occupiedTiles, villager.x, villager.y);
      dest = this._adjacentTile(near.x, near.y, 1, 1);
    } else {
      dest = this._adjacentTile(building.x, building.y, building.width, building.height);
    }
    if (dest) villager.commandConstruct(building.id, dest.x, dest.y);
  }

  /** Ordena um arqueiro a caminhar até a torre e se guarnecer nela (máx. 3). */
  commandGarrisonArcher(playerId: string, archerId: string, towerId: string): void {
    const archer = this._villagers.get(archerId);
    if (!archer) throw new Error('Arqueiro não encontrado');
    if (archer.ownerId !== playerId) throw new Error('Unidade não é sua');
    if (archer.unitType !== 'archer') throw new Error('Apenas arqueiros podem guarnecer torres');
    if (archer.isDying) throw new Error('Unidade está morrendo');
    const tower = this._playerBuildings.get(towerId);
    if (!tower || tower.type !== 'watchtower') throw new Error('Selecione uma Torre de Vigia');
    if (tower.ownerId !== playerId) throw new Error('Torre não é sua');
    if (!tower.isComplete) throw new Error('A torre ainda está em construção');
    if ((this._garrisons.get(towerId)?.length ?? 0) >= TOWER_GARRISON_MAX) {
      throw new Error('A torre está cheia (máx. 3 arqueiros)');
    }
    const dest = this._adjacentTile(tower.x, tower.y, tower.width, tower.height);
    if (!dest) throw new Error('Não há espaço ao redor da torre');
    archer.commandEnterBuilding(towerId, dest.x, dest.y);
  }

  /** Remove (desembarca) todos os arqueiros guarnecidos em uma torre. */
  commandUngarrison(playerId: string, towerId: string): void {
    const tower = this._playerBuildings.get(towerId);
    if (!tower || tower.type !== 'watchtower') throw new Error('Selecione uma Torre de Vigia');
    if (tower.ownerId !== playerId) throw new Error('Torre não é sua');
    this._ejectFrom(this._garrisons, towerId);
  }

  /** Ordena um aldeão a caminhar até uma construção de produção e trabalhar dentro. */
  commandOccupyBuilding(playerId: string, villagerId: string, buildingId: string): void {
    const villager = this._villagers.get(villagerId);
    if (!villager) throw new Error('Aldeão não encontrado');
    if (villager.ownerId !== playerId) throw new Error('Unidade não é sua');
    if (villager.unitType !== 'villager') throw new Error('Apenas aldeões podem ocupar construções');
    if (villager.isDying) throw new Error('Unidade está morrendo');
    const building = this._playerBuildings.get(buildingId);
    if (!building || !building.isProduction) throw new Error('Esta construção não produz recursos');
    if (building.ownerId !== playerId) throw new Error('Construção não é sua');
    if (!building.isComplete) throw new Error('A construção ainda está em obras');

    if (building.type === 'farm') {
      // Fazenda: o aldeão vai até um quadrado de plantação livre e fica trabalhando lá (visível).
      if (this._farmReservedCount(buildingId) >= building.occupantCapacity) {
        throw new Error('A Fazenda está cheia');
      }
      const square = this._freeFarmSquare(building);
      if (!square) throw new Error('A Fazenda está cheia');
      villager.commandEnterBuilding(buildingId, square.x, square.y);
      return;
    }

    // Demais construções de produção: o aldeão entra (some do mapa).
    if ((this._occupants.get(buildingId)?.length ?? 0) >= building.occupantCapacity) {
      throw new Error('A construção está cheia');
    }
    const dest = this._adjacentTile(building.x, building.y, building.width, building.height);
    if (!dest) throw new Error('Não há espaço ao redor da construção');
    villager.commandEnterBuilding(buildingId, dest.x, dest.y);
  }

  /** Remove todos os aldeões que trabalham em uma construção (saem/voltam a obedecer). */
  commandVacateBuilding(playerId: string, buildingId: string): void {
    const building = this._playerBuildings.get(buildingId);
    if (!building) throw new Error('Construção não encontrada');
    if (building.ownerId !== playerId) throw new Error('Construção não é sua');
    if (building.type === 'farm') {
      // Aldeões da Fazenda ficam ociosos onde estão (continuam visíveis na lavoura).
      for (const v of this._villagers.values()) if (v.farmTargetId === buildingId) v.commandIdle();
    } else {
      this._ejectFrom(this._occupants, buildingId);
    }
  }

  commandVillagerAttack(villagerId: string, targetId: string, targetKind: AttackTargetKind): void {
    const attacker = this._villagers.get(villagerId);
    if (!attacker) throw new Error('Unidade não encontrada');
    if (attacker.config.attackDamage === 0) throw new Error('Esta unidade não pode atacar');
    if (attacker.isDying) throw new Error('Unidade está morrendo');
    const targetOwner = this._getTargetOwner(targetId, targetKind);
    if (!targetOwner) throw new Error('Alvo inválido');
    // Friendly-fire allowed (for testing death animations / sparring).
    if (targetId === attacker.id.value) throw new Error('Não pode atacar a si mesmo');
    attacker.commandAttack(targetId, targetKind);
  }

  /** Tempo de treino (ticks) de uma unidade, já com a redução por era do jogador. */
  private _trainTicksFor(unitType: UnitType, era: number): number {
    return Math.max(1, Math.floor(UNIT_CONFIGS[unitType].trainTicks * (ERA_UNIT_TRAIN_MULT[era] ?? 1.0)));
  }

  /**
   * Treina uma unidade. Se o Centro de Cidade já estiver produzindo, a unidade
   * entra na FILA e começa automaticamente quando a anterior terminar. O custo é
   * pago ao enfileirar; a população considera a unidade atual + toda a fila.
   */
  startTrainingUnit(playerId: string, unitType: UnitType): void {
    const player = this._players.get(playerId);
    if (!player) throw new Error('Jogador não encontrado');
    const cfg = UNIT_CONFIGS[unitType];
    const tc = this._getTownCenterOf(playerId);
    // Cada unidade em produção/fila ocupa uma vaga de população.
    if (this.populationOf(playerId) + tc.pendingCount >= this.populationCapOf(playerId)) {
      throw new Error('Limite de população atingido — construa uma Casa');
    }
    if (!player.resources.canAfford(cfg.trainCost)) {
      throw new Error(`Recursos insuficientes para treinar ${cfg.label}`);
    }
    if (tc.isTraining) {
      tc.enqueue(unitType);          // já produzindo → vai para a fila
    } else {
      tc.startTraining(unitType, this._trainTicksFor(unitType, player.era));
    }
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

    const hpMult = ERA_HP_MULT[player.era] ?? 1.0;
    const building = new PlayerBuilding(uuidv4(), playerId, type, x, y, hpMult);
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

  /**
   * Cria uma linha de muralhas: a linha é "encaixada" em uma das 8 direções
   * isométricas e cada tile vira um segmento de muro independente (progresso,
   * vida e barra próprios). O aldeão constrói um segmento por vez — caminha até o
   * primeiro, conclui, e só então segue para o próximo da fila.
   */
  placeWall(playerId: string, startX: number, startY: number, endX: number, endY: number, villagerId?: string): void {
    const player = this._players.get(playerId);
    if (!player) throw new Error('Jogador não encontrado');

    const cells = this._wallCells(startX, startY, endX, endY);

    // Cada segmento precisa de terreno válido e não pode cair sobre outra construção ativa.
    for (const c of cells) {
      if (!this._isTileWalkable(c.x, c.y)) throw new Error('Não é possível construir muro neste terreno');
      if (this._isTileOccupiedByBuilding(c.x, c.y)) throw new Error('Não é possível construir muro sobre outra construção');
    }

    const config = BUILDING_CONFIGS.wall;
    const totalCost: BuildingCost = {};
    (Object.keys(config.cost) as (keyof BuildingCost)[]).forEach(k => {
      totalCost[k] = (config.cost[k] ?? 0) * cells.length;
    });
    if (!player.resources.canAfford(totalCost)) {
      throw new Error('Recursos insuficientes para construir o muro');
    }

    // Um segmento de muro independente por tile (todos em construção).
    const hpMult = ERA_HP_MULT[player.era] ?? 1.0;
    const segments = cells.map(c => {
      const seg = new PlayerBuilding(uuidv4(), playerId, 'wall', c.x, c.y, hpMult);
      this._playerBuildings.set(seg.id, seg);
      return seg;
    });
    this._players.set(playerId, {
      ...player,
      resources: player.resources.subtract(totalCost),
    });

    // O aldeão percorre a muralha a partir da ponta mais próxima dele,
    // construindo peça por peça (alvo atual + fila do restante).
    const builder = this._findBuilder(playerId, villagerId, cells[0].x, cells[0].y, 1, 1);
    if (builder) {
      const ordered = this._orderSegmentsFromBuilder(segments, builder.x, builder.y);
      const first = ordered[0];
      const dest = this._adjacentTile(first.x, first.y, 1, 1);
      if (dest) {
        builder.commandConstruct(first.id, dest.x, dest.y);
        builder.setConstructQueue(ordered.slice(1).map(s => s.id));
      }
    }
  }

  /** Ordena os segmentos a partir da ponta da linha mais próxima do aldeão. */
  private _orderSegmentsFromBuilder(segments: PlayerBuilding[], bx: number, by: number): PlayerBuilding[] {
    if (segments.length <= 1) return segments;
    const first = segments[0];
    const last = segments[segments.length - 1];
    const dFirst = Math.abs(first.x - bx) + Math.abs(first.y - by);
    const dLast = Math.abs(last.x - bx) + Math.abs(last.y - by);
    return dLast < dFirst ? [...segments].reverse() : segments;
  }

  /** Move o aldeão para o próximo segmento da fila (pulando os já concluídos). */
  private _advanceConstructQueue(villager: Villager): void {
    let nextId = villager.dequeueConstruct();
    while (nextId) {
      const next = this._playerBuildings.get(nextId);
      if (next && !next.isComplete) {
        const dest = this._adjacentTile(next.x, next.y, next.width, next.height);
        if (dest) { villager.continueConstruct(next.id, dest.x, dest.y); return; }
      }
      nextId = villager.dequeueConstruct();
    }
    villager.setIdle();
  }

  /**
   * Converte um arrasto (início→fim) em uma linha reta de tiles numa das 8 direções
   * isométricas. Linhas fora desses eixos são encaixadas no eixo mais próximo —
   * para outros formatos o jogador quebra em vários muros.
   */
  private _wallCells(startX: number, startY: number, endX: number, endY: number): { x: number; y: number }[] {
    const MAX_SEGMENTS = 25; // limite de segurança para um único muro
    const dxRaw = endX - startX;
    const dyRaw = endY - startY;
    const adx = Math.abs(dxRaw);
    const ady = Math.abs(dyRaw);
    if (adx === 0 && ady === 0) return [{ x: startX, y: startY }];

    const sx = Math.sign(dxRaw);
    const sy = Math.sign(dyRaw);
    let stepX: number, stepY: number, length: number;
    if (ady * 2 <= adx)      { stepX = sx; stepY = 0;  length = adx + 1; }       // horizontal
    else if (adx * 2 <= ady) { stepX = 0;  stepY = sy; length = ady + 1; }       // vertical
    else                     { stepX = sx; stepY = sy; length = Math.max(adx, ady) + 1; } // diagonal

    length = Math.min(length, MAX_SEGMENTS);
    const cells: { x: number; y: number }[] = [];
    for (let k = 0; k < length; k++) cells.push({ x: startX + k * stepX, y: startY + k * stepY });
    return cells;
  }

  /**
   * Constrói um Portão sobre um segmento de muro existente do jogador. O Portão
   * ocupa o mesmo tile do muro e cria uma passagem que só as tropas do dono
   * atravessam. Falha se não houver muro do jogador no local.
   */
  placeGate(playerId: string, x: number, y: number, villagerId?: string): void {
    const player = this._players.get(playerId);
    if (!player) throw new Error('Jogador não encontrado');

    const wall = this._wallOwnedAt(playerId, x, y);
    if (!wall) throw new Error('O Portão só pode ser construído sobre um muro');
    if (!wall.isComplete) throw new Error('O Portão só pode ser construído sobre um muro concluído');
    if (this._gateAt(x, y)) throw new Error('Já existe um Portão neste local');

    const config = BUILDING_CONFIGS.gate;
    if (!player.resources.canAfford(config.cost)) {
      throw new Error(`Recursos insuficientes para construir ${config.label}`);
    }

    // O Portão substitui o segmento de muro: remove o segmento e ocupa o tile.
    this._playerBuildings.delete(wall.id);

    const hpMult = ERA_HP_MULT[player.era] ?? 1.0;
    const gate = new PlayerBuilding(uuidv4(), playerId, 'gate', x, y, hpMult);
    this._playerBuildings.set(gate.id, gate);
    this._players.set(playerId, {
      ...player,
      resources: player.resources.subtract(config.cost),
    });

    const builder = this._findBuilder(playerId, villagerId, x, y, 1, 1);
    if (builder) {
      const dest = this._adjacentTile(x, y, 1, 1);
      if (dest) builder.commandConstruct(gate.id, dest.x, dest.y);
    }
  }

  private _nearestCell(cells: { x: number; y: number }[], x: number, y: number): { x: number; y: number } {
    let best = cells[0];
    let bestD = Infinity;
    for (const c of cells) {
      const d = Math.abs(c.x - x) + Math.abs(c.y - y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  advanceTick(): void {
    // Partida encerrada: tudo congelado, nenhuma ação é processada.
    if (this._gameOver) return;

    this._tick++;

    // Bloqueio sensível ao dono: um Portão aliado abre passagem para as tropas do
    // seu dono, mas continua sendo barreira para inimigos.
    const isBlockedFor = (ownerId: string, x: number, y: number) =>
      !this._isTileWalkable(x, y) || this._isTileBlockedByCompleteBuildingFor(ownerId, x, y);

    // ── Projéteis: cada flecha persegue o alvo e causa dano ao atingi-lo ───────
    for (const [id, p] of this._projectiles) {
      const tpos = this._getTargetCenter(p.targetId, p.targetKind);
      if (!tpos) { this._projectiles.delete(id); continue; } // alvo sumiu → flecha some
      p.tx = tpos.x; p.ty = tpos.y;
      const dx = tpos.x - p.x, dy = tpos.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d <= ARROW_SPEED) {
        this._applyDamage(p.targetId, p.targetKind, p.damage); // dano no impacto
        this._projectiles.delete(id);
      } else {
        p.x += (dx / d) * ARROW_SPEED;
        p.y += (dy / d) * ARROW_SPEED;
      }
    }

    // ── Movement (fractional tiles per tick — handled inside stepTowardTarget) ─
    for (const villager of this._villagers.values()) {
      if (villager.state !== 'moving') continue;
      villager.stepTowardTarget((x, y) => isBlockedFor(villager.ownerId, x, y));
    }

    // ── Construction / Repair ─────────────────────────────────────────────────
    // A mesma ordem ("constructing") ergue uma construção inacabada ou repara uma
    // já concluída e danificada — em ambos o aldeão martela (animação "hammer").
    for (const villager of this._villagers.values()) {
      if (villager.state !== 'constructing' || !villager.constructTargetId) continue;
      const building = this._playerBuildings.get(villager.constructTargetId);
      if (!building) { this._advanceConstructQueue(villager); continue; }
      if (!building.isComplete) {
        building.tickConstruction();
        // Segmento concluído: segue para o próximo da fila (muralha peça por peça).
        if (building.isComplete) this._advanceConstructQueue(villager);
      } else if (building.needsRepair) {
        if (building.repair(building.repairPerTick)) this._advanceConstructQueue(villager);
      } else {
        this._advanceConstructQueue(villager);
      }
    }

    // ── Combat ───────────────────────────────────────────────────────────────
    for (const attacker of this._villagers.values()) {
      if (attacker.state !== 'attacking' || !attacker.attackTargetId) continue;
      const cfg = attacker.config;

      let curId = attacker.attackTargetId;
      let curKind = attacker.attackTargetKind!;
      let targetPos = this._getTargetCenter(curId, curKind);

      // Alvo atual sumiu — se era apenas um obstáculo, volta a mirar o alvo final.
      if (!targetPos && attacker.attackGoalId && curId !== attacker.attackGoalId) {
        attacker.revertAttackToGoal();
        curId = attacker.attackTargetId!;
        curKind = attacker.attackTargetKind!;
        targetPos = this._getTargetCenter(curId, curKind);
      }
      if (!targetPos) { attacker.setIdle(); continue; } // alvo final também sumiu

      // Distância até o TILE mais próximo do alvo (não o centro). Assim o atacante
      // para na borda da construção em vez de entrar nela e ficar preso.
      const dist = this._distToTarget(attacker.x, attacker.y, curId, curKind);

      const inRange = dist <= cfg.attackRange;
      attacker.setAttackInRange(inRange);

      if (inRange) {
        // In range: deal damage on cooldown (dano escalado pela era do atacante)
        attacker.incrementAttackCounter();
        if (attacker.attackTickCounter >= cfg.attackCooldownTicks) {
          this._applyDamage(curId, curKind, attacker.attackDamage);
          attacker.resetAttackCounter();
        }
        continue;
      }

      // Fora de alcance: procurar uma rota até o alvo, desviando de obstáculos.
      // O tile do próprio alvo é tratado como livre para que o A* chegue até ele.
      const ax = Math.round(attacker.x);
      const ay = Math.round(attacker.y);
      const targetTiles = this._targetTiles(curId, curKind);
      const blockedForPath = (x: number, y: number) =>
        targetTiles.has(this._tileKey(x, y)) ? false : isBlockedFor(attacker.ownerId, x, y);

      const path = findPath(ax, ay, Math.round(targetPos.x), Math.round(targetPos.y), blockedForPath);
      if (path.length > 0) {
        // Avança suavemente em direção ao próximo tile da rota.
        const next = path[0];
        const ddx = next.x - attacker.x;
        const ddy = next.y - attacker.y;
        const d = Math.hypot(ddx, ddy) || 1;
        const speed = attacker.moveSpeedTiles;
        if (d <= speed) attacker.nudge(ddx, ddy);
        else attacker.nudge((ddx / d) * speed, (ddy / d) * speed);
      } else {
        // Alvo inacessível: identificar a estrutura destrutível que bloqueia o
        // caminho e passar a atacá-la automaticamente.
        const obstacle = this._findBlockingObstacle(ax, ay, targetPos, attacker.ownerId);
        if (obstacle && obstacle.id !== curId) {
          attacker.redirectAttackTo(obstacle.id, 'building');
        }
        // Sem obstáculo destrutível alcançável: a unidade aguarda.
      }
    }

    // ── Colisão suave: separa unidades que se sobrepõem (não empilham) ─────────
    this._resolveUnitCollisions();

    // Uma Torre Principal foi destruída? Encerra a partida imediatamente,
    // congelando o estado atual (sem mover/treinar/limpar entidades).
    if (this._checkGameOver()) return;

    // ── Engajamento automático: unidades militares ociosas atacam o inimigo mais
    // próximo dentro da percepção. Ao matar o alvo voltam a ficar ociosas e, no
    // tick seguinte, procuram o próximo — até não haver mais inimigos por perto. ─
    for (const unit of this._villagers.values()) {
      if (unit.state !== 'idle' || unit.unitType === 'villager') continue; // só militares
      const enemy = this._findNearestEnemyUnitInPerception(unit);
      if (enemy) unit.commandAttack(enemy.id, 'unit');
    }

    // ── Chegada em construções: torre→guarnição, Fazenda→lavoura (visível), demais→entra ─
    const toEnter: Villager[] = [];   // entra na construção (some do mapa)
    const toFarm: Villager[] = [];    // fica trabalhando na lavoura (visível)
    for (const v of this._villagers.values()) {
      if (!v.pendingEnterBuildingId || v.state === 'moving') continue;
      const b = this._playerBuildings.get(v.pendingEnterBuildingId);
      const adjacent = !!b && b.occupiedTiles.some(t =>
        Math.max(Math.abs(t.x - v.x), Math.abs(t.y - v.y)) <= 1);
      if (b && b.isComplete && adjacent) {
        if (b.type === 'watchtower' && v.unitType === 'archer'
            && (this._garrisons.get(b.id)?.length ?? 0) < TOWER_GARRISON_MAX) {
          toEnter.push(v);
        } else if (b.type === 'farm' && v.unitType === 'villager'
            && this._farmWorkerCount(b.id) < b.occupantCapacity) {
          toFarm.push(v);
        } else if (b.isProduction && v.unitType === 'villager'
            && (this._occupants.get(b.id)?.length ?? 0) < b.occupantCapacity) {
          toEnter.push(v);
        } else {
          v.clearPendingEnter();
        }
      } else {
        v.clearPendingEnter(); // destruída/incompatível ou inalcançável
      }
    }
    for (const v of toEnter) this._enterBuilding(v);
    for (const v of toFarm) v.startFarming(v.pendingEnterBuildingId!);

    // ── Combate das torres guarnecidas (atira N flechas = N arqueiros) ─────────
    const archerCfg = UNIT_CONFIGS.archer;
    for (const tower of this._playerBuildings.values()) {
      if (tower.type !== 'watchtower' || !tower.isComplete) continue;
      const garrison = this._garrisons.get(tower.id);
      if (!garrison || garrison.length === 0) { tower.clearTowerTarget(); continue; }
      tower.tickTowerCooldown();
      const cx = tower.x + 0.5, cy = tower.y + 0.5;
      const targetId = this._findEnemyUnitNear(cx, cy, archerCfg.attackRange, tower.ownerId);
      if (!targetId) { tower.clearTowerTarget(); continue; }
      tower.setTowerTarget(targetId);
      if (tower.canTowerFire) {
        // Cada arqueiro guarnecido dispara a SUA própria flecha (1 arqueiro = 1 flecha,
        // 3 arqueiros = 3 flechas simultâneas). O dano de cada uma é aplicado no impacto.
        const cx = tower.x + 0.5, cy = tower.y + 0.5;
        for (const archer of garrison) {
          this._spawnArrow(cx, cy, targetId, 'unit', tower.ownerId, archer.attackDamage);
        }
        tower.resetTowerCooldown(archerCfg.attackCooldownTicks);
      }
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
    // Só produz se houver ≥1 aldeão trabalhando dentro. A produção escala com o
    // número de ocupantes e com a era, mas fica cada vez mais difícil a cada ciclo.
    if (this._tick % BUILDING_GEN_INTERVAL_TICKS === 0) {
      for (const building of this._playerBuildings.values()) {
        if (!building.isComplete || !building.isProduction) continue;
        const occupants = this._occupantCount(building);
        if (occupants === 0) continue; // sem trabalhadores → produção parada
        const gen = building.config.generates!;
        const player = this._players.get(building.ownerId);
        if (!player) continue;
        const eraMult = ERA_GEN_MULT[player.era] ?? 1.0;
        const scale = building.productionScale;
        const scaledGen: Record<string, number> = {};
        for (const [k, v] of Object.entries(gen)) {
          scaledGen[k] = Math.floor((v as number) * eraMult * scale * occupants);
        }
        this._players.set(building.ownerId, {
          ...player,
          resources: player.resources.add(scaledGen),
        });
        building.decayProduction();
      }
    }

    // ── Town center training ──────────────────────────────────────────────────
    for (const tc of this._townCenters.values()) {
      if (!tc.isTraining) continue;
      const done = tc.tickTraining();
      if (done) {
        this._spawnTrainedUnit(tc.ownerId, tc.anchorX, tc.anchorY, tc.trainingUnitType ?? 'villager');
        // Inicia automaticamente a próxima unidade da fila, sem novo comando.
        const next = tc.dequeueNext();
        if (next) {
          const era = this._players.get(tc.ownerId)?.era ?? 1;
          tc.startTraining(next, this._trainTicksFor(next, era));
        }
      }
    }

    // ── Death transition: hp<=0 → 'dying' state; linger DYING_LINGER_TICKS
    // ticks so the client can play the death animation, then remove. ──────────
    for (const v of this._villagers.values()) {
      if (v.isDead && !v.isDying) v.enterDying();
      else if (v.isDying) v.tickDying();
    }
    for (const [id, v] of this._villagers) {
      if (v.shouldBeRemoved) this._villagers.delete(id);
    }
    for (const [id, b] of this._playerBuildings) {
      if (b.isDestroyed) {
        // Construção destruída: libera quem estiver dentro/trabalhando antes de remover.
        if (this._garrisons.has(id)) this._ejectFrom(this._garrisons, id);
        if (this._occupants.has(id)) this._ejectFrom(this._occupants, id);
        if (b.type === 'farm') {
          for (const v of this._villagers.values()) if (v.farmTargetId === id) v.commandIdle();
        }
        this._playerBuildings.delete(id);
      }
    }
    for (const [id, tc] of this._townCenters) {
      if (tc.isDestroyed) this._townCenters.delete(id);
    }
  }

  /**
   * Detecta destruição de uma Torre Principal. Define a partida como encerrada e
   * o vencedor como o jogador cuja torre sobreviveu. Retorna true se encerrou.
   */
  private _checkGameOver(): boolean {
    if (this._gameOver) return true;
    let destroyedOwner: string | null = null;
    for (const tc of this._townCenters.values()) {
      if (tc.isDestroyed) { destroyedOwner = tc.ownerId; break; }
    }
    if (destroyedOwner === null) return false;
    this._gameOver = true;
    for (const p of this._players.values()) {
      if (p.id !== destroyedOwner) { this._winnerId = p.id; break; }
    }
    return true;
  }

  /** População atual = todas as unidades do jogador (no campo + dentro de construções). */
  populationOf(playerId: string): number {
    let count = 0;
    for (const v of this._villagers.values()) if (v.ownerId === playerId) count++;
    for (const list of this._garrisons.values()) for (const u of list) if (u.ownerId === playerId) count++;
    for (const list of this._occupants.values()) for (const u of list) if (u.ownerId === playerId) count++;
    return count;
  }

  /** Limite de população = base da Torre Principal + bônus das Casas concluídas. */
  populationCapOf(playerId: string): number {
    let cap = 0;
    for (const tc of this._townCenters.values()) {
      if (tc.ownerId === playerId && !tc.isDestroyed) cap += BASE_POPULATION;
    }
    for (const b of this._playerBuildings.values()) {
      if (b.ownerId === playerId && b.type === 'house' && b.isComplete) {
        cap += b.config.populationBonus ?? 0;
      }
    }
    return Math.min(cap, POPULATION_HARD_CAP);
  }

  toStateSnapshot(): GameStateSnapshot {
    return {
      sessionId: this._id,
      tick: this._tick,
      gameOver: this._gameOver,
      winnerId: this._winnerId,
      players: Array.from(this._players.values()).map(p => ({
        id: p.id,
        name: p.name,
        resources: p.resources.toJSON(),
        era: p.era,
        population: this.populationOf(p.id),
        populationMax: this.populationCapOf(p.id),
      })),
      villagers: Array.from(this._villagers.values()).map(v => v.toJSON()),
      townCenters: Array.from(this._townCenters.values()).map(tc => tc.toJSON()),
      resourceNodes: Array.from(this._resourceNodes.values())
        .filter(n => !n.isDepleted)
        .map(n => n.toJSON()),
      playerBuildings: Array.from(this._playerBuildings.values()).map(b => {
        if (b.type === 'watchtower') return b.toJSON(this._garrisons.get(b.id)?.length);
        if (b.isProduction) {
          const occupants = this._occupantCount(b);
          return { ...b.toJSON(occupants), ...this._productionInfo(b, occupants) };
        }
        return b.toJSON();
      }),
      projectiles: Array.from(this._projectiles.values()).map(p => ({ id: p.id, x: p.x, y: p.y, tx: p.tx, ty: p.ty })),
    };
  }

  /** Taxa de produção atual (recurso/segundo) e eficiência de uma construção. */
  private _productionInfo(b: PlayerBuilding, occupants: number): {
    prodResource: 'gold' | 'wood' | 'stone' | 'food'; prodPerSec: number; efficiency: number;
  } {
    const gen = b.config.generates!;
    const [resource, baseAmount] = Object.entries(gen)[0] as ['gold' | 'wood' | 'stone' | 'food', number];
    const eraMult = ERA_GEN_MULT[this._players.get(b.ownerId)?.era ?? 1] ?? 1.0;
    const perCycle = Math.floor(baseAmount * eraMult * b.productionScale * occupants);
    const cycleSeconds = BUILDING_GEN_INTERVAL_TICKS / 4; // 4 ticks por segundo
    return { prodResource: resource, prodPerSec: perCycle / cycleSeconds, efficiency: b.productionScale };
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
    for (const tc of this._townCenters.values()) {
      for (const t of tc.occupiedTiles) {
        if (t.x === x && t.y === y) return true;
      }
    }
    return false;
  }

  /**
   * Como _isTileBlockedByCompleteBuilding, mas um Portão concluído do próprio dono
   * abre passagem para suas tropas (retorna não-bloqueado). Para inimigos o tile
   * continua sendo barreira (muro e/ou portão).
   */
  private _isTileBlockedByCompleteBuildingFor(ownerId: string, x: number, y: number): boolean {
    if (this._hasFriendlyCompleteGate(ownerId, x, y)) return false;
    return this._isTileBlockedByCompleteBuilding(x, y);
  }

  private _tileKey(x: number, y: number): number { return x * 100_000 + y; }

  /** Tiles ocupados por um alvo (unidade, construção ou centro de cidade). */
  private _targetTiles(id: string, kind: AttackTargetKind): Set<number> {
    const set = new Set<number>();
    if (kind === 'unit') {
      const v = this._villagers.get(id);
      if (v) set.add(this._tileKey(Math.round(v.x), Math.round(v.y)));
    } else if (kind === 'building') {
      const b = this._playerBuildings.get(id);
      if (b) for (const t of b.occupiedTiles) set.add(this._tileKey(t.x, t.y));
    } else {
      const tc = this._townCenters.get(id);
      if (tc) for (const t of tc.occupiedTiles) set.add(this._tileKey(t.x, t.y));
    }
    return set;
  }

  private _completeBuildingAt(x: number, y: number): PlayerBuilding | null {
    for (const b of this._playerBuildings.values()) {
      if (!b.isComplete) continue;
      for (const t of b.occupiedTiles) if (t.x === x && t.y === y) return b;
    }
    return null;
  }

  /**
   * A partir da posição da unidade, faz uma busca em largura pelas casas
   * alcançáveis e devolve a estrutura destrutível inimiga (muro/portão/prédio)
   * que faz fronteira com essa área e está mais próxima do alvo — ou seja, o
   * obstáculo a derrubar para abrir caminho.
   */
  private _findBlockingObstacle(
    sx: number, sy: number,
    targetPos: { x: number; y: number },
    ownerId: string,
  ): PlayerBuilding | null {
    const blocked = (x: number, y: number) =>
      !this._isTileWalkable(x, y) || this._isTileBlockedByCompleteBuildingFor(ownerId, x, y);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const visited = new Set<number>([this._tileKey(sx, sy)]);
    const queue: { x: number; y: number }[] = [{ x: sx, y: sy }];
    let best: PlayerBuilding | null = null;
    let bestD = Infinity;
    let iter = 0;

    while (queue.length > 0 && iter++ < 8000) {
      const cur = queue.shift()!;
      for (const [dx, dy] of dirs) {
        // Sem corte de quina nas diagonais (consistente com o A*).
        if (dx !== 0 && dy !== 0 && (blocked(cur.x + dx, cur.y) || blocked(cur.x, cur.y + dy))) continue;
        const nx = cur.x + dx, ny = cur.y + dy;
        const key = this._tileKey(nx, ny);
        if (visited.has(key)) continue;
        visited.add(key);
        if (blocked(nx, ny)) {
          const b = this._completeBuildingAt(nx, ny);
          if (b && b.ownerId !== ownerId) {
            const d = Math.max(Math.abs(nx - targetPos.x), Math.abs(ny - targetPos.y));
            if (d < bestD) { bestD = d; best = b; }
          }
          continue; // não atravessa casa bloqueada
        }
        queue.push({ x: nx, y: ny });
      }
    }
    return best;
  }

  private _hasFriendlyCompleteGate(ownerId: string, x: number, y: number): boolean {
    for (const b of this._playerBuildings.values()) {
      if (b.type !== 'gate' || !b.isComplete || b.ownerId !== ownerId) continue;
      for (const t of b.occupiedTiles) if (t.x === x && t.y === y) return true;
    }
    return false;
  }

  private _wallOwnedAt(playerId: string, x: number, y: number): PlayerBuilding | null {
    for (const b of this._playerBuildings.values()) {
      if (b.type !== 'wall' || b.ownerId !== playerId) continue;
      for (const t of b.occupiedTiles) if (t.x === x && t.y === y) return b;
    }
    return null;
  }

  private _gateAt(x: number, y: number): PlayerBuilding | null {
    for (const b of this._playerBuildings.values()) {
      if (b.type !== 'gate') continue;
      for (const t of b.occupiedTiles) if (t.x === x && t.y === y) return b;
    }
    return null;
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

  /** Menor distância Chebyshev de (x,y) até qualquer tile ocupado pelo alvo. */
  private _distToTarget(x: number, y: number, targetId: string, kind: AttackTargetKind): number {
    if (kind === 'unit') {
      const v = this._villagers.get(targetId);
      return v ? Math.max(Math.abs(x - v.x), Math.abs(y - v.y)) : Infinity;
    }
    const tiles = kind === 'building'
      ? this._playerBuildings.get(targetId)?.occupiedTiles
      : this._townCenters.get(targetId)?.occupiedTiles;
    if (!tiles || tiles.length === 0) return Infinity;
    let min = Infinity;
    for (const t of tiles) {
      const d = Math.max(Math.abs(x - t.x), Math.abs(y - t.y));
      if (d < min) min = d;
    }
    return min;
  }

  /** Lança uma flecha da origem em direção ao alvo (dano aplicado ao atingir). */
  private _spawnArrow(fromX: number, fromY: number, targetId: string, kind: AttackTargetKind, ownerId: string, damage: number): void {
    const id = uuidv4();
    this._projectiles.set(id, {
      id, ownerId, x: fromX, y: fromY, targetId, targetKind: kind, damage, tx: fromX, ty: fromY,
    });
  }

  private _applyDamage(targetId: string, kind: AttackTargetKind, amount: number): void {
    if (kind === 'unit') this._villagers.get(targetId)?.takeDamage(amount);
    else if (kind === 'building') this._playerBuildings.get(targetId)?.takeDamage(amount);
    else if (kind === 'town_center') this._townCenters.get(targetId)?.takeDamage(amount);
  }

  /** Inimigo (unidade) mais próximo dentro do raio de percepção, para engajamento automático. */
  private _findNearestEnemyUnitInPerception(unit: Villager): { id: string; kind: AttackTargetKind } | null {
    let best: { id: string; kind: AttackTargetKind } | null = null;
    let bestDist = DETECTION_RADIUS + 1e-3;
    for (const v of this._villagers.values()) {
      if (v.ownerId === unit.ownerId || v.isDead || v.isDying) continue;
      const d = Math.max(Math.abs(v.x - unit.x), Math.abs(v.y - unit.y));
      if (d < bestDist) { bestDist = d; best = { id: v.id.value, kind: 'unit' }; }
    }
    return best;
  }

  /**
   * Colisão suave entre unidades: empurra para os lados pares que se sobrepõem,
   * sem entrar em terreno/parede bloqueada. Evita o empilhamento e faz as tropas
   * se distribuírem naturalmente ao redor dos inimigos durante o combate.
   * Aplica-se a unidades em movimento/combate/ociosas (não aos trabalhadores).
   */
  private _resolveUnitCollisions(): void {
    const blocked = (ownerId: string, x: number, y: number) =>
      !this._isTileWalkable(x, y) || this._isTileBlockedByCompleteBuildingFor(ownerId, x, y);
    const push = (u: Villager, dx: number, dy: number) => {
      if (blocked(u.ownerId, Math.round(u.x + dx), Math.round(u.y + dy))) return;
      u.nudge(dx, dy);
    };
    const units = Array.from(this._villagers.values()).filter(u =>
      u.state === 'moving' || u.state === 'attacking' || u.state === 'idle');
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i], b = units[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= UNIT_MIN_SEPARATION) continue;
        if (d < 1e-4) { dx = (i % 2 ? 0.02 : -0.02); dy = 0.02; d = Math.hypot(dx, dy); } // sobrepostos
        const overlap = (UNIT_MIN_SEPARATION - d) / 2;
        const nx = dx / d, ny = dy / d;
        push(a, -nx * overlap, -ny * overlap);
        push(b, nx * overlap, ny * overlap);
      }
    }
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

  /** Todos os tiles livres ao redor de uma construção (para desembarcar guarnição). */
  private _tilesAroundBuilding(bx: number, by: number, bw: number, bh: number): { x: number; y: number }[] {
    const candidates: { x: number; y: number }[] = [];
    for (let dy = 0; dy < bh; dy++) candidates.push({ x: bx + bw, y: by + dy });
    for (let dx = 0; dx < bw; dx++) candidates.push({ x: bx + dx, y: by + bh });
    for (let dy = 0; dy < bh; dy++) candidates.push({ x: bx - 1, y: by + dy });
    for (let dx = 0; dx < bw; dx++) candidates.push({ x: bx + dx, y: by - 1 });
    return candidates.filter(c =>
      this._isTileWalkable(c.x, c.y) && !this._isTileBlockedByCompleteBuilding(c.x, c.y));
  }

  /** Coloca a unidade dentro da construção (sai do campo) — torre ou produção. */
  private _enterBuilding(unit: Villager): void {
    const buildingId = unit.pendingEnterBuildingId;
    if (!buildingId) return;
    const building = this._playerBuildings.get(buildingId);
    unit.clearPendingEnter();
    this._villagers.delete(unit.id.value);
    const map = building && building.type === 'watchtower' ? this._garrisons : this._occupants;
    const list = map.get(buildingId) ?? [];
    list.push(unit);
    map.set(buildingId, list);
  }

  /** Trabalhadores de uma construção de produção (Fazenda conta aldeões visíveis nas lavouras). */
  private _occupantCount(b: PlayerBuilding): number {
    if (b.type === 'farm') return this._farmWorkerCount(b.id);
    return this._occupants.get(b.id)?.length ?? 0;
  }

  /** Aldeões já trabalhando na lavoura (chegaram ao quadrado). */
  private _farmWorkerCount(farmId: string): number {
    let n = 0;
    for (const v of this._villagers.values()) if (v.farmTargetId === farmId) n++;
    return n;
  }

  /** Aldeões trabalhando + a caminho da lavoura (para checar capacidade/quadrados). */
  private _farmReservedCount(farmId: string): number {
    let n = 0;
    for (const v of this._villagers.values()) {
      if (v.farmTargetId === farmId || v.pendingEnterBuildingId === farmId) n++;
    }
    return n;
  }

  /** Um quadrado de plantação livre (perímetro do 3×3, exceto o moinho central). */
  private _freeFarmSquare(farm: PlayerBuilding): { x: number; y: number } | null {
    const taken = new Set<string>();
    for (const v of this._villagers.values()) {
      if (v.farmTargetId === farm.id) taken.add(`${Math.round(v.x)},${Math.round(v.y)}`);
      else if (v.pendingEnterBuildingId === farm.id && v.moveTargetX !== null && v.moveTargetY !== null) {
        taken.add(`${v.moveTargetX},${v.moveTargetY}`);
      }
    }
    const millX = farm.x + 1, millY = farm.y + 1; // centro 3×3 = moinho
    for (const t of farm.occupiedTiles) {
      if (t.x === millX && t.y === millY) continue;        // pula o moinho
      if (taken.has(`${t.x},${t.y}`)) continue;
      if (!this._isTileWalkable(t.x, t.y)) continue;
      return { x: t.x, y: t.y };
    }
    return null;
  }

  /** Tira todas as unidades de dentro de uma construção e as recoloca em volta. */
  private _ejectFrom(map: Map<string, Villager[]>, buildingId: string): void {
    const list = map.get(buildingId);
    if (!list || list.length === 0) return;
    const building = this._playerBuildings.get(buildingId);
    const spots = building
      ? this._tilesAroundBuilding(building.x, building.y, building.width, building.height)
      : [];
    list.forEach((unit, i) => {
      const spot = spots[i % spots.length] ?? (building ? { x: building.x, y: building.y } : { x: unit.x, y: unit.y });
      unit.placeAt(spot.x, spot.y);
      this._villagers.set(unit.id.value, unit);
    });
    map.delete(buildingId);
    building?.clearTowerTarget();
  }

  /** Id do inimigo (unidade) mais próximo dentro do alcance a partir de um ponto. */
  private _findEnemyUnitNear(cx: number, cy: number, range: number, ownerId: string): string | null {
    let best: string | null = null;
    let bestD = range + 1;
    for (const v of this._villagers.values()) {
      if (v.ownerId === ownerId || v.isDead) continue;
      const d = Math.max(Math.abs(v.x - cx), Math.abs(v.y - cy));
      if (d <= range && d < bestD) { bestD = d; best = v.id.value; }
    }
    return best;
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
    const era = this._players.get(playerId)?.era ?? 1;
    const occupied = new Set(Array.from(this._villagers.values()).map(v => `${Math.round(v.x)},${Math.round(v.y)}`));
    for (const pos of candidates) {
      if (!occupied.has(`${pos.x},${pos.y}`) && this._isTileWalkable(pos.x, pos.y)) {
        const v = new Villager(VillagerId.generate(), playerId, pos.x, pos.y, unitType);
        v.setEra(era); // nova unidade já nasce com os bônus da era atual do dono
        this._villagers.set(v.id.value, v);
        return;
      }
    }
    const v = new Villager(VillagerId.generate(), playerId, tcAnchorX + 3, tcAnchorY, unitType);
    v.setEra(era);
    this._villagers.set(v.id.value, v);
  }
}

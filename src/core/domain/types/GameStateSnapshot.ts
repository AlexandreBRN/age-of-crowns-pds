export interface VillagerDTO {
  id: string;
  ownerId: string;
  unitType: 'villager' | 'archer' | 'cavalry';
  position: { x: number; y: number };       // rounded to integer tile (for hit-tests, fog, etc.)
  subPosition: { x: number; y: number };    // exact float position (for smooth rendering)
  hp: number;
  maxHp: number;
  state: 'idle' | 'moving' | 'gathering' | 'constructing' | 'attacking' | 'dying';
  moveTarget: { x: number; y: number } | null;
  gatherTarget: string | null;
  constructTarget: string | null;
  attackTargetId: string | null;
  attackTargetKind: 'unit' | 'building' | 'town_center' | null;
  attackInRange: boolean;                   // true só quando o alvo está dentro do alcance (anima ataque); false = ainda se aproximando
  dyingTicks: number;
}

export interface TownCenterDTO {
  id: string;
  ownerId: string;
  anchorPosition: { x: number; y: number };
  isTraining: boolean;
  trainTicksRemaining: number;
  trainingUnitType: 'villager' | 'archer' | 'cavalry' | null;
  hp: number;
  maxHp: number;
}

export interface ResourceNodeDTO {
  id: string;
  type: string;
  position: { x: number; y: number };
  remaining: number;
}

export interface PlayerSnapshotDTO {
  id: string;
  name: string;
  resources: { gold: number; wood: number; stone: number; food: number };
  era: number;
}

export interface PlayerBuildingDTO {
  id: string;
  ownerId: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: 'under_construction' | 'complete';
  constructionTicksRemaining: number;
  constructionTotalTicks: number;
  hp: number;
  maxHp: number;
  cells?: { x: number; y: number }[];       // footprint contínuo (muros) — presente só em muros
  garrison?: number;                        // arqueiros guarnecidos (só torres de vigia)
  garrisonMax?: number;                     // capacidade de guarnição
  towerTargetId?: string | null;            // alvo atual da torre (para desenhar as flechas)
  occupants?: number;                       // aldeões trabalhando dentro (construções de produção)
  occupantsMax?: number;                    // capacidade de trabalhadores
  producing?: boolean;                      // true se há ≥1 aldeão produzindo
}

export interface GameStateSnapshot {
  sessionId: string;
  tick: number;
  gameOver: boolean;
  winnerId: string | null;            // jogador cuja Torre Principal sobreviveu (vencedor), ou null
  players: PlayerSnapshotDTO[];
  villagers: VillagerDTO[];
  townCenters: TownCenterDTO[];
  resourceNodes: ResourceNodeDTO[];
  playerBuildings: PlayerBuildingDTO[];
}

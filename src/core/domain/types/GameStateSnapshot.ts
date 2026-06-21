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
  trainQueue: ('villager' | 'archer' | 'cavalry')[];   // unidades aguardando na fila
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
  population: number;          // unidades atuais do jogador
  populationMax: number;       // limite (Torre Principal + Casas)
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
  prodResource?: 'gold' | 'wood' | 'stone' | 'food';  // recurso gerado
  prodPerSec?: number;                      // taxa de produção atual (recursos/segundo)
  efficiency?: number;                      // eficiência atual da produção (0..1)
}

export interface ProjectileDTO {
  id: string;
  x: number; y: number;               // posição atual (tiles)
  fx: number; fy: number;             // posição de lançamento (arco/orientação)
  tx: number; ty: number;             // posição do alvo (direção do voo)
  elevated: boolean;                  // sai do alto da torre (true) ou da mão do arqueiro (false)
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
  projectiles: ProjectileDTO[];       // flechas em voo
}

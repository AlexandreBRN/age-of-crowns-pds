export interface VillagerDTO {
  id: string;
  ownerId: string;
  position: { x: number; y: number };
  state: 'idle' | 'moving' | 'gathering';
  moveTarget: { x: number; y: number } | null;
  gatherTarget: string | null;
}

export interface TownCenterDTO {
  id: string;
  ownerId: string;
  anchorPosition: { x: number; y: number };
  isTraining: boolean;
  trainTicksRemaining: number;
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
}

export interface PlayerBuildingDTO {
  id: string;
  ownerId: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GameStateSnapshot {
  sessionId: string;
  tick: number;
  players: PlayerSnapshotDTO[];
  villagers: VillagerDTO[];
  townCenters: TownCenterDTO[];
  resourceNodes: ResourceNodeDTO[];
  playerBuildings: PlayerBuildingDTO[];
}

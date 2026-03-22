export type TileType = 'grass' | 'dirt' | 'water';

export const TILE_WALKABLE: Record<TileType, boolean> = {
  grass: true,
  dirt: true,
  water: false,
};

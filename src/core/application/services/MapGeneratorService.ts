import { v4 as uuidv4 } from 'uuid';
import { TileType } from '../../domain/value-objects/TileType';
import { ResourceType } from '../../domain/entities/ResourceNode';
import { ResourceNodeSpec } from '../../domain/entities/GameSession';

export interface GeneratedMap {
  tiles: TileType[][];
  resourceNodes: ResourceNodeSpec[];
}

// Clear zones near spawn corners (no resources placed here)
const CLEAR_RADIUS = 12;
const CORNER_SPAWNS = [
  { x: 4, y: 4 },   // Player 1 base area
  { x: 94, y: 94 }, // Player 2 base area
];

export class MapGeneratorService {
  static generate(width = 100, height = 100): GeneratedMap {
    const tiles = this.buildTileGrid(width, height);
    const resourceNodes = this.placeResourceNodes(tiles, width, height);
    return { tiles, resourceNodes };
  }

  private static buildTileGrid(width: number, height: number): TileType[][] {
    const tiles: TileType[][] = [];

    for (let y = 0; y < height; y++) {
      const row: TileType[] = [];
      for (let x = 0; x < width; x++) {
        // Border = water
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
          row.push('water');
        } else {
          row.push('grass');
        }
      }
      tiles.push(row);
    }

    // Add dirt patches (scale with map size)
    const patchCount = Math.floor(width * height / 200);
    for (let i = 0; i < patchCount; i++) {
      const startX = 3 + Math.floor(Math.random() * (width - 6));
      const startY = 3 + Math.floor(Math.random() * (height - 6));
      const patchSize = 4 + Math.floor(Math.random() * 6);
      this.floodDirt(tiles, startX, startY, patchSize, width, height);
    }

    return tiles;
  }

  private static floodDirt(
    tiles: TileType[][],
    startX: number,
    startY: number,
    size: number,
    width: number,
    height: number,
  ): void {
    let x = startX;
    let y = startY;
    for (let i = 0; i < size; i++) {
      if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
        tiles[y][x] = 'dirt';
      }
      const dir = Math.floor(Math.random() * 4);
      if (dir === 0) x++;
      else if (dir === 1) x--;
      else if (dir === 2) y++;
      else y--;
    }
  }

  private static placeResourceNodes(
    tiles: TileType[][],
    width: number,
    height: number,
  ): ResourceNodeSpec[] {
    const nodes: ResourceNodeSpec[] = [];
    const occupied = new Set<string>();

    const place = (type: ResourceType, count: number) => {
      let placed = 0;
      let attempts = 0;
      while (placed < count && attempts < 500) {
        attempts++;
        const x = 2 + Math.floor(Math.random() * (width - 4));
        const y = 2 + Math.floor(Math.random() * (height - 4));
        const key = `${x},${y}`;

        if (occupied.has(key)) continue;
        if (tiles[y][x] === 'water') continue;
        if (this.isTooCloseToCorner(x, y)) continue;
        if (this.isTooCloseToExisting(x, y, nodes, 3)) continue;

        occupied.add(key);
        nodes.push({ id: uuidv4(), type, position: { x, y } });
        placed++;
      }
    };

    // Scale resource count with map size
    const scale = Math.round((width * height) / (40 * 40));
    place('gold',       Math.round(6  * scale));
    place('stone',      Math.round(5  * scale));
    place('wood',       Math.round(10 * scale));
    place('food_deer',  Math.round(5  * scale));
    place('food_berry', Math.round(6  * scale));

    return nodes;
  }

  private static isTooCloseToCorner(x: number, y: number): boolean {
    for (const corner of CORNER_SPAWNS) {
      const dist = Math.abs(x - corner.x) + Math.abs(y - corner.y);
      if (dist < CLEAR_RADIUS) return true;
    }
    return false;
  }

  private static isTooCloseToExisting(
    x: number,
    y: number,
    existing: ResourceNodeSpec[],
    minDist: number,
  ): boolean {
    for (const node of existing) {
      const dx = Math.abs(x - node.position.x);
      const dy = Math.abs(y - node.position.y);
      if (dx < minDist && dy < minDist) return true;
    }
    return false;
  }
}

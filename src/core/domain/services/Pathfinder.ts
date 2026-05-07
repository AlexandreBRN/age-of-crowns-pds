export interface PathTile { x: number; y: number; }

type Node = {
  x: number; y: number;
  g: number; f: number;
  parent: Node | null;
};

const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [ 1,  0, 10], [-1,  0, 10], [ 0,  1, 10], [ 0, -1, 10],
  [ 1,  1, 14], [ 1, -1, 14], [-1,  1, 14], [-1, -1, 14],
];

const octile = (x: number, y: number, gx: number, gy: number): number => {
  const dx = Math.abs(x - gx);
  const dy = Math.abs(y - gy);
  return Math.min(dx, dy) * 14 + Math.abs(dx - dy) * 10;
};

const k = (x: number, y: number): number => x * 1_000_003 + y;

/**
 * A* pathfinding on an 8-connected grid with corner-cutting prevention.
 * Returns the sequence of tiles from (startX,startY) → (goalX,goalY) excluding the start.
 * Returns [] if start equals goal, the goal is blocked, or no path is found within `maxIterations`.
 */
export function findPath(
  startX: number, startY: number,
  goalX: number, goalY: number,
  isBlocked: (x: number, y: number) => boolean,
  maxIterations = 5000,
): PathTile[] {
  if (startX === goalX && startY === goalY) return [];
  if (isBlocked(goalX, goalY)) return [];

  const open = new Map<number, Node>();
  const closed = new Map<number, Node>();

  open.set(k(startX, startY), {
    x: startX, y: startY, g: 0,
    f: octile(startX, startY, goalX, goalY),
    parent: null,
  });

  let iters = 0;
  while (open.size > 0 && iters++ < maxIterations) {
    let current: Node | null = null;
    let currentKey = -1;
    for (const [key, n] of open) {
      if (!current || n.f < current.f) { current = n; currentKey = key; }
    }
    if (!current) break;

    open.delete(currentKey);
    closed.set(currentKey, current);

    if (current.x === goalX && current.y === goalY) {
      const path: PathTile[] = [];
      let cur: Node | null = current;
      while (cur && cur.parent !== null) {
        path.unshift({ x: cur.x, y: cur.y });
        cur = cur.parent;
      }
      return path;
    }

    for (const [dx, dy, cost] of NEIGHBORS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (isBlocked(nx, ny)) continue;
      // No corner cutting on diagonals
      if (dx !== 0 && dy !== 0) {
        if (isBlocked(current.x + dx, current.y) || isBlocked(current.x, current.y + dy)) continue;
      }
      const nKey = k(nx, ny);
      const newG = current.g + cost;

      const existing = open.get(nKey) ?? closed.get(nKey);
      if (existing && newG >= existing.g) continue;

      const node: Node = {
        x: nx, y: ny, g: newG,
        f: newG + octile(nx, ny, goalX, goalY),
        parent: current,
      };

      closed.delete(nKey);
      open.set(nKey, node);
    }
  }

  return [];
}

// ─── Constants ────────────────────────────────────────────────────────────────
// Isometric 2:1 projection (classic AoE-style)
const TILE_W = 80;            // diamond width  (px)
const TILE_H = 40;            // diamond height (px)
const TILE   = TILE_W;        // legacy alias used to size upright sprites
const SPRITE_SCALE = TILE / 32;  // shape-drawing functions were authored for 32px tiles

// Iso projection helpers — world tile (tx, ty) ↔ screen pixel (sx, sy)
// World origin offset by `mh * TILE_W / 2` so the entire map fits in positive screen coords.
function worldToScreen(tx, ty) {
  const originX = mapHeight() * TILE_W / 2;
  return {
    sx: (tx - ty) * TILE_W / 2 + originX,
    sy: (tx + ty) * TILE_H / 2,
  };
}
function screenToWorld(sx, sy) {
  const originX = mapHeight() * TILE_W / 2;
  const a = (sx - originX) * 2 / TILE_W;  // tx - ty
  const b = sy * 2 / TILE_H;              // tx + ty
  return { tx: (a + b) / 2, ty: (b - a) / 2 };
}
function worldExtent() {
  const total = mapWidth() + mapHeight();
  return { w: total * TILE_W / 2, h: total * TILE_H / 2 };
}

const VISION_VILLAGER    = 5;   // tiles
const VISION_TOWN_CENTER = 9;   // tiles
const VISION_WATCHTOWER  = 8;   // tiles

// Client-side building definitions (mirrors server BUILDING_CONFIGS)
const BUILDING_DEFS = {
  wall:         { label:'Muro',           width:1, height:1, cost:{stone:2},           color:'#8a7060' },
  watchtower:   { label:'Torre de Vigia', width:1, height:1, cost:{stone:20,wood:10},   color:'#b09070' },
  lumber_camp:  { label:'Serraria',       width:2, height:2, cost:{wood:30,stone:5},    color:'#5a7030' },
  gold_mine:    { label:'Mina de Ouro',   width:2, height:2, cost:{stone:40,wood:20},   color:'#c09020' },
  farm:         { label:'Fazenda',        width:2, height:2, cost:{wood:25},            color:'#88a030' },
  stone_quarry: { label:'Pedreira',       width:2, height:2, cost:{wood:30,stone:10},   color:'#808080' },
};

// Unit configs (mirrors server UNIT_CONFIGS)
const UNIT_DEFS = {
  villager: { label:'Aldeão',    maxHp:50,  color:null,      trainCost:{food:50},         trainTicks:20 },
  archer:   { label:'Arqueiro',  maxHp:40,  color:'#40a860', trainCost:{food:50,wood:30}, trainTicks:24 },
  cavalry:  { label:'Cavaleiro', maxHp:80,  color:'#d08020', trainCost:{food:80,gold:50}, trainTicks:40 },
};

const COLORS = {
  tiles: {
    grass: ['#3d6b41', '#446f48', '#3a6640', '#4a7550'],
    dirt:  ['#7a5c3a', '#8a6845', '#6f5232', '#7d5e3d'],
    water: '#1e3a5f',
  },
  resources: {
    gold:       '#e8c040',
    stone:      '#9a9a9a',
    wood:       '#2d6b2d',
    food_deer:  '#c87840',
    food_berry: '#7a3a8a',
  },
  tc:       ['#c0392b', '#1a6aaa'],
  villager: ['#e05040', '#3080c0'],
  selected: '#f0d040',
  moveTarget:   'rgba(240,208,64,0.4)',
  gatherTarget: 'rgba(80,200,80,0.4)',
  fogUnexplored: 'rgba(0,0,0,1)',
  fogShroud:     'rgba(0,0,0,0.55)',
};

// Sprite paths — exact filenames as found in assets folder
const SPRITE_PATHS = {
  idle:          '/assets/aldeao/iddle.gif',
  running_right: '/assets/aldeao/runnig_right.gif',  // typo in source file
  running_down:  '/assets/aldeao/running_down.gif',
  running_left:  '/assets/aldeao/running_left.gif',
  running_up:    '/assets/aldeao/running_up.gif',
};

// ─── State ────────────────────────────────────────────────────────────────────
const G = {
  ws: null,
  playerId: null,
  sessionId: null,
  myPlayerIndex: -1,
  snapshot: null,
  mapTiles: null,      // TileType[][]
  selectedIds: new Set(),

  // Fog of war (client-side, per player)
  revealedTiles: new Set(),  // "x,y" keys — ever seen
  visibleTiles:  new Set(),  // "x,y" keys — currently in vision

  // Minimap
  minimapCanvas: null,      // offscreen canvas: static tile layer
  minimapFogCanvas: null,   // offscreen canvas: fog layer (rebuilt on fog change)
  minimapEl: null,          // the #minimap-canvas DOM element
  minimapCtx: null,
  isDraggingMinimap: false,

  // Camera in screen pixels (top-left of viewport in iso world space)
  camSX: 0,
  camSY: 0,
  keysHeld: {},

  canvas: null,
  ctx: null,
  wrapper: null,
  animFrameId: null,

  sprites: {},           // loaded Image objects
  spritesReady: false,

  // Pre-rendered terrain sprite variants (built once at startup)
  terrainSprites: { grass: [], dirt: [] },

  // Building sprite assets (canvas elements after color-key + load)
  buildingSprites: {},

  // Building placement
  placingBuildingType: null,  // string key from BUILDING_DEFS, or null
  ghostTile: null,            // { tx, ty } — current cursor tile
};

// Apply a near-white color key to a loaded image and return an offscreen canvas
// with the white background replaced by transparency. Used for sprites that
// were exported as RGB (no alpha channel).
function colorKeyWhite(img, threshold = 240) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  try {
    const data = cx.getImageData(0, 0, c.width, c.height);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] >= threshold && d[i+1] >= threshold && d[i+2] >= threshold) {
        d[i+3] = 0;
      }
    }
    cx.putImageData(data, 0, 0);
  } catch (e) {
    // CORS-tainted canvas — fall back to the raw image
    console.warn('color-key skipped:', e?.message);
  }
  return c;
}

// Load building sprite PNGs into G.buildingSprites. Each entry is the canvas
// produced by colorKeyWhite (so any opaque-white background becomes transparent).
function loadBuildingSprites() {
  const paths = {
    wall_wood:  '/sprites/externalWalls/wood-wall.png',
    wall_stone: '/sprites/externalWalls/stone-wall.png',
    gate_wood:  '/sprites/externalWalls/wood-gate.png',
    gate_stone: '/sprites/externalWalls/stone-gate.png',

    // Kenney iso building pieces — 256×512 each, tile diamond centered at (128, 320)
    woodWall_N:  '/sprites/constructions/woodWall_N.png',
    woodWall_S:  '/sprites/constructions/woodWall_S.png',
    woodWall_E:  '/sprites/constructions/woodWall_E.png',
    woodWall_W:  '/sprites/constructions/woodWall_W.png',
    woodWallDoor_S: '/sprites/constructions/woodWallDoorClosed_S.png',
    woodWallWindow_S: '/sprites/constructions/woodWallWindow_S.png',
    woodWallWindow_E: '/sprites/constructions/woodWallWindow_E.png',
    woodWallCorner_N: '/sprites/constructions/woodWallCorner_N.png',
    roof_N: '/sprites/constructions/roof_N.png',
    roof_S: '/sprites/constructions/roof_S.png',
    roof_E: '/sprites/constructions/roof_E.png',
    roof_W: '/sprites/constructions/roof_W.png',
    roofCorner_N: '/sprites/constructions/roofCorner_N.png',
    roofCorner_S: '/sprites/constructions/roofCorner_S.png',
    roofCorner_E: '/sprites/constructions/roofCorner_E.png',
    roofCorner_W: '/sprites/constructions/roofCorner_W.png',
    roofPeak: '/sprites/constructions/roofPeak.png',
    chimneyBase_N: '/sprites/constructions/chimneyBase_N.png',
    chimneyTop_N:  '/sprites/constructions/chimneyTop_N.png',
  };
  for (const [name, path] of Object.entries(paths)) {
    const img = new Image();
    img.onload = () => { G.buildingSprites[name] = colorKeyWhite(img); };
    img.onerror = () => { console.warn('Failed to load sprite:', path); };
    img.src = path;
  }
}

// Kenney iso pieces are 256×512 with rendering at 30°-45°-0° iso angle.
// The tile diamond occupies the BOTTOM 256×128 of the image (image y∈[384,512]);
// the 384 px above is headroom for tall objects (walls, towers, etc.).
// Anchor: image bottom-center maps to the world tile's bottom corner (south point).
function drawIsoPiece(spriteName, tx, ty, yOffset = 0) {
  const sprite = G.buildingSprites?.[spriteName];
  if (!sprite) return false;
  const { sx, sy } = worldToScreen(tx, ty);
  const scale = TILE_W / 256;
  const drawW = 256 * scale;                          // = TILE_W
  const drawH = 512 * scale;                          // = 2 * TILE_W
  const drawX = sx - drawW / 2;
  // Image bottom (y=512) → world tile bottom corner (sy + TILE_H)
  // → drawY = sy + TILE_H - drawH
  const drawY = sy + TILE_H - drawH + yOffset;
  G.ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
  return true;
}

// ─── Terrain sprite generation ────────────────────────────────────────────────
// Pre-render N variants per terrain type to offscreen canvases. Each tile then
// hash-picks a variant by (tx, ty) — stable across frames, varied across the map.
function makeSeededRand(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function clipDiamond(cx) {
  cx.beginPath();
  cx.moveTo(TILE_W / 2, 0);
  cx.lineTo(TILE_W,     TILE_H / 2);
  cx.lineTo(TILE_W / 2, TILE_H);
  cx.lineTo(0,          TILE_H / 2);
  cx.closePath();
  cx.clip();
}

function makeGrassSprite(seed) {
  const c = document.createElement('canvas');
  c.width = TILE_W;
  c.height = TILE_H;
  const cx = c.getContext('2d');
  const rand = makeSeededRand(seed * 7919 + 13);

  clipDiamond(cx);

  // Base color from palette
  cx.fillStyle = COLORS.tiles.grass[seed % COLORS.tiles.grass.length];
  cx.fillRect(0, 0, TILE_W, TILE_H);

  // Lighter highlight blobs
  const highlights = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < highlights; i++) {
    cx.fillStyle = `rgba(150, 200, 110, ${0.10 + rand() * 0.15})`;
    cx.beginPath();
    cx.arc(rand() * TILE_W, rand() * TILE_H, 2 + rand() * 5, 0, Math.PI * 2);
    cx.fill();
  }

  // Shadow blobs
  const shadows = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < shadows; i++) {
    cx.fillStyle = `rgba(20, 50, 25, ${0.08 + rand() * 0.14})`;
    cx.beginPath();
    cx.arc(rand() * TILE_W, rand() * TILE_H, 1.5 + rand() * 4, 0, Math.PI * 2);
    cx.fill();
  }

  // Grass blade strokes (short to fit a flatter tile)
  const blades = 10 + Math.floor(rand() * 8);
  for (let i = 0; i < blades; i++) {
    const bx = rand() * TILE_W;
    const by = 2 + rand() * (TILE_H - 4);
    const h  = 1 + rand() * 3;
    cx.fillStyle = rand() > 0.55
      ? `rgba(180, 220, 130, ${0.4 + rand() * 0.3})`
      : `rgba(35, 70, 30, ${0.35 + rand() * 0.25})`;
    cx.fillRect(bx, by, 1, h);
  }

  // Occasional flower
  if (rand() > 0.75) {
    const fx = 4 + rand() * (TILE_W - 8);
    const fy = 4 + rand() * (TILE_H - 8);
    const palette = ['#ffe060', '#ff7090', '#fffadc', '#c060e0'];
    cx.fillStyle = palette[Math.floor(rand() * palette.length)];
    cx.fillRect(fx, fy, 2, 2);
    cx.fillStyle = 'rgba(255,255,255,0.5)';
    cx.fillRect(fx, fy, 1, 1);
  }

  return c;
}

function makeDirtSprite(seed) {
  const c = document.createElement('canvas');
  c.width = TILE_W;
  c.height = TILE_H;
  const cx = c.getContext('2d');
  const rand = makeSeededRand(seed * 6151 + 91);

  clipDiamond(cx);

  cx.fillStyle = COLORS.tiles.dirt[seed % COLORS.tiles.dirt.length];
  cx.fillRect(0, 0, TILE_W, TILE_H);

  const sandy = 5 + Math.floor(rand() * 4);
  for (let i = 0; i < sandy; i++) {
    cx.fillStyle = `rgba(190, 150, 95, ${0.10 + rand() * 0.15})`;
    cx.beginPath();
    cx.arc(rand() * TILE_W, rand() * TILE_H, 3 + rand() * 7, 0, Math.PI * 2);
    cx.fill();
  }

  const dark = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < dark; i++) {
    cx.fillStyle = `rgba(45, 25, 12, ${0.18 + rand() * 0.18})`;
    cx.beginPath();
    cx.arc(rand() * TILE_W, rand() * TILE_H, 2 + rand() * 5, 0, Math.PI * 2);
    cx.fill();
  }

  const pebbles = 6 + Math.floor(rand() * 6);
  for (let i = 0; i < pebbles; i++) {
    const px = rand() * (TILE_W - 2);
    const py = rand() * (TILE_H - 2);
    const sz = 1 + rand() * 1.5;
    cx.fillStyle = rand() > 0.5 ? '#b8a080' : '#3a2810';
    cx.fillRect(px, py, sz, sz);
  }

  return c;
}

function buildTerrainSprites() {
  G.terrainSprites.grass = [];
  G.terrainSprites.dirt  = [];
  for (let i = 0; i < 12; i++) G.terrainSprites.grass.push(makeGrassSprite(i));
  for (let i = 0; i < 10; i++) G.terrainSprites.dirt.push(makeDirtSprite(i));
}

// Stable pseudo-hash for (tx, ty) → variant index
function tileHash(tx, ty) {
  let h = (tx | 0) * 73856093 ^ (ty | 0) * 19349663;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

// ─── Sprite loading ───────────────────────────────────────────────────────────
function loadSprites() {
  // Container kept visible off-screen so GIF animations keep running
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
  document.body.appendChild(container);

  let loaded = 0;
  const total = Object.keys(SPRITE_PATHS).length;

  for (const [name, src] of Object.entries(SPRITE_PATHS)) {
    const img = new Image();
    img.onload = () => {
      loaded++;
      if (loaded === total) G.spritesReady = true;
    };
    img.onerror = () => { loaded++; }; // fallback to shapes if missing
    img.src = src;
    container.appendChild(img);  // must be in DOM for GIF to animate
    G.sprites[name] = img;
  }
}

function spriteForVillager(v) {
  if (v.state !== 'moving' || !v.moveTarget) return G.sprites.idle;
  const dx = v.moveTarget.x - v.position.x;
  const dy = v.moveTarget.y - v.position.y;
  // Horizontal movement takes priority (matches server movement algorithm)
  if (dx !== 0) return dx > 0 ? G.sprites.running_right : G.sprites.running_left;
  return dy > 0 ? G.sprites.running_down : G.sprites.running_up;
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  G.ws = new WebSocket(`${protocol}//${location.host}`);

  G.ws.addEventListener('open', () => {
    setLobbyStatus('Conectado. Digite seu nome e entre!');
    document.getElementById('join-btn').disabled = false;
  });

  G.ws.addEventListener('close', () => {
    setLobbyStatus('Desconectado do servidor.');
    setHudStatus('Desconectado');
  });

  G.ws.addEventListener('message', (e) => {
    try { handleMessage(JSON.parse(e.data)); } catch (_) {}
  });
}

function send(payload) {
  if (G.ws?.readyState === WebSocket.OPEN) G.ws.send(JSON.stringify(payload));
}

// ─── Message Handlers ─────────────────────────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case 'game_joined':
      G.playerId  = msg.playerId;
      G.sessionId = msg.sessionId;
      if (msg.mapTiles) {
        G.mapTiles = msg.mapTiles;
        buildMinimapBase();
      }
      if (msg.initialSnapshot) {
        G.snapshot = msg.initialSnapshot;
        G.myPlayerIndex = G.snapshot.players.findIndex(p => p.id === G.playerId);
        revealAroundBases();
        buildMinimapFog();
      }
      hideLobby();
      if (msg.waitingForOpponent) showWaiting();
      break;

    case 'opponent_joined':
      hideWaiting();
      setHudStatus(`⚔ ${msg.playerName} entrou na batalha!`);
      break;

    case 'opponent_left':
      setHudStatus('Oponente desconectou. Aguardando...');
      showWaiting();
      break;

    case 'state_update':
      G.snapshot = msg.snapshot;
      G.myPlayerIndex = G.snapshot.players.findIndex(p => p.id === G.playerId);
      updateFogOfWar();
      updateHUD();
      updatePanel();
      break;

    case 'error':
      console.warn('[server]', msg.message);
      setHudStatus('⚠ ' + msg.message);
      break;
  }
}

// ─── Fog of War ───────────────────────────────────────────────────────────────
function revealAroundBases() {
  if (!G.snapshot || !G.playerId) return;
  for (const tc of G.snapshot.townCenters) {
    if (tc.ownerId !== G.playerId) continue;
    addVisionCircle(G.revealedTiles, tc.anchorPosition.x + 1, tc.anchorPosition.y + 1, VISION_TOWN_CENTER);
  }
  for (const v of G.snapshot.villagers) {
    if (v.ownerId !== G.playerId) continue;
    addVisionCircle(G.revealedTiles, v.position.x, v.position.y, VISION_VILLAGER);
  }
}

function updateFogOfWar() {
  if (!G.snapshot || !G.playerId || !G.mapTiles) return;

  const newVisible = new Set();
  const mh = G.mapTiles.length;
  const mw = G.mapTiles[0]?.length ?? 0;

  // Town Centers
  for (const tc of G.snapshot.townCenters) {
    if (tc.ownerId !== G.playerId) continue;
    const cx = tc.anchorPosition.x + 1;
    const cy = tc.anchorPosition.y + 1;
    addVisionCircle(newVisible, cx, cy, VISION_TOWN_CENTER, mw, mh);
  }

  // Villagers
  for (const v of G.snapshot.villagers) {
    if (v.ownerId !== G.playerId) continue;
    addVisionCircle(newVisible, v.position.x, v.position.y, VISION_VILLAGER, mw, mh);
  }

  // Watchtowers
  for (const b of G.snapshot.playerBuildings ?? []) {
    if (b.ownerId !== G.playerId || b.type !== 'watchtower') continue;
    addVisionCircle(newVisible, b.x, b.y, VISION_WATCHTOWER, mw, mh);
  }

  G.visibleTiles = newVisible;

  // Accumulate into revealed
  for (const key of newVisible) {
    G.revealedTiles.add(key);
  }

  // Rebuild minimap fog layer
  buildMinimapFog();
}

function addVisionCircle(set, cx, cy, radius, mw, mh) {
  const maxW = mw ?? 100;
  const maxH = mh ?? 100;
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx >= 0 && tx < maxW && ty >= 0 && ty < maxH) {
          set.add(`${tx},${ty}`);
        }
      }
    }
  }
}

function isTileVisible(tx, ty)  { return G.visibleTiles.has(`${tx},${ty}`); }
function isTileRevealed(tx, ty) { return G.revealedTiles.has(`${tx},${ty}`); }

// ─── Camera / Game Loop ───────────────────────────────────────────────────────
const CAM_SPEED_PX = 12;  // pixels per frame

function mapWidth()  { return G.mapTiles?.[0]?.length ?? 100; }
function mapHeight() { return G.mapTiles?.length        ?? 100; }

function clampCamera() {
  if (!G.canvas) return;
  const ext = worldExtent();
  const maxX = Math.max(0, ext.w - G.canvas.width);
  const maxY = Math.max(0, ext.h - G.canvas.height);
  G.camSX = Math.max(0, Math.min(maxX, G.camSX));
  G.camSY = Math.max(0, Math.min(maxY, G.camSY));
}

function gameLoop() {
  G.animFrameId = requestAnimationFrame(gameLoop);

  if (G.keysHeld['a'] || G.keysHeld['ArrowLeft'])  G.camSX -= CAM_SPEED_PX;
  if (G.keysHeld['d'] || G.keysHeld['ArrowRight']) G.camSX += CAM_SPEED_PX;
  if (G.keysHeld['w'] || G.keysHeld['ArrowUp'])    G.camSY -= CAM_SPEED_PX;
  if (G.keysHeld['s'] || G.keysHeld['ArrowDown'])  G.camSY += CAM_SPEED_PX;
  clampCamera();

  render();
}

// ─── Rendering ────────────────────────────────────────────────────────────────
function render() {
  const { ctx, canvas, snapshot } = G;
  if (!ctx || !canvas) return;

  ctx.fillStyle = '#0a0a08';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-G.camSX, -G.camSY);

  renderTiles();
  if (snapshot) renderEntitiesSorted(snapshot);
  renderFog();
  renderBuildingGhost();

  ctx.restore();

  renderMinimap();
}

// View culling helpers — given a tile or footprint, is any part on screen?
function isTileInView(tx, ty, padPx = 0) {
  const { sx, sy } = worldToScreen(tx, ty);
  const left = G.camSX - padPx;
  const top  = G.camSY - padPx;
  const right  = G.camSX + G.canvas.width  + padPx;
  const bottom = G.camSY + G.canvas.height + padPx;
  return sx + TILE_W / 2 >= left && sx - TILE_W / 2 <= right
      && sy + TILE_H >= top && sy <= bottom;
}

// ── Tiles ────────────────────────────────────────────────────────────────────
function renderTiles() {
  const { ctx, mapTiles } = G;
  if (!mapTiles) return;
  const mh = mapHeight();
  const mw = mapWidth();

  // Iterate in painter's order (back-to-front by tx+ty) so cliff-edges look right.
  // 60×60 = 3600 tiles, drawImage is cheap; per-tile cull avoids off-screen work.
  for (let s = 0; s <= mw + mh - 2; s++) {
    const tyMin = Math.max(0, s - (mw - 1));
    const tyMax = Math.min(mh - 1, s);
    for (let ty = tyMin; ty <= tyMax; ty++) {
      const tx = s - ty;
      if (!isTileInView(tx, ty, TILE_W)) continue;

      const { sx, sy } = worldToScreen(tx, ty);
      const tile = mapTiles[ty]?.[tx] ?? 'grass';
      const h = tileHash(tx, ty);

      if (tile === 'water') {
        drawWaterIso(ctx, sx, sy, tx, ty);
      } else if (tile === 'dirt') {
        const variants = G.terrainSprites.dirt;
        if (variants.length) ctx.drawImage(variants[h % variants.length], sx - TILE_W / 2, sy);
      } else {
        const variants = G.terrainSprites.grass;
        if (variants.length) ctx.drawImage(variants[h % variants.length], sx - TILE_W / 2, sy);
      }
    }
  }
}

// Diamond-clipped animated water for a single iso tile.
function drawWaterIso(ctx, sx, sy, tx, ty) {
  const t = Date.now() / 1800;
  const left   = sx - TILE_W / 2;
  const top    = sy;
  ctx.save();

  // Diamond clip
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + TILE_W / 2, sy + TILE_H / 2);
  ctx.lineTo(sx, sy + TILE_H);
  ctx.lineTo(sx - TILE_W / 2, sy + TILE_H / 2);
  ctx.closePath();
  ctx.clip();

  ctx.fillStyle = '#15314f';
  ctx.fillRect(left, top, TILE_W, TILE_H);

  const wave = Math.sin(t + tx * 0.18 + ty * 0.12) * 18;
  const mid = Math.round(72 + wave);
  ctx.fillStyle = `rgb(28,${50 + Math.round(wave / 2)},${mid})`;
  ctx.fillRect(left, top + 3, TILE_W, TILE_H - 6);

  // Ripples
  ctx.fillStyle = 'rgba(180,220,255,0.10)';
  for (let i = 0; i < 2; i++) {
    const off = ((t * 12 + i * 7 + tx * 3) % TILE_W);
    ctx.fillRect(left + off, top + 6 + i * (TILE_H / 3), TILE_W * 0.4, 1);
  }

  // Foam
  const foamPhase = (Math.sin(t * 1.5 + tx + ty) + 1) / 2;
  ctx.fillStyle = `rgba(220,240,255,${0.12 + foamPhase * 0.18})`;
  ctx.fillRect(left + 4, top + Math.round(TILE_H / 2), TILE_W - 8, 1);

  ctx.restore();
}

// ── Depth-sorted entity rendering ────────────────────────────────────────────
function renderEntitiesSorted(snapshot) {
  const list = [];

  for (const node of snapshot.resourceNodes) {
    if (!isTileRevealed(node.position.x, node.position.y)) continue;
    if (!isTileInView(node.position.x, node.position.y, TILE_W)) continue;
    list.push({ kind: 'resource', payload: node, depth: node.position.x + node.position.y });
  }

  for (const tc of snapshot.townCenters) {
    const ax = tc.anchorPosition.x, ay = tc.anchorPosition.y;
    const isOwn = tc.ownerId === G.playerId;
    if (!isOwn && !isTileRevealed(ax + 1, ay + 1)) continue;
    if (!isTileInView(ax + 1, ay + 1, TILE_W * 3)) continue;
    list.push({ kind: 'tc', payload: tc, depth: ax + 2 + ay + 2 });
  }

  for (const b of snapshot.playerBuildings ?? []) {
    const isOwn = b.ownerId === G.playerId;
    if (!isOwn && !isTileRevealed(b.x, b.y)) continue;
    if (!isTileInView(b.x + (b.width - 1) / 2, b.y + (b.height - 1) / 2, TILE_W * 2)) continue;
    list.push({ kind: 'building', payload: b, depth: b.x + (b.width - 1) + b.y + (b.height - 1) });
  }

  for (const v of snapshot.villagers) {
    const isOwn = v.ownerId === G.playerId;
    if (!isOwn && !isTileVisible(v.position.x, v.position.y)) continue;
    if (!isTileInView(v.position.x, v.position.y, TILE_W)) continue;
    list.push({ kind: 'villager', payload: v, depth: v.position.x + v.position.y + 0.5 });
  }

  list.sort((a, b) => a.depth - b.depth);

  for (const item of list) {
    if      (item.kind === 'resource') renderResourceNode(item.payload);
    else if (item.kind === 'tc')       renderTownCenter(snapshot, item.payload);
    else if (item.kind === 'building') renderPlayerBuilding(snapshot, item.payload);
    else if (item.kind === 'villager') renderVillager(snapshot, item.payload);
  }
}

// ── Single-resource node (upright billboard at iso ground center) ────────────
function renderResourceNode(node) {
  const ctx = G.ctx;
  const { sx, sy } = worldToScreen(node.position.x, node.position.y);
  const cx = sx;                          // diamond mid-x
  const cy = sy + TILE_H / 2;             // ground center

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(SPRITE_SCALE, SPRITE_SCALE);
  switch (node.type) {
    case 'gold':       drawGoldMine(ctx, 0, 0);    break;
    case 'stone':      drawStoneQuarry(ctx, 0, 0); break;
    case 'wood':       drawTree(ctx, 0, 0);        break;
    case 'food_deer':  drawDeer(ctx, 0, 0);        break;
    case 'food_berry': drawBerryBush(ctx, 0, 0);   break;
  }
  ctx.restore();

  // Remaining bar — under the ground center
  const maxAmt = { gold: 600, stone: 500, wood: 400, food_deer: 300, food_berry: 250 };
  const pct = node.remaining / (maxAmt[node.type] ?? 500);
  const barW = TILE_W * 0.55;
  const barX = cx - barW / 2;
  const barY = cy + TILE_H / 2 - 4;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(barX, barY, barW, 3);
  ctx.fillStyle = pct > 0.5 ? '#60d040' : pct > 0.2 ? '#d0a040' : '#d04040';
  ctx.fillRect(barX, barY, Math.round(barW * pct), 3);
}

// ── 3D iso-box helper: draws a footprint as raised walls + flat roof ────────
// Footprint is the world-space rectangle (ax, ay) → (ax+w, ay+h).
// `height` is wall height in screen pixels (positive = taller).
function draw3DBox(ax, ay, w, h, height, colors) {
  const ctx = G.ctx;
  // Diamond corners of the footprint on the ground
  const top    = worldToScreen(ax,     ay);
  const right  = worldToScreen(ax + w, ay);
  const bottom = worldToScreen(ax + w, ay + h);
  const left   = worldToScreen(ax,     ay + h);
  // Roof corners (raised by `height` screen pixels)
  const tR = { sx: top.sx,    sy: top.sy    - height };
  const rR = { sx: right.sx,  sy: right.sy  - height };
  const bR = { sx: bottom.sx, sy: bottom.sy - height };
  const lR = { sx: left.sx,   sy: left.sy   - height };

  // Right wall (between `right` and `bottom`, lit side)
  if (colors.wallRight) {
    ctx.fillStyle = colors.wallRight;
    ctx.beginPath();
    ctx.moveTo(right.sx,  right.sy);
    ctx.lineTo(bottom.sx, bottom.sy);
    ctx.lineTo(bR.sx,     bR.sy);
    ctx.lineTo(rR.sx,     rR.sy);
    ctx.closePath();
    ctx.fill();
    if (colors.outline) {
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  // Left wall (between `left` and `bottom`, shadowed side)
  if (colors.wallLeft) {
    ctx.fillStyle = colors.wallLeft;
    ctx.beginPath();
    ctx.moveTo(left.sx,   left.sy);
    ctx.lineTo(bottom.sx, bottom.sy);
    ctx.lineTo(bR.sx,     bR.sy);
    ctx.lineTo(lR.sx,     lR.sy);
    ctx.closePath();
    ctx.fill();
    if (colors.outline) {
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  // Roof diamond
  if (colors.roof) {
    ctx.fillStyle = colors.roof;
    ctx.beginPath();
    ctx.moveTo(tR.sx, tR.sy);
    ctx.lineTo(rR.sx, rR.sy);
    ctx.lineTo(bR.sx, bR.sy);
    ctx.lineTo(lR.sx, lR.sy);
    ctx.closePath();
    ctx.fill();
    if (colors.outline) {
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  return { top, right, bottom, left, tR, rR, bR, lR };
}

// Outline a footprint diamond at ground level (for selection / construction).
function outlineFootprint(ax, ay, w, h, stroke, dash) {
  const ctx = G.ctx;
  const top    = worldToScreen(ax,     ay);
  const right  = worldToScreen(ax + w, ay);
  const bottom = worldToScreen(ax + w, ay + h);
  const left   = worldToScreen(ax,     ay + h);
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(top.sx, top.sy);
  ctx.lineTo(right.sx, right.sy);
  ctx.lineTo(bottom.sx, bottom.sy);
  ctx.lineTo(left.sx, left.sy);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

// ── Town Center (3×3, Kenney wall sprites + procedural flat roof) ───────────
// Walls come from the Kenney pack — only the camera-facing faces are drawn
// (S front and E right; the back N/W walls would be hidden behind them anyway).
// On top we draw a procedural flat plank roof + a sprite chimney + flag.
// `drawIsoPiece` anchors each 256×512 piece so the image bottom lands on the
// world tile's south corner (the convention from Kenney's iso pack).
function renderTownCenter(snapshot, tc) {
  const ctx = G.ctx;
  const ax = tc.anchorPosition.x;
  const ay = tc.anchorPosition.y;
  const isOwn = tc.ownerId === G.playerId;
  const playerIdx = snapshot.players.findIndex(p => p.id === tc.ownerId);
  const playerColor = COLORS.tc[playerIdx] ?? '#888';

  // Fallback to procedural keep if the sprite pack isn't ready yet
  if (!G.buildingSprites?.woodWall_S) {
    draw3DBox(ax, ay, 3, 3, TILE_W * 0.95, {
      wallRight: '#9a6f44', wallLeft: '#5a3818',
      roof: '#8a6238', outline: 'rgba(40,24,12,0.85)',
    });
    return;
  }

  // East face — Kenney's woodWall_E is placed on the WEST edge of its tile,
  // so to get the wall on the BUILDING's outer east edge we anchor one column
  // beyond the footprint (ax+3).
  for (let dy = 0; dy < 3; dy++) {
    const piece = dy === 1 ? 'woodWallWindow_E' : 'woodWall_E';
    drawIsoPiece(piece, ax + 3, ay + dy);
  }
  // South face — woodWall_S is placed on the NORTH edge of its tile, so for the
  // building's outer south edge we anchor one row beyond (ay+3).
  for (let dx = 0; dx < 3; dx++) {
    const piece = dx === 1 ? 'woodWallDoor_S'
                  : dx === 0 ? 'woodWallWindow_S'
                  : 'woodWall_S';
    drawIsoPiece(piece, ax + dx, ay + 3);
  }

  // Hipped roof composed from Kenney pieces, lifted by one wall-height so it
  // sits ON TOP of the walls. Corners at the 4 footprint corners, sloped pieces
  // at the 4 edge mid-tiles, apex covered by adjacent pieces.
  const ROOF_LIFT = -TILE_W * 0.575;  // one wall-height (calibrated visually)
  const roofTiles = [];
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      roofTiles.push({ tx: ax + dx, ty: ay + dy, dx, dy });
    }
  }
  roofTiles.sort((a, b) => (a.tx + a.ty) - (b.tx + b.ty));

  for (const { tx, ty, dx, dy } of roofTiles) {
    let piece = null;
    if      (dx === 0 && dy === 0) piece = 'roofCorner_W';
    else if (dx === 2 && dy === 0) piece = 'roofCorner_N';
    else if (dx === 0 && dy === 2) piece = 'roofCorner_S';
    else if (dx === 2 && dy === 2) piece = 'roofCorner_E';
    else if (dx === 1 && dy === 0) continue;  // skip back-right slope
    else if (dx === 0 && dy === 1) continue;  // skip back-left slope
    else if (dx === 2)             piece = 'roof_N';
    else if (dy === 2)             piece = 'roof_E';
    else                           piece = 'roofCorner_E';  // center (1,1) apex
    const lift = (dx === 1 && dy === 1) ? ROOF_LIFT - TILE_W * 0.56 : ROOF_LIFT;
    drawIsoPiece(piece, tx, ty, lift);
  }

  // Chimney sticks up from the roof near the back-right corner
  drawIsoPiece('chimneyBase_N', ax + 2, ay, ROOF_LIFT);
  drawIsoPiece('chimneyTop_N',  ax + 2, ay, ROOF_LIFT - TILE_W * 0.22);

  // Player flag near the apex of the roof — anchor at center tile, lifted by
  // the wall height so the flagpole rises from the roof peak.
  const flagLift = TILE_W * 1.1;
  const flagAt = worldToScreen(ax + 1, ay + 1);
  flagAt.sy -= flagLift;
  ctx.strokeStyle = '#3a2810';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(flagAt.sx, flagAt.sy);
  ctx.lineTo(flagAt.sx, flagAt.sy - 26);
  ctx.stroke();
  ctx.fillStyle = playerColor;
  ctx.beginPath();
  ctx.moveTo(flagAt.sx, flagAt.sy - 26);
  ctx.lineTo(flagAt.sx + 16, flagAt.sy - 22);
  ctx.lineTo(flagAt.sx, flagAt.sy - 17);
  ctx.closePath();
  ctx.fill();

  // Player name above flag
  const pName = snapshot.players[playerIdx]?.name ?? '';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 3;
  ctx.font = `bold ${Math.round(11 * SPRITE_SCALE)}px Georgia`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.strokeText(pName.substring(0, 12), flagAt.sx, flagAt.sy - 30);
  ctx.fillText(pName.substring(0, 12), flagAt.sx, flagAt.sy - 30);

  // HP bar above the apex of the roof
  if (tc.hp < tc.maxHp) {
    const barW = TILE_W * 2;
    const pct  = tc.hp / tc.maxHp;
    const barX = flagAt.sx - barW / 2;
    const barY = flagAt.sy - 44;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(barX, barY, barW, 5);
    ctx.fillStyle = pct > 0.5 ? '#50e040' : pct > 0.25 ? '#e0c040' : '#e04040';
    ctx.fillRect(barX, barY, Math.round(barW * pct), 5);
  }

  // Training progress at the front (south corner)
  if (tc.isTraining && isOwn) {
    const unitTicks = { villager: 20, archer: 24, cavalry: 40 };
    const totalTicks = unitTicks[tc.trainingUnitType] ?? 20;
    const pct = 1 - tc.trainTicksRemaining / totalTicks;
    const south = worldToScreen(ax + 3, ay + 3);
    const barW = TILE_W * 1.5;
    const barX = south.sx - barW / 2;
    const barY = south.sy + 6;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX, barY, barW, 6);
    ctx.fillStyle = '#60c040';
    ctx.fillRect(barX, barY, Math.round(barW * pct), 6);
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(9 * SPRITE_SCALE)}px Georgia`;
    ctx.textAlign = 'center';
    ctx.fillText('Treinando...', south.sx, barY + 18);
  }
}

// ── Villager (upright billboard at iso ground center) ──────────────────────
function renderVillager(snapshot, v) {
  const ctx = G.ctx;
  const { sx, sy } = worldToScreen(v.position.x, v.position.y);
  const cx = sx;                  // x at the diamond center
  const cy = sy + TILE_H / 2;     // ground-plane y (where feet land)
  const SPRITE_H = TILE_W * 0.85; // upright sprite height

  const isOwn      = v.ownerId === G.playerId;
  const isSelected = G.selectedIds.has(v.id);
  const playerIdx  = snapshot.players.findIndex(p => p.id === v.ownerId);

  // Movement path line (target → iso)
  if (isSelected && v.state === 'moving' && v.moveTarget) {
    const t = worldToScreen(v.moveTarget.x, v.moveTarget.y);
    ctx.strokeStyle = COLORS.moveTarget;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(t.sx, t.sy + TILE_H / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = COLORS.selected;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(t.sx, t.sy + TILE_H / 2, 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Gather line
  if (isSelected && v.state === 'gathering' && v.gatherTarget) {
    const node = snapshot.resourceNodes.find(n => n.id === v.gatherTarget);
    if (node) {
      const t = worldToScreen(node.position.x, node.position.y);
      ctx.strokeStyle = COLORS.gatherTarget;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(t.sx, t.sy + TILE_H / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Iso selection ring (flat ellipse on the ground)
  if (isSelected) {
    ctx.strokeStyle = COLORS.selected;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, TILE_W * 0.35, TILE_H * 0.35, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(cx + 1, cy + 1, TILE_W * 0.20, TILE_H * 0.30, 0, 0, Math.PI * 2);
  ctx.fill();

  // Unit body — drawn upright above ground center
  const pColor = COLORS.villager[playerIdx] ?? '#888';
  const headY = cy - SPRITE_H * 0.5;  // approximate head position for HP bar
  if (v.unitType === 'archer') {
    ctx.save();
    ctx.translate(cx, cy - SPRITE_H * 0.35);
    ctx.scale(SPRITE_SCALE, SPRITE_SCALE);
    drawArcher(ctx, 0, 0, pColor);
    ctx.restore();
  } else if (v.unitType === 'cavalry') {
    ctx.save();
    ctx.translate(cx, cy - SPRITE_H * 0.30);
    ctx.scale(SPRITE_SCALE, SPRITE_SCALE);
    drawCavalry(ctx, 0, 0, pColor);
    ctx.restore();
  } else {
    const sprite = spriteForVillager(v);
    if (sprite && sprite.complete && sprite.naturalWidth > 0) {
      const w = TILE_W * 0.75;
      const h = w;
      ctx.drawImage(sprite, cx - w / 2, cy - h * 0.95, w, h);
      // Player color stripe under the sprite (foot mark)
      ctx.fillStyle = pColor;
      ctx.fillRect(cx - 5 * SPRITE_SCALE, cy - 2, 10 * SPRITE_SCALE, 2);
    } else {
      ctx.save();
      ctx.translate(cx, cy - SPRITE_H * 0.35);
      ctx.scale(SPRITE_SCALE, SPRITE_SCALE);
      ctx.fillStyle = pColor;
      ctx.beginPath(); ctx.arc(0, 1, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d4a070';
      ctx.beginPath(); ctx.arc(0, -5, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // State indicator dot (own units only)
  if (isOwn) {
    const dotColor = v.state === 'gathering'   ? '#60d040'
      : v.state === 'moving'      ? '#d0d040'
      : v.state === 'constructing'? '#f0a020'
      : v.state === 'attacking'   ? '#ff4040'
      : null;
    if (dotColor) {
      ctx.fillStyle = dotColor;
      ctx.beginPath();
      ctx.arc(cx + TILE_W * 0.20, headY - 4, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Health bar above head
  if (v.hp < v.maxHp) {
    const barW = TILE_W * 0.5;
    const barX = cx - barW / 2;
    const barY = headY - 8;
    const pct  = v.hp / v.maxHp;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(barX - 1, barY - 1, barW + 2, 4);
    ctx.fillStyle = pct > 0.5 ? '#50e040' : pct > 0.25 ? '#e0c040' : '#e04040';
    ctx.fillRect(barX, barY, Math.round(barW * pct), 3);
  }
}

// ── Player Building (iso 3D boxes by type) ──────────────────────────────────
function renderPlayerBuilding(snapshot, b) {
  const ctx = G.ctx;
  const def = BUILDING_DEFS[b.type] ?? { color:'#666', width:1, height:1 };
  const w = b.width  ?? def.width;
  const h = b.height ?? def.height;
  const pidx = snapshot.players.findIndex(p => p.id === b.ownerId);
  const playerColor = COLORS.tc[pidx] ?? '#888';
  const outline = 'rgba(40,28,16,0.7)';

  let topAnchor = null;  // top-most screen point of the rendered structure (for HP bars)
  let corners;

  switch (b.type) {
    case 'wall': {
      // Wall material: 'wood' (initial) or 'stone' (upgraded).
      // Server may set b.material; default to 'wood'.
      const material = b.material === 'stone' ? 'stone' : 'wood';
      const sprite = G.buildingSprites?.[`wall_${material}`];
      const ground = worldToScreen(b.x + w / 2, b.y + h / 2);
      const cx = ground.sx;
      const cy = ground.sy + TILE_H / 2;

      if (sprite) {
        // The sprite is square (1024×1024); the artwork's foot sits at ~67% down.
        // Scale so visible width covers the iso footprint plus a small margin.
        const drawW = TILE_W * w * 1.7;
        const drawH = drawW;        // 1:1 source aspect
        const footRatio = 0.70;     // sprite content's ground line fraction
        const dx = cx - drawW / 2;
        const dy = cy - drawH * footRatio;
        ctx.drawImage(sprite, dx, dy, drawW, drawH);
        topAnchor = { sx: cx, sy: dy + drawH * 0.10 };
      } else {
        // Fallback while assets load — procedural box
        corners = draw3DBox(b.x, b.y, w, h, 50, {
          wallRight: '#9a8878',
          wallLeft:  '#6a5848',
          roof:      '#aaa090',
          outline,
        });
        topAnchor = corners.tR;
      }
      break;
    }

    case 'watchtower': {
      corners = draw3DBox(b.x, b.y, w, h, 110, {
        wallRight: '#8a7860',
        wallLeft:  '#5a4838',
        roof:      '#a09070',
        outline,
      });
      // Arrow slits on each visible wall
      const wallSlitR = {
        x: (corners.right.sx + corners.bottom.sx) / 2,
        y: (corners.right.sy + corners.bottom.sy) / 2 - 60,
      };
      const wallSlitL = {
        x: (corners.left.sx + corners.bottom.sx) / 2,
        y: (corners.left.sy + corners.bottom.sy) / 2 - 60,
      };
      ctx.fillStyle = '#2a1a08';
      ctx.fillRect(wallSlitR.x - 1, wallSlitR.y - 5, 2, 10);
      ctx.fillRect(wallSlitL.x - 1, wallSlitL.y - 5, 2, 10);
      // Flag pole
      const cT = corners.tR;
      ctx.strokeStyle = '#3a2810'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cT.sx, cT.sy); ctx.lineTo(cT.sx, cT.sy - 18); ctx.stroke();
      ctx.fillStyle = playerColor;
      ctx.beginPath();
      ctx.moveTo(cT.sx, cT.sy - 18);
      ctx.lineTo(cT.sx + 12, cT.sy - 14);
      ctx.lineTo(cT.sx, cT.sy - 10);
      ctx.closePath();
      ctx.fill();
      topAnchor = { sx: cT.sx, sy: cT.sy - 18 };
      break;
    }

    case 'lumber_camp': {
      corners = draw3DBox(b.x, b.y, w, h, 28, {
        wallRight: '#6a4a28',
        wallLeft:  '#4a3018',
        roof:      '#5a7030',
        outline,
      });
      // Log piles on the roof — short brown rectangles
      const rcx = (corners.tR.sx + corners.bR.sx) / 2;
      const rcy = (corners.tR.sy + corners.bR.sy) / 2;
      ctx.fillStyle = '#8a6040';
      ctx.fillRect(rcx - 16, rcy - 5, 32, 4);
      ctx.fillRect(rcx - 14, rcy + 1, 28, 4);
      ctx.fillStyle = '#5a3a18';
      ctx.fillRect(rcx - 16, rcy - 1, 32, 1);
      ctx.fillRect(rcx - 14, rcy + 5, 28, 1);
      // Player banner
      ctx.fillStyle = playerColor;
      ctx.fillRect(corners.rR.sx - 8, corners.rR.sy - 4, 6, 8);
      topAnchor = corners.tR;
      break;
    }

    case 'gold_mine': {
      corners = draw3DBox(b.x, b.y, w, h, 32, {
        wallRight: '#7a6840',
        wallLeft:  '#52462a',
        roof:      '#c09020',
        outline,
      });
      // Gold lump on roof
      const rcx = (corners.tR.sx + corners.bR.sx) / 2;
      const rcy = (corners.tR.sy + corners.bR.sy) / 2;
      ctx.fillStyle = '#e8c040';
      ctx.beginPath(); ctx.arc(rcx, rcy, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd060';
      ctx.beginPath(); ctx.arc(rcx - 2, rcy - 2, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = playerColor;
      ctx.fillRect(corners.rR.sx - 8, corners.rR.sy - 4, 6, 8);
      topAnchor = corners.tR;
      break;
    }

    case 'stone_quarry': {
      corners = draw3DBox(b.x, b.y, w, h, 28, {
        wallRight: '#909090',
        wallLeft:  '#5a5a5a',
        roof:      '#a0a0a0',
        outline,
      });
      // Stone chunks on roof
      const rcx = (corners.tR.sx + corners.bR.sx) / 2;
      const rcy = (corners.tR.sy + corners.bR.sy) / 2;
      ctx.fillStyle = '#bbbbbb';
      ctx.fillRect(rcx - 12, rcy - 5, 12, 8);
      ctx.fillRect(rcx + 2,  rcy - 1, 9,  6);
      ctx.fillStyle = '#dcdcdc';
      ctx.fillRect(rcx - 10, rcy - 3, 4, 3);
      ctx.fillStyle = playerColor;
      ctx.fillRect(corners.rR.sx - 8, corners.rR.sy - 4, 6, 8);
      topAnchor = corners.tR;
      break;
    }

    case 'farm': {
      // Almost flat — short walls, crop rows visible on the diamond roof
      corners = draw3DBox(b.x, b.y, w, h, 6, {
        wallRight: '#5a4020',
        wallLeft:  '#3a2810',
        roof:      '#6a8020',
        outline,
      });
      // Crop rows on the diamond roof — three lines parallel to the (x) axis in iso
      const cT = corners.tR, cR = corners.rR, cB = corners.bR, cL = corners.lR;
      ctx.strokeStyle = '#a0c040';
      ctx.lineWidth = 2;
      for (let i = 1; i <= 3; i++) {
        const t = i / 4;
        // Line from edge top→left at fraction t to edge right→bottom at fraction t
        const ax = cT.sx + (cL.sx - cT.sx) * t;
        const ay = cT.sy + (cL.sy - cT.sy) * t;
        const bx = cR.sx + (cB.sx - cR.sx) * t;
        const by = cR.sy + (cB.sy - cR.sy) * t;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.fillStyle = playerColor;
      ctx.fillRect(corners.rR.sx - 5, corners.rR.sy - 3, 5, 6);
      topAnchor = corners.tR;
      break;
    }

    default: {
      corners = draw3DBox(b.x, b.y, w, h, 30, {
        wallRight: def.color,
        wallLeft:  def.color,
        roof:      def.color,
        outline,
      });
      topAnchor = corners.tR;
    }
  }

  // HP bar — above the topmost rendered point
  if (b.status === 'complete' && b.hp < b.maxHp && topAnchor) {
    const barW = TILE_W * Math.max(0.6, w * 0.5);
    const pct  = b.hp / b.maxHp;
    const barX = topAnchor.sx - barW / 2;
    const barY = topAnchor.sy - 12;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(barX, barY, barW, 4);
    ctx.fillStyle = pct > 0.5 ? '#50e040' : pct > 0.25 ? '#e0c040' : '#e04040';
    ctx.fillRect(barX, barY, Math.round(barW * pct), 4);
  }

  // Under-construction overlay: scaffolding + progress bar over the diamond footprint
  if (b.status === 'under_construction') {
    const top    = worldToScreen(b.x,     b.y);
    const right  = worldToScreen(b.x + w, b.y);
    const bottom = worldToScreen(b.x + w, b.y + h);
    const left   = worldToScreen(b.x,     b.y + h);
    ctx.save();
    // Semi-transparent dark over the projected building
    ctx.beginPath();
    ctx.moveTo(top.sx,    top.sy);
    ctx.lineTo(right.sx,  right.sy);
    ctx.lineTo(bottom.sx, bottom.sy);
    ctx.lineTo(left.sx,   left.sy);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    // Scaffolding diagonals
    ctx.strokeStyle = '#c8a040';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(top.sx,    top.sy);    ctx.lineTo(bottom.sx, bottom.sy);
    ctx.moveTo(right.sx,  right.sy);  ctx.lineTo(left.sx,   left.sy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Progress bar near the bottom corner of the diamond
    const pct = 1 - (b.constructionTicksRemaining / b.constructionTotalTicks);
    const barW = TILE_W * Math.max(0.6, w * 0.5);
    const barX = bottom.sx - barW / 2;
    const barY = bottom.sy + 4;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(barX, barY, barW, 5);
    ctx.fillStyle = pct < 0.5 ? '#d08020' : '#60c040';
    ctx.fillRect(barX, barY, Math.round(barW * pct), 5);
  }
}

// ── Building Ghost Preview (iso footprint diamond) ──────────────────────────
function renderBuildingGhost() {
  if (!G.placingBuildingType || !G.ghostTile) return;
  const { ctx } = G;
  const def = BUILDING_DEFS[G.placingBuildingType];
  if (!def) return;

  const { tx, ty } = G.ghostTile;
  const canAfford = canAffordBuilding(G.placingBuildingType);
  const valid = canAfford && isTileRangeWalkable(tx, ty, def.width, def.height);

  const top    = worldToScreen(tx,             ty);
  const right  = worldToScreen(tx + def.width, ty);
  const bottom = worldToScreen(tx + def.width, ty + def.height);
  const left   = worldToScreen(tx,             ty + def.height);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(top.sx,    top.sy);
  ctx.lineTo(right.sx,  right.sy);
  ctx.lineTo(bottom.sx, bottom.sy);
  ctx.lineTo(left.sx,   left.sy);
  ctx.closePath();

  ctx.fillStyle = valid ? 'rgba(64,200,64,0.45)' : 'rgba(200,64,64,0.45)';
  ctx.fill();

  ctx.strokeStyle = valid ? '#80ff80' : '#ff8080';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Label above the top corner
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(11 * SPRITE_SCALE)}px Georgia`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 3;
  ctx.strokeText(def.label, top.sx, top.sy - 4);
  ctx.fillText(def.label, top.sx, top.sy - 4);
  ctx.restore();
}

function isTileRangeWalkable(tx, ty, w, h) {
  if (!G.mapTiles) return false;
  const mh = G.mapTiles.length;
  const mw = G.mapTiles[0]?.length ?? 0;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || y < 0 || x >= mw || y >= mh) return false;
      const tile = G.mapTiles[y]?.[x];
      if (!tile || tile === 'water') return false;
      // Check occupied by existing buildings / TC
      if (isTileOccupied(x, y)) return false;
    }
  }
  return true;
}

function isTileOccupied(tx, ty) {
  if (!G.snapshot) return false;
  // All buildings (including under construction) block new placement
  for (const b of G.snapshot.playerBuildings ?? []) {
    const bw = b.width ?? 1;
    const bh = b.height ?? 1;
    if (tx >= b.x && tx < b.x + bw && ty >= b.y && ty < b.y + bh) return true;
  }
  for (const tc of G.snapshot.townCenters ?? []) {
    const ax = tc.anchorPosition.x;
    const ay = tc.anchorPosition.y;
    if (tx >= ax && tx < ax + 3 && ty >= ay && ty < ay + 3) return true;
  }
  return false;
}

function canAffordBuilding(type) {
  if (!G.snapshot || G.myPlayerIndex < 0) return false;
  const me = G.snapshot.players[G.myPlayerIndex];
  if (!me) return false;
  const cost = BUILDING_DEFS[type]?.cost ?? {};
  for (const [res, amt] of Object.entries(cost)) {
    if ((me.resources[res] ?? 0) < amt) return false;
  }
  return true;
}

// ── Fog of War overlay ───────────────────────────────────────────────────────
// Reuses the low-res alpha mask built for the minimap (1 px per tile). We project
// it through the iso transform so each source pixel (i, j) → world tile (i, j) →
// screen iso position. Bilinear smoothing keeps the vision edge soft.
function renderFog() {
  const { ctx } = G;
  if (!G.minimapFogCanvas) return;
  const mh = mapHeight();
  const originX = mh * TILE_W / 2;

  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.save();
  // Compose iso projection on top of current (camera) translate.
  // Matrix maps (i, j) → ((i - j) * TILE_W/2 + originX, (i + j) * TILE_H/2)
  ctx.transform(TILE_W / 2, TILE_H / 2,   // basis x: (1, 0) → (W/2, H/2)
                -TILE_W / 2, TILE_H / 2,  // basis y: (0, 1) → (-W/2, H/2)
                originX, 0);
  ctx.drawImage(G.minimapFogCanvas, 0, 0);
  ctx.restore();

  ctx.imageSmoothingEnabled = prev;
}

// ─── Resource node drawing ────────────────────────────────────────────────────
function drawGoldMine(ctx, cx, cy) {
  ctx.fillStyle = '#b8900a';
  ctx.fillRect(cx - 7, cy - 7, 13, 13);
  ctx.fillStyle = '#e8c040';
  ctx.fillRect(cx - 5, cy - 5, 9, 9);
  ctx.fillStyle = '#ffd060';
  ctx.fillRect(cx - 2, cy - 7, 4, 5);
  ctx.fillRect(cx + 3, cy + 1, 4, 5);
  ctx.fillRect(cx - 7, cy + 1, 4, 5);
  ctx.fillStyle = 'rgba(255,255,200,0.6)';
  ctx.fillRect(cx - 3, cy - 6, 2, 2);
}

function drawStoneQuarry(ctx, cx, cy) {
  ctx.fillStyle = '#6a6a6a';
  ctx.beginPath(); ctx.arc(cx, cy + 2, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8a8a8a';
  ctx.beginPath(); ctx.arc(cx - 4, cy - 2, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#aaaaaa';
  ctx.beginPath(); ctx.arc(cx + 4, cy - 3, 5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - 1, cy - 6); ctx.lineTo(cx + 2, cy + 2); ctx.stroke();
}

function drawTree(ctx, cx, cy) {
  ctx.fillStyle = '#5a3a10';
  ctx.fillRect(cx - 3, cy + 4, 5, 8);
  ctx.fillStyle = '#1a5a1a';
  ctx.beginPath(); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx + 9, cy + 4); ctx.lineTo(cx - 9, cy + 4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2a7a2a';
  ctx.beginPath(); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx + 7, cy + 2); ctx.lineTo(cx - 7, cy + 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(100,200,80,0.25)';
  ctx.beginPath(); ctx.arc(cx - 2, cy - 5, 4, 0, Math.PI * 2); ctx.fill();
}

function drawDeer(ctx, cx, cy) {
  ctx.fillStyle = '#a06030';
  ctx.beginPath(); ctx.ellipse(cx, cy + 3, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#b07040';
  ctx.fillRect(cx + 3, cy - 2, 3, 7);
  ctx.beginPath(); ctx.arc(cx + 5, cy - 4, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#804020'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx + 6, cy - 6); ctx.lineTo(cx + 3, cy - 11); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 6, cy - 6); ctx.lineTo(cx + 9, cy - 10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 4, cy - 9); ctx.lineTo(cx + 6, cy - 11); ctx.stroke();
  ctx.fillStyle = '#804020';
  for (const [bx, by] of [[-4,7],[-1,7],[2,7],[5,7]]) {
    ctx.fillRect(cx + bx, cy + by, 2, 5);
  }
}

function drawBerryBush(ctx, cx, cy) {
  ctx.fillStyle = '#2a5a1a';
  ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a6a28';
  ctx.beginPath(); ctx.arc(cx - 4, cy - 2, 6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 4, cy - 3, 5, 0, Math.PI * 2); ctx.fill();
  for (const [bx, by] of [[-4,1],[0,-2],[3,0],[1,4],[-3,4],[-1,-5],[4,-1]]) {
    ctx.fillStyle = '#c03070';
    ctx.beginPath(); ctx.arc(cx + bx, cy + by, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e04090';
    ctx.beginPath(); ctx.arc(cx + bx - 0.5, cy + by - 0.5, 1, 0, Math.PI * 2); ctx.fill();
  }
}

function drawArcher(ctx, cx, cy, playerColor) {
  // Body (green cloak)
  ctx.fillStyle = playerColor;
  ctx.beginPath(); ctx.arc(cx, cy + 2, 7, 0, Math.PI * 2); ctx.fill();
  // Hood/head
  ctx.fillStyle = '#d4a070';
  ctx.beginPath(); ctx.arc(cx, cy - 5, 4, 0, Math.PI * 2); ctx.fill();
  // Bow (arc shape)
  ctx.strokeStyle = '#8B4513';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx + 6, cy, 6, -Math.PI * 0.6, Math.PI * 0.6);
  ctx.stroke();
  // Bowstring
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx + 6, cy - 5.5);
  ctx.lineTo(cx + 4, cy);
  ctx.lineTo(cx + 6, cy + 5.5);
  ctx.stroke();
  // Arrow
  ctx.strokeStyle = '#8B4513';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx + 3, cy); ctx.lineTo(cx + 11, cy); ctx.stroke();
  ctx.fillStyle = '#c0c0c0';
  ctx.fillRect(cx + 10, cy - 1, 3, 2);
}

function drawCavalry(ctx, cx, cy, playerColor) {
  // Horse body (brown ellipse)
  ctx.fillStyle = '#8B5E3C';
  ctx.beginPath(); ctx.ellipse(cx, cy + 5, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
  // Horse head
  ctx.fillStyle = '#7a4e30';
  ctx.beginPath(); ctx.ellipse(cx + 10, cy + 1, 5, 4, -0.3, 0, Math.PI * 2); ctx.fill();
  // Legs
  ctx.fillStyle = '#6B4226';
  for (const lx of [-6, -2, 3, 7]) {
    ctx.fillRect(cx + lx, cy + 9, 2, 6);
  }
  // Rider body
  ctx.fillStyle = playerColor;
  ctx.beginPath(); ctx.arc(cx - 1, cy - 3, 6, 0, Math.PI * 2); ctx.fill();
  // Rider head
  ctx.fillStyle = '#d4a070';
  ctx.beginPath(); ctx.arc(cx - 1, cy - 10, 4, 0, Math.PI * 2); ctx.fill();
  // Helmet
  ctx.fillStyle = '#888';
  ctx.beginPath(); ctx.arc(cx - 1, cy - 11, 4, Math.PI, 0); ctx.fill();
  // Lance
  ctx.strokeStyle = '#8B4513';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx + 4, cy - 8); ctx.lineTo(cx + 16, cy - 2); ctx.stroke();
  ctx.fillStyle = '#aaa';
  ctx.beginPath(); ctx.moveTo(cx + 16, cy - 2); ctx.lineTo(cx + 19, cy - 5); ctx.lineTo(cx + 20, cy - 1); ctx.closePath(); ctx.fill();
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function pixelToTile(e) {
  const rect = G.canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left + G.camSX;
  const sy = e.clientY - rect.top  + G.camSY;
  const w = screenToWorld(sx, sy);
  return { tx: Math.floor(w.tx), ty: Math.floor(w.ty) };
}

function villagerAtTile(tx, ty) {
  return G.snapshot?.villagers.find(v =>
    v.position.x === tx && v.position.y === ty && v.ownerId === G.playerId
  ) ?? null;
}

function resourceAtTile(tx, ty) {
  return G.snapshot?.resourceNodes.find(n =>
    n.position.x === tx && n.position.y === ty
  ) ?? null;
}

function enemyTargetAt(tx, ty) {
  if (!G.snapshot) return null;
  // Enemy unit
  for (const v of G.snapshot.villagers) {
    if (v.ownerId === G.playerId) continue;
    if (v.position.x === tx && v.position.y === ty) return { id: v.id, kind: 'unit' };
  }
  // Enemy building
  for (const b of G.snapshot.playerBuildings ?? []) {
    if (b.ownerId === G.playerId) continue;
    if (tx >= b.x && tx < b.x + b.width && ty >= b.y && ty < b.y + b.height) {
      return { id: b.id, kind: 'building' };
    }
  }
  // Enemy TC
  for (const tc of G.snapshot.townCenters) {
    if (tc.ownerId === G.playerId) continue;
    const ax = tc.anchorPosition.x, ay = tc.anchorPosition.y;
    if (tx >= ax && tx < ax + 3 && ty >= ay && ty < ay + 3) return { id: tc.id, kind: 'town_center' };
  }
  return null;
}

// ─── Input ────────────────────────────────────────────────────────────────────
function setupInput() {
  // Track cursor tile for ghost preview
  G.canvas.addEventListener('mousemove', (e) => {
    G.ghostTile = pixelToTile(e);
  });
  G.canvas.addEventListener('mouseleave', () => {
    G.ghostTile = null;
  });

  G.canvas.addEventListener('click', (e) => {
    const { tx, ty } = pixelToTile(e);

    // Building placement mode
    if (G.placingBuildingType) {
      const def = BUILDING_DEFS[G.placingBuildingType];
      if (def && isTileRangeWalkable(tx, ty, def.width, def.height) && canAffordBuilding(G.placingBuildingType)) {
        // Send selected villager so server assigns them to construct
        const villagerId = G.selectedIds.size === 1 ? [...G.selectedIds][0] : undefined;
        send({ type: 'place_building', buildingType: G.placingBuildingType, x: tx, y: ty, villagerId });
        if (!e.shiftKey) cancelPlacingMode();
      }
      return;
    }

    const v = villagerAtTile(tx, ty);
    if (v) {
      if (!e.shiftKey) G.selectedIds.clear();
      G.selectedIds.add(v.id);
    } else {
      G.selectedIds.clear();
    }
    updatePanel();
  });

  G.canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();

    if (G.placingBuildingType) { cancelPlacingMode(); return; }
    if (G.selectedIds.size === 0) return;

    const { tx, ty } = pixelToTile(e);

    // Check for attack target (enemy unit / building / TC)
    const attackTarget = enemyTargetAt(tx, ty);
    if (attackTarget) {
      for (const vid of G.selectedIds) {
        const v = G.snapshot?.villagers.find(x => x.id === vid);
        if (v && v.unitType !== 'villager') {
          send({ type: 'attack_target', villagerId: vid, targetId: attackTarget.id, targetKind: attackTarget.kind });
        }
      }
      return;
    }

    const node = resourceAtTile(tx, ty);
    if (node) {
      for (const vid of G.selectedIds) send({ type: 'gather_resource', villagerId: vid, nodeId: node.id });
    } else {
      for (const vid of G.selectedIds) send({ type: 'move_villager', villagerId: vid, destination: { x: tx, y: ty } });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      cancelPlacingMode();
      return;
    }
    G.keysHeld[e.key] = true;
    if (['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
      e.preventDefault();
    }
  });

  document.addEventListener('keyup', (e) => { delete G.keysHeld[e.key]; });

  document.querySelectorAll('[data-unit]').forEach(btn => {
    btn.addEventListener('click', () => {
      send({ type: 'train_villager', unitType: btn.dataset.unit });
    });
  });
}

function cancelPlacingMode() {
  G.placingBuildingType = null;
  G.canvas.style.cursor = 'default';
  document.querySelectorAll('.build-btn').forEach(b => b.classList.remove('selected'));
}

// ─── HUD & Panel ──────────────────────────────────────────────────────────────
function updateHUD() {
  if (!G.snapshot || G.myPlayerIndex < 0) return;
  const me = G.snapshot.players[G.myPlayerIndex];
  if (!me) return;
  document.getElementById('res-gold').textContent  = me.resources.gold;
  document.getElementById('res-wood').textContent  = me.resources.wood;
  document.getElementById('res-stone').textContent = me.resources.stone;
  document.getElementById('res-food').textContent  = me.resources.food;

  const myTc = G.snapshot.townCenters.find(tc => tc.ownerId === G.playerId);
  const training = myTc?.isTraining ?? false;
  const r = me.resources;

  document.getElementById('btn-train').disabled         = training || r.food < 50;
  document.getElementById('btn-train-archer').disabled  = training || r.food < 50 || r.wood < 30;
  document.getElementById('btn-train-cavalry').disabled = training || r.food < 80 || r.gold < 50;

  const trainEl = document.getElementById('train-status');
  if (training && myTc) {
    const unitTicks = { villager:20, archer:24, cavalry:40 };
    const totalTicks = unitTicks[myTc.trainingUnitType] ?? 20;
    const secs = Math.ceil(myTc.trainTicksRemaining * 0.25);
    const label = UNIT_DEFS[myTc.trainingUnitType]?.label ?? 'Unidade';
    trainEl.textContent = `⏳ ${label}... ${secs}s`;
  } else {
    trainEl.textContent = '';
  }

  updateBuildBar(me.resources);
}

function updateBuildBar(resources) {
  for (const [type, def] of Object.entries(BUILDING_DEFS)) {
    const btn = document.getElementById(`build-${type}`);
    if (!btn) continue;
    let canAfford = true;
    for (const [res, amt] of Object.entries(def.cost)) {
      if ((resources[res] ?? 0) < amt) { canAfford = false; break; }
    }
    btn.disabled = !canAfford;
  }
}

function updatePanel() {
  const el = document.getElementById('selection-info');
  if (G.selectedIds.size === 0) {
    el.textContent = 'Clique num aldeão para selecionar.';
    return;
  }
  if (!G.snapshot) return;
  const lines = [];
  for (const vid of G.selectedIds) {
    const v = G.snapshot.villagers.find(x => x.id === vid);
    if (!v) continue;
    const stateLabel = { idle:'Ocioso', moving:'Movendo', gathering:'Coletando', constructing:'Construindo', attacking:'Atacando' };
    const unitLabel  = UNIT_DEFS[v.unitType]?.label ?? 'Unidade';
    lines.push(`${unitLabel} [${v.position.x},${v.position.y}]\n❤ ${v.hp}/${v.maxHp} · ${stateLabel[v.state] ?? v.state}`);
  }
  el.textContent = lines.join('\n\n') || 'Aldeão não encontrado.';
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function hideLobby() {
  document.getElementById('lobby').style.display = 'none';

  // Center camera on the player's town-center spawn (iso projected)
  const myAnchor = G.myPlayerIndex === 0 ? { x: 2, y: 2 } : { x: 54, y: 54 };
  const { sx, sy } = worldToScreen(myAnchor.x + 1.5, myAnchor.y + 1.5);
  G.camSX = sx - G.canvas.width  / 2;
  G.camSY = sy - G.canvas.height / 2;
  clampCamera();

  if (!G.animFrameId) gameLoop();
}

function showWaiting() {
  document.getElementById('waiting-overlay').style.display = 'block';
}

function hideWaiting() {
  document.getElementById('waiting-overlay').style.display = 'none';
}

function setLobbyStatus(msg) {
  document.getElementById('lobby-status').textContent = msg;
}

function setHudStatus(msg) {
  document.getElementById('hud-status').textContent = msg;
}

// ─── Minimap ──────────────────────────────────────────────────────────────────

/** Build the static tile layer (called once when mapTiles arrive). */
function buildMinimapBase() {
  const mw = mapWidth();
  const mh = mapHeight();
  const mc = document.createElement('canvas');
  mc.width  = mw;
  mc.height = mh;
  const mctx = mc.getContext('2d');

  for (let ty = 0; ty < mh; ty++) {
    for (let tx = 0; tx < mw; tx++) {
      const tile = G.mapTiles[ty]?.[tx] ?? 'grass';
      mctx.fillStyle =
        tile === 'water' ? '#1e3a5f' :
        tile === 'dirt'  ? '#7a5c3a' : '#3d6b41';
      mctx.fillRect(tx, ty, 1, 1);
    }
  }
  G.minimapCanvas = mc;
}

/** Rebuild the fog overlay image (called when fog changes). */
function buildMinimapFog() {
  const mw = mapWidth();
  const mh = mapHeight();
  const mc = document.createElement('canvas');
  mc.width  = mw;
  mc.height = mh;
  const mctx = mc.getContext('2d');
  const imgData = mctx.createImageData(mw, mh);
  const d = imgData.data;

  for (let ty = 0; ty < mh; ty++) {
    for (let tx = 0; tx < mw; tx++) {
      const i = (ty * mw + tx) * 4;
      if (isTileVisible(tx, ty)) {
        d[i+3] = 0;           // fully transparent — visible
      } else if (isTileRevealed(tx, ty)) {
        d[i+3] = 140;         // dark shroud
      } else {
        d[i+3] = 255;         // solid black — unexplored
      }
    }
  }
  mctx.putImageData(imgData, 0, 0);
  G.minimapFogCanvas = mc;
}

// Minimap iso projection — fits the iso diamond into the minimap canvas.
// Returns the per-unit scale `s` and offsets so that drawing with the affine
// transform (s, s/2, -s, s/2, ox, oy) maps tile-grid pixels onto the diamond.
function minimapTransform() {
  const mw = mapWidth();
  const mh = mapHeight();
  const W  = G.minimapEl.width;
  const H  = G.minimapEl.height;
  const s  = Math.min(W / (mw + mh), H / ((mw + mh) / 2));
  const usedW = s * (mw + mh);
  const usedH = s * (mw + mh) / 2;
  const ox = (W - usedW) / 2 + s * mh;
  const oy = (H - usedH) / 2;
  return { s, ox, oy };
}

function worldToMinimap(tx, ty) {
  const { s, ox, oy } = minimapTransform();
  return { mx: s * (tx - ty) + ox, my: (s / 2) * (tx + ty) + oy };
}

/** Render the minimap onto the dedicated #minimap-canvas element. */
function renderMinimap() {
  const mc  = G.minimapEl;
  const mctx = G.minimapCtx;
  if (!mc || !mctx || !G.minimapCanvas) return;

  const W = mc.width;
  const H = mc.height;
  const { s, ox, oy } = minimapTransform();

  // Background
  mctx.fillStyle = '#1a1209';
  mctx.fillRect(0, 0, W, H);

  // 1. Static tile layer — applies the iso transform to the top-down offscreen canvas
  mctx.save();
  mctx.imageSmoothingEnabled = false;
  mctx.setTransform(s, s / 2, -s, s / 2, ox, oy);
  mctx.drawImage(G.minimapCanvas, 0, 0);
  mctx.restore();

  // Helper: project a tile to minimap pixels (centered)
  const toMini = (tx, ty) => ({
    mx: s * (tx - ty) + ox,
    my: (s / 2) * (tx + ty) + oy,
  });

  // Helper: draw a building footprint as an iso-diamond fill
  const drawIsoFootprint = (tx, ty, w, h, color) => {
    mctx.fillStyle = color;
    const a = toMini(tx,     ty);
    const b = toMini(tx + w, ty);
    const c = toMini(tx + w, ty + h);
    const d = toMini(tx,     ty + h);
    mctx.beginPath();
    mctx.moveTo(a.mx, a.my);
    mctx.lineTo(b.mx, b.my);
    mctx.lineTo(c.mx, c.my);
    mctx.lineTo(d.mx, d.my);
    mctx.closePath();
    mctx.fill();
  };

  // 2. Resource nodes
  if (G.snapshot) {
    for (const node of G.snapshot.resourceNodes) {
      if (!isTileRevealed(node.position.x, node.position.y)) continue;
      const { mx, my } = toMini(node.position.x, node.position.y);
      mctx.fillStyle = COLORS.resources[node.type] ?? '#fff';
      mctx.fillRect(mx - Math.max(1, s), my - Math.max(1, s / 2), Math.max(2, s * 2), Math.max(2, s));
    }
  }

  // 3. Town Centers
  if (G.snapshot) {
    for (const tc of G.snapshot.townCenters) {
      if (!isTileRevealed(tc.anchorPosition.x + 1, tc.anchorPosition.y + 1)) continue;
      const pidx = G.snapshot.players.findIndex(p => p.id === tc.ownerId);
      drawIsoFootprint(tc.anchorPosition.x, tc.anchorPosition.y, 3, 3, COLORS.tc[pidx] ?? '#888');
    }
  }

  // 4. Player buildings
  if (G.snapshot) {
    for (const b of G.snapshot.playerBuildings ?? []) {
      if (!isTileRevealed(b.x, b.y)) continue;
      const def = BUILDING_DEFS[b.type];
      if (!def) continue;
      drawIsoFootprint(b.x, b.y, def.width, def.height, def.color);
    }
  }

  // 5. Villagers
  if (G.snapshot) {
    for (const v of G.snapshot.villagers) {
      const isOwn = v.ownerId === G.playerId;
      if (!isOwn && !isTileVisible(v.position.x, v.position.y)) continue;
      const pidx = G.snapshot.players.findIndex(p => p.id === v.ownerId);
      const { mx, my } = toMini(v.position.x, v.position.y);
      mctx.fillStyle = COLORS.villager[pidx] ?? '#fff';
      const r = Math.max(1.5, s);
      mctx.fillRect(mx - r, my - r / 2, r * 2, r);
    }
  }

  // 6. Fog of war overlay
  if (G.minimapFogCanvas) {
    mctx.save();
    mctx.imageSmoothingEnabled = false;
    mctx.setTransform(s, s / 2, -s, s / 2, ox, oy);
    mctx.drawImage(G.minimapFogCanvas, 0, 0);
    mctx.restore();
  }

  // 7. Camera viewport — main and minimap share iso projection, so the screen-aligned
  //    camera rectangle becomes a screen-aligned rectangle on the minimap.
  const mainToMini = s / TILE_H; // = 2*s/TILE_W (iso 2:1)
  const vx = G.camSX * mainToMini + (ox - mapHeight() * s);
  const vy = G.camSY * mainToMini + oy;
  const vw = G.canvas.width  * mainToMini;
  const vh = G.canvas.height * mainToMini;
  mctx.strokeStyle = 'rgba(255,255,255,0.9)';
  mctx.lineWidth = 1.5;
  mctx.fillStyle = 'rgba(255,255,255,0.08)';
  mctx.beginPath();
  mctx.rect(vx, vy, vw, vh);
  mctx.fill();
  mctx.stroke();
}

/** Move camera so that the minimap click point is the center of the viewport. */
function moveCameraToMinimapPoint(clientX, clientY) {
  const rect = G.minimapEl.getBoundingClientRect();
  const cssX = clientX - rect.left;
  const cssY = clientY - rect.top;
  // Convert CSS click to canvas pixel coords (account for any CSS scaling)
  const mx = cssX * (G.minimapEl.width  / rect.width);
  const my = cssY * (G.minimapEl.height / rect.height);
  // Invert iso transform: tx = (mx-ox)/(2s) + my/s + 0; we use the relations:
  //   tx - ty = (mx - ox) / s
  //   tx + ty = 2 * (my - oy) / s
  const { s, ox, oy } = minimapTransform();
  const a = (mx - ox) / s;
  const b = 2 * (my - oy) / s;
  const targetTileX = (a + b) / 2;
  const targetTileY = (b - a) / 2;
  const { sx, sy } = worldToScreen(targetTileX, targetTileY);
  G.camSX = sx - G.canvas.width  / 2;
  G.camSY = sy - G.canvas.height / 2;
  clampCamera();
}

function setupMinimapInput() {
  const mc = G.minimapEl;

  mc.addEventListener('mousedown', (e) => {
    G.isDraggingMinimap = true;
    moveCameraToMinimapPoint(e.clientX, e.clientY);
  });

  mc.addEventListener('mousemove', (e) => {
    if (G.isDraggingMinimap) moveCameraToMinimapPoint(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', () => { G.isDraggingMinimap = false; });

  mc.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
(function init() {
  G.canvas  = document.getElementById('canvas');
  G.wrapper = document.getElementById('canvas-wrapper');
  G.ctx     = G.canvas.getContext('2d');

  G.minimapEl  = document.getElementById('minimap-canvas');
  G.minimapCtx = G.minimapEl.getContext('2d');

  function resizeCanvas() {
    G.canvas.width  = G.wrapper.clientWidth;
    G.canvas.height = G.wrapper.clientHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  buildTerrainSprites();
  loadSprites();
  loadBuildingSprites();
  setupInput();
  setupMinimapInput();

  document.getElementById('join-btn').addEventListener('click', () => {
    const name = document.getElementById('name-input').value.trim() || 'Guerreiro';
    send({ type: 'join', playerName: name });
  });

  document.getElementById('name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('join-btn').click();
  });

  // Building bar buttons
  document.querySelectorAll('.build-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      if (!type || !BUILDING_DEFS[type]) return;
      if (G.placingBuildingType === type) {
        cancelPlacingMode();
        return;
      }
      G.placingBuildingType = type;
      G.canvas.style.cursor = 'crosshair';
      document.querySelectorAll('.build-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  connect();
})();

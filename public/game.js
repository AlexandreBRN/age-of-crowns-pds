// ─── Constants ────────────────────────────────────────────────────────────────
const TILE = 32;  // pixels per tile

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

  // Camera in tile coordinates (float)
  camX: 0,
  camY: 0,
  keysHeld: {},

  canvas: null,
  ctx: null,
  wrapper: null,
  animFrameId: null,

  sprites: {},           // loaded Image objects
  spritesReady: false,

  // Building placement
  placingBuildingType: null,  // string key from BUILDING_DEFS, or null
  ghostTile: null,            // { tx, ty } — current cursor tile
};

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
const CAM_SPEED = 0.25;

function mapWidth()  { return G.mapTiles?.[0]?.length ?? 100; }
function mapHeight() { return G.mapTiles?.length        ?? 100; }
function visibleTilesX() { return Math.ceil((G.canvas?.width  ?? 800) / TILE) + 1; }
function visibleTilesY() { return Math.ceil((G.canvas?.height ?? 600) / TILE) + 1; }

function gameLoop() {
  G.animFrameId = requestAnimationFrame(gameLoop);

  // Camera panning
  const maxCamX = Math.max(0, mapWidth()  - visibleTilesX());
  const maxCamY = Math.max(0, mapHeight() - visibleTilesY());
  if (G.keysHeld['a'] || G.keysHeld['ArrowLeft'])  G.camX = Math.max(0, G.camX - CAM_SPEED);
  if (G.keysHeld['d'] || G.keysHeld['ArrowRight']) G.camX = Math.min(maxCamX, G.camX + CAM_SPEED);
  if (G.keysHeld['w'] || G.keysHeld['ArrowUp'])    G.camY = Math.max(0, G.camY - CAM_SPEED);
  if (G.keysHeld['s'] || G.keysHeld['ArrowDown'])  G.camY = Math.min(maxCamY, G.camY + CAM_SPEED);

  render();
}

// ─── Rendering ────────────────────────────────────────────────────────────────
function render() {
  const { ctx, canvas, snapshot } = G;
  if (!ctx || !canvas) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const camTX = Math.floor(G.camX);
  const camTY = Math.floor(G.camY);
  const subX  = (G.camX - camTX) * TILE;
  const subY  = (G.camY - camTY) * TILE;

  ctx.save();
  // Translate by full camera position in pixels (world → screen space)
  ctx.translate(-camTX * TILE - subX, -camTY * TILE - subY);

  renderTiles(camTX, camTY);

  if (snapshot) {
    renderResourceNodes(snapshot, camTX, camTY);
    renderTownCenters(snapshot, camTX, camTY);
    renderPlayerBuildings(snapshot, camTX, camTY);
    renderVillagers(snapshot, camTX, camTY);
  }

  renderFog(camTX, camTY);
  renderBuildingGhost();

  ctx.restore();

  renderMinimap();
}

// ── Tiles ────────────────────────────────────────────────────────────────────
function renderTiles(camTX, camTY) {
  const { ctx, mapTiles } = G;
  const vx = visibleTilesX() + 1;
  const vy = visibleTilesY() + 1;

  if (!mapTiles) {
    ctx.fillStyle = '#1a2010';
    ctx.fillRect(0, 0, G.canvas.width + TILE, G.canvas.height + TILE);
    return;
  }

  for (let dy = 0; dy < vy; dy++) {
    const ty = camTY + dy;
    if (ty < 0 || ty >= mapHeight()) continue;
    for (let dx = 0; dx < vx; dx++) {
      const tx = camTX + dx;
      if (tx < 0 || tx >= mapWidth()) continue;

      const px = tx * TILE;
      const py = ty * TILE;
      const tile = mapTiles[ty]?.[tx] ?? 'grass';

      if (tile === 'water') {
        drawWater(ctx, px, py, tx, ty);
      } else if (tile === 'dirt') {
        ctx.fillStyle = COLORS.tiles.dirt[(tx + ty * 3) % 4];
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(px + 4, py + 4, 3, 3);
        ctx.fillRect(px + TILE - 7, py + TILE - 7, 2, 2);
      } else {
        ctx.fillStyle = COLORS.tiles.grass[(tx * 2 + ty) % 4];
        ctx.fillRect(px, py, TILE, TILE);
        // Subtle grass detail
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        if ((tx + ty) % 3 === 0) ctx.fillRect(px + 6, py + 3, 2, 5);
        if ((tx * ty) % 5 === 0) ctx.fillRect(px + TILE - 6, py + TILE - 6, 2, 4);
      }
    }
  }
}

function drawWater(ctx, px, py, tx, ty) {
  const t = Date.now() / 2500;
  const wave = Math.sin(t + tx * 0.08 + ty * 0.06) * 10;
  const b = Math.round(90 + wave);
  ctx.fillStyle = `rgb(25,55,${b})`;
  ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(px + 3, py + TILE / 2, TILE - 6, 2);
}

// ── Resources ────────────────────────────────────────────────────────────────
function renderResourceNodes(snapshot, camTX, camTY) {
  const { ctx } = G;
  for (const node of snapshot.resourceNodes) {
    const tx = node.position.x;
    const ty = node.position.y;
    if (!isInView(tx, ty, camTX, camTY)) continue;
    // Show resource if tile was ever revealed (last-known-state behavior)
    if (!isTileRevealed(tx, ty)) continue;

    const px = tx * TILE;
    const py = ty * TILE;
    const cx = px + TILE / 2;
    const cy = py + TILE / 2;

    switch (node.type) {
      case 'gold':       drawGoldMine(ctx, cx, cy);   break;
      case 'stone':      drawStoneQuarry(ctx, cx, cy); break;
      case 'wood':       drawTree(ctx, cx, cy);        break;
      case 'food_deer':  drawDeer(ctx, cx, cy);        break;
      case 'food_berry': drawBerryBush(ctx, cx, cy);   break;
    }

    // Remaining amount bar
    const maxAmt = { gold: 600, stone: 500, wood: 400, food_deer: 300, food_berry: 250 };
    const pct = node.remaining / (maxAmt[node.type] ?? 500);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(px + 1, py + TILE - 5, TILE - 2, 4);
    ctx.fillStyle = pct > 0.5 ? '#60d040' : pct > 0.2 ? '#d0a040' : '#d04040';
    ctx.fillRect(px + 1, py + TILE - 5, Math.round((TILE - 2) * pct), 4);
  }
}

// ── Town Centers ─────────────────────────────────────────────────────────────
function renderTownCenters(snapshot, camTX, camTY) {
  const { ctx } = G;
  for (const tc of snapshot.townCenters) {
    const ax = tc.anchorPosition.x;
    const ay = tc.anchorPosition.y;
    // Enemy TC: hide if never revealed; show even in shroud (buildings are permanent)
    const isOwn = tc.ownerId === G.playerId;
    if (!isOwn && !isTileRevealed(ax + 1, ay + 1)) continue;
    if (!isInView(ax, ay, camTX, camTY)) continue;

    const px = ax * TILE;
    const py = ay * TILE;
    const playerIdx = snapshot.players.findIndex(p => p.id === tc.ownerId);
    const color = COLORS.tc[playerIdx] ?? '#888';

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(px + 5, py + 5, TILE * 3, TILE * 3);

    // Stone wall
    ctx.fillStyle = '#6a5040';
    ctx.fillRect(px, py, TILE * 3, TILE * 3);

    // Wall texture
    ctx.fillStyle = '#7a6050';
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(px + i * TILE + 3, py + 3, TILE - 7, TILE - 5);
      ctx.fillRect(px + i * TILE + 3, py + TILE * 2 + 5, TILE - 7, TILE - 7);
    }

    // Central keep
    ctx.fillStyle = '#5a4030';
    ctx.fillRect(px + 5, py + 5, TILE * 3 - 10, TILE * 3 - 10);

    // Colored roof
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(px + 8, py + 8, TILE * 3 - 16, TILE * 3 - 16);
    ctx.globalAlpha = 1;

    // Flag
    ctx.fillStyle = color;
    ctx.fillRect(px + TILE + 10, py - 8, 2, 12);
    ctx.fillRect(px + TILE + 12, py - 8, 9, 7);

    // Door
    ctx.fillStyle = '#3a2810';
    ctx.fillRect(px + TILE + 6, py + TILE * 2 + 1, 8, 12);

    // Name
    const pName = snapshot.players[playerIdx]?.name ?? '';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px Georgia';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pName.substring(0, 9), px + TILE * 1.5, py + TILE * 1.5);

    // HP bar
    if (tc.hp < tc.maxHp) {
      const barW = TILE * 3;
      const pct  = tc.hp / tc.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(px, py - 7, barW, 5);
      ctx.fillStyle = pct > 0.5 ? '#50e040' : pct > 0.25 ? '#e0c040' : '#e04040';
      ctx.fillRect(px, py - 7, Math.round(barW * pct), 5);
    }

    // Training progress
    if (tc.isTraining && isOwn) {
      const unitTicks = { villager:20, archer:24, cavalry:40 };
      const totalTicks = unitTicks[tc.trainingUnitType] ?? 20;
      const pct = 1 - tc.trainTicksRemaining / totalTicks;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(px, py + TILE * 3 + 2, TILE * 3, 6);
      ctx.fillStyle = '#60c040';
      ctx.fillRect(px, py + TILE * 3 + 2, Math.round(TILE * 3 * pct), 6);
      ctx.fillStyle = '#fff';
      ctx.font = '8px Georgia';
      ctx.fillText('Treinando...', px + TILE * 1.5, py + TILE * 3 + 13);
    }
  }
}

// ── Villagers ────────────────────────────────────────────────────────────────
function renderVillagers(snapshot, camTX, camTY) {
  const { ctx } = G;
  for (const v of snapshot.villagers) {
    const isOwn = v.ownerId === G.playerId;
    // Enemy villagers only visible in current vision; own units always visible
    if (!isOwn && !isTileVisible(v.position.x, v.position.y)) continue;
    if (!isInView(v.position.x, v.position.y, camTX, camTY)) continue;

    const cx = v.position.x * TILE + TILE / 2;
    const cy = v.position.y * TILE + TILE / 2;
    const isSelected = G.selectedIds.has(v.id);
    const playerIdx  = snapshot.players.findIndex(p => p.id === v.ownerId);

    // Movement path line
    if (isSelected && v.state === 'moving' && v.moveTarget) {
      const tx = v.moveTarget.x * TILE + TILE / 2;
      const ty = v.moveTarget.y * TILE + TILE / 2;
      ctx.strokeStyle = COLORS.moveTarget;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      // Destination marker
      ctx.strokeStyle = COLORS.selected;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tx, ty, 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Gather line
    if (isSelected && v.state === 'gathering' && v.gatherTarget) {
      const node = snapshot.resourceNodes.find(n => n.id === v.gatherTarget);
      if (node) {
        const tx = node.position.x * TILE + TILE / 2;
        const ty = node.position.y * TILE + TILE / 2;
        ctx.strokeStyle = COLORS.gatherTarget;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 5]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Selection ring
    if (isSelected) {
      ctx.strokeStyle = COLORS.selected;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy + 2, TILE / 2 - 1, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(cx + 1, cy + TILE / 2 - 3, 6, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Draw unit based on type
    const pColor = COLORS.villager[playerIdx] ?? '#888';
    if (v.unitType === 'archer') {
      drawArcher(ctx, cx, cy, pColor);
    } else if (v.unitType === 'cavalry') {
      drawCavalry(ctx, cx, cy, pColor);
    } else {
      // Villager: sprite or fallback
      const sprite = spriteForVillager(v);
      if (sprite && sprite.complete && sprite.naturalWidth > 0) {
        const size = TILE - 2;
        ctx.drawImage(sprite, cx - size / 2, cy - size / 2 - 2, size, size);
        ctx.fillStyle = pColor;
        ctx.fillRect(cx - 4, cy + TILE / 2 - 6, 8, 3);
      } else {
        ctx.fillStyle = pColor;
        ctx.beginPath(); ctx.arc(cx, cy + 1, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#d4a070';
        ctx.beginPath(); ctx.arc(cx, cy - 5, 5, 0, Math.PI * 2); ctx.fill();
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
        ctx.arc(cx + TILE / 2 - 4, cy - TILE / 2 + 4, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Health bar (always shown for own units, shown for visible enemies)
    drawUnitHealthBar(ctx, cx, cy, v.hp, v.maxHp);
  }
}

function drawUnitHealthBar(ctx, cx, cy, hp, maxHp) {
  if (hp >= maxHp) return; // full health — hide bar
  const barW = TILE - 4;
  const barH = 3;
  const barX = cx - barW / 2;
  const barY = cy - TILE / 2 - 6;
  const pct  = hp / maxHp;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
  ctx.fillStyle = pct > 0.5 ? '#50e040' : pct > 0.25 ? '#e0c040' : '#e04040';
  ctx.fillRect(barX, barY, Math.round(barW * pct), barH);
}

// ── Player Buildings ─────────────────────────────────────────────────────────
function renderPlayerBuildings(snapshot, camTX, camTY) {
  const { ctx } = G;
  for (const b of snapshot.playerBuildings ?? []) {
    const isOwn = b.ownerId === G.playerId;
    // Show enemy buildings only if tile was revealed
    if (!isOwn && !isTileRevealed(b.x, b.y)) continue;
    // Show own buildings always once placed (buildings persist in fog)
    if (!isInView(b.x, b.y, camTX, camTY)) continue;

    const px = b.x * TILE;
    const py = b.y * TILE;
    const def = BUILDING_DEFS[b.type] ?? { color:'#666', width:1, height:1 };
    const pw = (b.width ?? def.width) * TILE;
    const ph = (b.height ?? def.height) * TILE;
    const pidx = snapshot.players.findIndex(p => p.id === b.ownerId);
    const playerColor = COLORS.tc[pidx] ?? '#888';

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(px + 4, py + 4, pw, ph);

    switch (b.type) {
      case 'wall': {
        // Wall extends above tile so adjacent walls look like a connected rampart
        const wallH = Math.round(TILE * 1.5);
        const wallY = py - (wallH - ph);  // extends upward
        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(px + 4, wallY + 4, pw, wallH);
        // Base stone body
        ctx.fillStyle = '#9a8878';
        ctx.fillRect(px, wallY, pw, wallH);
        // Stone texture rows
        ctx.fillStyle = '#b0a090';
        ctx.fillRect(px + 2, wallY + 3, pw - 4, 5);
        ctx.fillRect(px + 2, wallY + 11, pw - 4, 5);
        ctx.fillRect(px + 2, wallY + 19, pw - 4, 5);
        // Dark mortar lines
        ctx.fillStyle = '#7a6858';
        ctx.fillRect(px, wallY + 8, pw, 2);
        ctx.fillRect(px, wallY + 16, pw, 2);
        ctx.fillRect(px, wallY + 24, pw, 2);
        // Battlements at top
        ctx.fillStyle = '#aaa090';
        ctx.fillRect(px,           wallY - 6, 8, 8);
        ctx.fillRect(px + pw - 8,  wallY - 6, 8, 8);
        // Player color stripe
        ctx.fillStyle = playerColor;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(px + 3, wallY + 3, pw - 6, wallH - 6);
        ctx.globalAlpha = 1;
        // Outline
        ctx.strokeStyle = '#5a4838';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px, wallY, pw, wallH);
        break;
      }

      case 'watchtower':
        ctx.fillStyle = '#8a7860';
        ctx.fillRect(px + 2, py + 6, pw - 4, ph - 6);
        // Tower top
        ctx.fillStyle = '#a09070';
        ctx.fillRect(px, py, pw, 8);
        // Battlements
        ctx.fillStyle = '#b0a080';
        ctx.fillRect(px, py - 5, 7, 7);
        ctx.fillRect(px + pw - 7, py - 5, 7, 7);
        // Arrow slit
        ctx.fillStyle = '#2a1a08';
        ctx.fillRect(px + pw/2 - 1, py + 8, 2, 8);
        // Player flag
        ctx.fillStyle = playerColor;
        ctx.fillRect(px + pw/2 - 1, py - 10, 1.5, 8);
        ctx.fillRect(px + pw/2 + 0.5, py - 10, 7, 5);
        break;

      case 'lumber_camp':
        ctx.fillStyle = '#5a7030';
        ctx.fillRect(px, py, pw, ph);
        ctx.fillStyle = '#7a9048';
        ctx.fillRect(px + 4, py + 4, pw - 8, ph - 8);
        // Log piles
        ctx.fillStyle = '#8a6040';
        ctx.fillRect(px + 6, py + 6, pw/2 - 4, ph/2 - 4);
        ctx.fillStyle = '#7a5030';
        ctx.fillRect(px + 8, py + 8, pw/2 - 8, 5);
        ctx.fillRect(px + 8, py + 14, pw/2 - 8, 5);
        ctx.fillStyle = playerColor;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(px + pw - 10, py + 4, 6, 6);
        ctx.globalAlpha = 1;
        break;

      case 'gold_mine':
        ctx.fillStyle = '#7a6840';
        ctx.fillRect(px, py, pw, ph);
        ctx.fillStyle = '#c09020';
        ctx.fillRect(px + 4, py + 4, pw - 8, ph - 8);
        // Gold vein
        ctx.fillStyle = '#e8c040';
        ctx.fillRect(px + 8, py + 8, pw/2 - 4, ph/2 - 4);
        ctx.fillStyle = '#ffd060';
        ctx.fillRect(px + 10, py + 10, 6, 6);
        ctx.fillStyle = playerColor;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(px + pw - 10, py + 4, 6, 6);
        ctx.globalAlpha = 1;
        break;

      case 'farm':
        ctx.fillStyle = '#6a8020';
        ctx.fillRect(px, py, pw, ph);
        // Crop rows
        ctx.fillStyle = '#a0c040';
        for (let row = 0; row < 3; row++) {
          ctx.fillRect(px + 4, py + 4 + row * (ph / 3.5), pw - 8, (ph / 3.5) - 2);
        }
        ctx.fillStyle = '#d0e060';
        ctx.fillRect(px + 6, py + 6, 6, ph/2 - 4);
        ctx.fillStyle = playerColor;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(px + pw - 10, py + 4, 6, 6);
        ctx.globalAlpha = 1;
        break;

      case 'stone_quarry':
        ctx.fillStyle = '#707070';
        ctx.fillRect(px, py, pw, ph);
        ctx.fillStyle = '#909090';
        ctx.fillRect(px + 4, py + 4, pw - 8, ph - 8);
        // Stone chunks
        ctx.fillStyle = '#aaaaaa';
        ctx.fillRect(px + 6, py + 6, 10, 8);
        ctx.fillRect(px + 18, py + 10, 8, 6);
        ctx.fillStyle = '#cccccc';
        ctx.fillRect(px + 8, py + 8, 5, 4);
        ctx.fillStyle = playerColor;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(px + pw - 10, py + 4, 6, 6);
        ctx.globalAlpha = 1;
        break;

      default:
        ctx.fillStyle = def.color;
        ctx.fillRect(px, py, pw, ph);
    }

    // Border
    ctx.strokeStyle = '#3a2808';
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, pw, ph);

    // HP bar (complete buildings only)
    if (b.status === 'complete' && b.hp < b.maxHp) {
      const barW = pw;
      const pct  = b.hp / b.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(px, py - 6, barW, 4);
      ctx.fillStyle = pct > 0.5 ? '#50e040' : pct > 0.25 ? '#e0c040' : '#e04040';
      ctx.fillRect(px, py - 6, Math.round(barW * pct), 4);
    }

    // Under-construction overlay: scaffolding + progress bar
    if (b.status === 'under_construction') {
      // Semi-transparent dark overlay
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(px, py, pw, ph);

      // Scaffolding cross lines
      ctx.strokeStyle = '#c8a040';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px, py); ctx.lineTo(px + pw, py + ph);
      ctx.moveTo(px + pw, py); ctx.lineTo(px, py + ph);
      ctx.stroke();
      ctx.setLineDash([]);

      // Progress bar at bottom of footprint
      const pct = 1 - (b.constructionTicksRemaining / b.constructionTotalTicks);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(px, py + ph - 5, pw, 5);
      ctx.fillStyle = pct < 0.5 ? '#d08020' : '#60c040';
      ctx.fillRect(px, py + ph - 5, Math.round(pw * pct), 5);
    }
  }
}

// ── Building Ghost Preview ───────────────────────────────────────────────────
function renderBuildingGhost() {
  if (!G.placingBuildingType || !G.ghostTile) return;
  const { ctx } = G;
  const def = BUILDING_DEFS[G.placingBuildingType];
  if (!def) return;

  const { tx, ty } = G.ghostTile;
  const canAfford = canAffordBuilding(G.placingBuildingType);
  const valid = canAfford && isTileRangeWalkable(tx, ty, def.width, def.height);

  ctx.globalAlpha = 0.55;
  ctx.fillStyle = valid ? '#40c040' : '#c04040';
  ctx.fillRect(tx * TILE, ty * TILE, def.width * TILE, def.height * TILE);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = valid ? '#80ff80' : '#ff8080';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(tx * TILE, ty * TILE, def.width * TILE, def.height * TILE);
  ctx.setLineDash([]);

  // Label above ghost
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 9px Georgia';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(def.label, tx * TILE + def.width * TILE / 2, ty * TILE - 2);
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
function renderFog(camTX, camTY) {
  const { ctx } = G;
  const vx = visibleTilesX() + 1;
  const vy = visibleTilesY() + 1;

  for (let dy = 0; dy < vy; dy++) {
    const ty = camTY + dy;
    if (ty < 0 || ty >= mapHeight()) continue;
    for (let dx = 0; dx < vx; dx++) {
      const tx = camTX + dx;
      if (tx < 0 || tx >= mapWidth()) continue;

      const px = tx * TILE;
      const py = ty * TILE;

      if (isTileVisible(tx, ty)) {
        // Fully visible — no overlay
      } else if (isTileRevealed(tx, ty)) {
        // Explored shroud — dark overlay
        ctx.fillStyle = COLORS.fogShroud;
        ctx.fillRect(px, py, TILE, TILE);
      } else {
        // Completely unexplored — solid black
        ctx.fillStyle = COLORS.fogUnexplored;
        ctx.fillRect(px, py, TILE, TILE);
      }
    }
  }
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
function isInView(tx, ty, camTX, camTY) {
  return tx >= camTX - 1
    && tx <= camTX + visibleTilesX() + 1
    && ty >= camTY - 1
    && ty <= camTY + visibleTilesY() + 1;
}

function pixelToTile(e) {
  const rect = G.canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  return {
    tx: Math.floor(px / TILE + G.camX),
    ty: Math.floor(py / TILE + G.camY),
  };
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

  // Set initial camera to player's base
  const mw = mapWidth();
  const mh = mapHeight();
  if (G.myPlayerIndex <= 0) {
    G.camX = 0;
    G.camY = 0;
  } else {
    G.camX = Math.max(0, mw - visibleTilesX() - 2);
    G.camY = Math.max(0, mh - visibleTilesY() - 2);
  }

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

/** Render the minimap onto the dedicated #minimap-canvas element. */
function renderMinimap() {
  const mc  = G.minimapEl;
  const mctx = G.minimapCtx;
  if (!mc || !mctx || !G.minimapCanvas) return;

  const mw = mapWidth();
  const mh = mapHeight();
  const W  = mc.width;
  const H  = mc.height;
  const scaleX = W / mw;
  const scaleY = H / mh;

  // 1. Static tile layer
  mctx.drawImage(G.minimapCanvas, 0, 0, W, H);

  // 2. Resource nodes (dots — last-known-state)
  if (G.snapshot) {
    for (const node of G.snapshot.resourceNodes) {
      if (!isTileRevealed(node.position.x, node.position.y)) continue;
      mctx.fillStyle = COLORS.resources[node.type] ?? '#fff';
      mctx.fillRect(
        node.position.x * scaleX,
        node.position.y * scaleY,
        Math.max(2, scaleX * 1.5),
        Math.max(2, scaleY * 1.5),
      );
    }
  }

  // 3. Town Centers
  if (G.snapshot) {
    for (const tc of G.snapshot.townCenters) {
      if (!isTileRevealed(tc.anchorPosition.x + 1, tc.anchorPosition.y + 1)) continue;
      const pidx = G.snapshot.players.findIndex(p => p.id === tc.ownerId);
      mctx.fillStyle = COLORS.tc[pidx] ?? '#888';
      mctx.fillRect(
        tc.anchorPosition.x * scaleX,
        tc.anchorPosition.y * scaleY,
        3 * scaleX,
        3 * scaleY,
      );
    }
  }

  // 4. Player buildings
  if (G.snapshot) {
    for (const b of G.snapshot.playerBuildings ?? []) {
      if (!isTileRevealed(b.x, b.y)) continue;
      const def = BUILDING_DEFS[b.type];
      if (!def) continue;
      mctx.fillStyle = def.color;
      mctx.fillRect(b.x * scaleX, b.y * scaleY, def.width * scaleX, def.height * scaleY);
    }
  }

  // 5. Villagers
  if (G.snapshot) {
    for (const v of G.snapshot.villagers) {
      const isOwn = v.ownerId === G.playerId;
      if (!isOwn && !isTileVisible(v.position.x, v.position.y)) continue;
      const pidx = G.snapshot.players.findIndex(p => p.id === v.ownerId);
      mctx.fillStyle = COLORS.villager[pidx] ?? '#fff';
      const dotSize = Math.max(3, scaleX * 2);
      mctx.fillRect(
        v.position.x * scaleX - dotSize / 2,
        v.position.y * scaleY - dotSize / 2,
        dotSize, dotSize,
      );
    }
  }

  // 5. Fog of war overlay
  if (G.minimapFogCanvas) {
    mctx.drawImage(G.minimapFogCanvas, 0, 0, W, H);
  }

  // 6. Camera viewport rectangle
  const camW = visibleTilesX() * scaleX;
  const camH = visibleTilesY() * scaleY;
  const camPx = G.camX * scaleX;
  const camPy = G.camY * scaleY;

  mctx.strokeStyle = 'rgba(255,255,255,0.9)';
  mctx.lineWidth = 1.5;
  mctx.strokeRect(camPx, camPy, camW, camH);

  // Semi-transparent interior tint for visibility
  mctx.fillStyle = 'rgba(255,255,255,0.08)';
  mctx.fillRect(camPx, camPy, camW, camH);
}

/** Move camera so that the minimap click point is the center of the viewport. */
function moveCameraToMinimapPoint(clientX, clientY) {
  const rect = G.minimapEl.getBoundingClientRect();
  const relX = (clientX - rect.left)  / rect.width;
  const relY = (clientY - rect.top)   / rect.height;
  const mw = mapWidth();
  const mh = mapHeight();
  const targetTileX = relX * mw;
  const targetTileY = relY * mh;
  const maxCamX = Math.max(0, mw - visibleTilesX());
  const maxCamY = Math.max(0, mh - visibleTilesY());
  G.camX = Math.max(0, Math.min(maxCamX, targetTileX - visibleTilesX() / 2));
  G.camY = Math.max(0, Math.min(maxCamY, targetTileY - visibleTilesY() / 2));
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

  loadSprites();
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

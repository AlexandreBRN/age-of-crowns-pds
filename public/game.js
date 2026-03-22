// ─── Constants ────────────────────────────────────────────────────────────────
const TILE = 20;   // pixels per tile (40x40 map = 800x800 total)
const MAP_SIZE = 40;

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
  tc: ['#c0392b', '#1a6aaa'],       // Town Center colors per player index
  villager: ['#e05040', '#3080c0'], // Villager fill colors per player index
  selected: '#f0d040',
  selectionRing: 'rgba(240,208,64,0.5)',
  moveTarget: 'rgba(240,208,64,0.4)',
  gatherTarget: 'rgba(80,200,80,0.4)',
};

// ─── State ────────────────────────────────────────────────────────────────────
const G = {
  ws: null,
  playerId: null,
  sessionId: null,
  myPlayerIndex: 0,  // 0 = first player, 1 = second
  snapshot: null,    // latest GameStateSnapshot
  mapTiles: null,    // TileType[][] — cached once
  selectedIds: new Set(),

  // Camera (tile offset)
  camX: 0,
  camY: 0,
  keysHeld: {},

  canvas: null,
  ctx: null,
  wrapper: null,
  animFrameId: null,
};

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
  if (G.ws?.readyState === WebSocket.OPEN) {
    G.ws.send(JSON.stringify(payload));
  }
}

// ─── Message Handlers ─────────────────────────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case 'game_joined':
      G.playerId  = msg.playerId;
      G.sessionId = msg.sessionId;
      if (msg.mapTiles) G.mapTiles = msg.mapTiles;
      if (msg.initialSnapshot) {
        G.snapshot = msg.initialSnapshot;
        G.myPlayerIndex = G.snapshot.players.findIndex(p => p.id === G.playerId);
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
      updateHUD();
      updatePanel();
      break;

    case 'error':
      console.warn('[server]', msg.message);
      setHudStatus('⚠ ' + msg.message);
      break;
  }
}

// ─── Camera loop ─────────────────────────────────────────────────────────────
const CAM_SPEED = 0.3; // tiles per frame at 60fps

function gameLoop() {
  G.animFrameId = requestAnimationFrame(gameLoop);

  // Camera movement
  const maxCamX = MAP_SIZE - visibleTilesX();
  const maxCamY = MAP_SIZE - visibleTilesY();
  if (G.keysHeld['a'] || G.keysHeld['ArrowLeft'])  G.camX = Math.max(0, G.camX - CAM_SPEED);
  if (G.keysHeld['d'] || G.keysHeld['ArrowRight']) G.camX = Math.min(maxCamX, G.camX + CAM_SPEED);
  if (G.keysHeld['w'] || G.keysHeld['ArrowUp'])    G.camY = Math.max(0, G.camY - CAM_SPEED);
  if (G.keysHeld['s'] || G.keysHeld['ArrowDown'])  G.camY = Math.min(maxCamY, G.camY + CAM_SPEED);

  render();
}

function visibleTilesX() { return Math.ceil((G.canvas?.width ?? 800) / TILE); }
function visibleTilesY() { return Math.ceil((G.canvas?.height ?? 600) / TILE); }

// ─── Rendering ────────────────────────────────────────────────────────────────
function render() {
  const { ctx, canvas, snapshot, mapTiles } = G;
  if (!ctx || !canvas) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const camTX = Math.floor(G.camX);
  const camTY = Math.floor(G.camY);
  const subX  = (G.camX - camTX) * TILE;
  const subY  = (G.camY - camTY) * TILE;

  ctx.save();
  ctx.translate(-subX, -subY);

  renderTiles(camTX, camTY);

  if (snapshot) {
    renderResourceNodes(snapshot, camTX, camTY);
    renderTownCenters(snapshot, camTX, camTY);
    renderVillagers(snapshot, camTX, camTY);
  }

  ctx.restore();
}

// Tile rendering with medieval palette and slight variation
function renderTiles(camTX, camTY) {
  const { ctx, canvas, mapTiles } = G;
  if (!mapTiles) {
    // Placeholder while waiting for map
    ctx.fillStyle = '#2a4030';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const vx = visibleTilesX() + 2;
  const vy = visibleTilesY() + 2;

  for (let dy = 0; dy < vy; dy++) {
    const y = camTY + dy;
    if (y < 0 || y >= MAP_SIZE) continue;
    for (let dx = 0; dx < vx; dx++) {
      const x = camTX + dx;
      if (x < 0 || x >= MAP_SIZE) continue;
      const tile = mapTiles[y]?.[x] ?? 'grass';
      const px = x * TILE;
      const py = y * TILE;

      if (tile === 'water') {
        drawWater(ctx, px, py);
      } else if (tile === 'dirt') {
        const shade = COLORS.tiles.dirt[(x + y * 3) % 4];
        ctx.fillStyle = shade;
        ctx.fillRect(px, py, TILE, TILE);
        // Pebble texture
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(px + 3, py + 3, 3, 3);
        ctx.fillRect(px + TILE - 6, py + TILE - 6, 2, 2);
      } else {
        // grass
        const shade = COLORS.tiles.grass[(x * 2 + y) % 4];
        ctx.fillStyle = shade;
        ctx.fillRect(px, py, TILE, TILE);
        // Subtle grass texture
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        if ((x + y) % 3 === 0) ctx.fillRect(px + 5, py + 2, 2, 4);
        if ((x * y) % 5 === 0) ctx.fillRect(px + TILE - 5, py + TILE - 5, 2, 3);
      }
    }
  }
}

function drawWater(ctx, px, py) {
  // Animated water (simple gradient)
  const t = Date.now() / 2000;
  const wave = Math.sin(t + px * 0.05 + py * 0.07) * 0.05;
  const r = Math.round(30 + wave * 20);
  const g2 = Math.round(58 + wave * 20);
  const b = 95 + Math.round(wave * 20);
  ctx.fillStyle = `rgb(${r},${g2},${b})`;
  ctx.fillRect(px, py, TILE, TILE);
  // Water sheen
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(px + 2, py + TILE / 2, TILE - 4, 2);
}

// Resource nodes — each type has its own drawing
function renderResourceNodes(snapshot, camTX, camTY) {
  const { ctx } = G;
  for (const node of snapshot.resourceNodes) {
    const px = node.position.x * TILE;
    const py = node.position.y * TILE;
    if (!isInView(node.position.x, node.position.y, camTX, camTY)) continue;

    const cx = px + TILE / 2;
    const cy = py + TILE / 2;

    switch (node.type) {
      case 'gold':       drawGoldMine(ctx, cx, cy); break;
      case 'stone':      drawStoneQuarry(ctx, cx, cy); break;
      case 'wood':       drawTree(ctx, cx, cy); break;
      case 'food_deer':  drawDeer(ctx, cx, cy); break;
      case 'food_berry': drawBerryBush(ctx, cx, cy); break;
    }

    // Amount bar
    const maxAmt = { gold: 600, stone: 500, wood: 400, food_deer: 300, food_berry: 250 };
    const pct = node.remaining / (maxAmt[node.type] ?? 500);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(px + 1, py + TILE - 4, TILE - 2, 3);
    ctx.fillStyle = pct > 0.5 ? '#60d040' : pct > 0.2 ? '#d0a040' : '#d04040';
    ctx.fillRect(px + 1, py + TILE - 4, Math.round((TILE - 2) * pct), 3);
  }
}

function drawGoldMine(ctx, cx, cy) {
  // Gold pile — rotated squares
  ctx.fillStyle = '#b8900a';
  ctx.fillRect(cx - 6, cy - 6, 11, 11);
  ctx.fillStyle = '#e8c040';
  ctx.fillRect(cx - 4, cy - 4, 7, 7);
  ctx.fillStyle = '#ffd060';
  ctx.fillRect(cx - 2, cy - 6, 4, 4);
  ctx.fillRect(cx + 2, cy, 4, 4);
  ctx.fillRect(cx - 6, cy + 1, 4, 4);
  // Glint
  ctx.fillStyle = 'rgba(255,255,200,0.6)';
  ctx.fillRect(cx - 3, cy - 5, 2, 2);
}

function drawStoneQuarry(ctx, cx, cy) {
  ctx.fillStyle = '#6a6a6a';
  ctx.beginPath();
  ctx.arc(cx, cy + 2, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a8a8a';
  ctx.beginPath();
  ctx.arc(cx - 3, cy - 2, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#aaaaaa';
  ctx.beginPath();
  ctx.arc(cx + 3, cy - 3, 4, 0, Math.PI * 2);
  ctx.fill();
  // Crack
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 1, cy - 5);
  ctx.lineTo(cx + 2, cy + 2);
  ctx.stroke();
}

function drawTree(ctx, cx, cy) {
  // Trunk
  ctx.fillStyle = '#5a3a10';
  ctx.fillRect(cx - 2, cy + 2, 4, 6);
  // Foliage layers
  ctx.fillStyle = '#1a5a1a';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 9);
  ctx.lineTo(cx + 7, cy + 4);
  ctx.lineTo(cx - 7, cy + 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2a7a2a';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 6);
  ctx.lineTo(cx + 5, cy + 3);
  ctx.lineTo(cx - 5, cy + 3);
  ctx.closePath();
  ctx.fill();
  // Highlight
  ctx.fillStyle = 'rgba(100,200,80,0.3)';
  ctx.beginPath();
  ctx.arc(cx - 1, cy - 4, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawDeer(ctx, cx, cy) {
  // Body
  ctx.fillStyle = '#a06030';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 2, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Neck + head
  ctx.fillStyle = '#b07040';
  ctx.fillRect(cx + 2, cy - 2, 3, 5);
  ctx.beginPath();
  ctx.arc(cx + 4, cy - 3, 3, 0, Math.PI * 2);
  ctx.fill();
  // Antler
  ctx.strokeStyle = '#804020';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(cx + 5, cy - 5); ctx.lineTo(cx + 3, cy - 9); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 5, cy - 5); ctx.lineTo(cx + 7, cy - 8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 3, cy - 7); ctx.lineTo(cx + 5, cy - 9); ctx.stroke();
  // Legs
  ctx.fillStyle = '#804020';
  ctx.fillRect(cx - 4, cy + 5, 2, 4);
  ctx.fillRect(cx - 1, cy + 5, 2, 4);
  ctx.fillRect(cx + 2, cy + 5, 2, 4);
  ctx.fillRect(cx + 5, cy + 5, 2, 4);
}

function drawBerryBush(ctx, cx, cy) {
  // Bush foliage
  ctx.fillStyle = '#2a5a1a';
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a6a28';
  ctx.beginPath();
  ctx.arc(cx - 3, cy - 2, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + 3, cy - 3, 4, 0, Math.PI * 2);
  ctx.fill();
  // Berries
  const berries = [[-3,1],[0,-2],[3,0],[1,3],[-2,3],[-1,-4]];
  for (const [bx, by] of berries) {
    ctx.fillStyle = '#c03070';
    ctx.beginPath();
    ctx.arc(cx + bx, cy + by, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e04090';
    ctx.beginPath();
    ctx.arc(cx + bx - 0.5, cy + by - 0.5, 1, 0, Math.PI * 2);
    ctx.fill();
  }
}

function renderTownCenters(snapshot, camTX, camTY) {
  const { ctx } = G;
  for (const tc of snapshot.townCenters) {
    const px = tc.anchorPosition.x * TILE;
    const py = tc.anchorPosition.y * TILE;
    if (!isInView(tc.anchorPosition.x, tc.anchorPosition.y, camTX, camTY)) continue;

    const playerIdx = snapshot.players.findIndex(p => p.id === tc.ownerId);
    const color = COLORS.tc[playerIdx] ?? '#888';

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(px + 4, py + 4, TILE * 3, TILE * 3);

    // Stone wall base
    ctx.fillStyle = '#6a5040';
    ctx.fillRect(px, py, TILE * 3, TILE * 3);

    // Wall texture — crenellations
    ctx.fillStyle = '#7a6050';
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(px + i * TILE + 2, py + 2, TILE - 6, TILE - 4);
      ctx.fillRect(px + i * TILE + 2, py + TILE * 2 + 4, TILE - 6, TILE - 6);
    }

    // Central keep
    ctx.fillStyle = '#5a4030';
    ctx.fillRect(px + 4, py + 4, TILE * 3 - 8, TILE * 3 - 8);

    // Roof / top
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(px + 6, py + 6, TILE * 3 - 12, TILE * 3 - 12);
    ctx.globalAlpha = 1;

    // Banner flag
    ctx.fillStyle = color;
    ctx.fillRect(px + TILE + 8, py - 6, 2, 10);
    ctx.fillRect(px + TILE + 10, py - 6, 8, 6);

    // Door
    ctx.fillStyle = '#3a2810';
    ctx.fillRect(px + TILE + 5, py + TILE * 2, 8, 10);

    // Player label
    const pName = snapshot.players[playerIdx]?.name ?? '';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px Georgia';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pName.substring(0, 8), px + TILE * 1.5, py + TILE * 1.5);

    // Training progress bar
    if (tc.isTraining) {
      const pct = 1 - (tc.trainTicksRemaining / 20);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(px, py + TILE * 3 + 2, TILE * 3, 5);
      ctx.fillStyle = '#60c040';
      ctx.fillRect(px, py + TILE * 3 + 2, Math.round(TILE * 3 * pct), 5);
      ctx.fillStyle = '#fff';
      ctx.font = '7px Georgia';
      ctx.fillText('Treinando...', px + TILE * 1.5, py + TILE * 3 + 11);
    }
  }
}

function renderVillagers(snapshot, camTX, camTY) {
  const { ctx } = G;
  for (const v of snapshot.villagers) {
    if (!isInView(v.position.x, v.position.y, camTX, camTY)) continue;
    const cx = v.position.x * TILE + TILE / 2;
    const cy = v.position.y * TILE + TILE / 2;
    const isSelected = G.selectedIds.has(v.id);
    const playerIdx = snapshot.players.findIndex(p => p.id === v.ownerId);
    const fillColor = COLORS.villager[playerIdx] ?? '#888';
    const isMe = v.ownerId === G.playerId;

    // Movement path line
    if (isSelected && v.state === 'moving' && v.moveTarget) {
      const tx = v.moveTarget.x * TILE + TILE / 2;
      const ty = v.moveTarget.y * TILE + TILE / 2;
      ctx.strokeStyle = COLORS.moveTarget;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      // Target marker
      ctx.strokeStyle = COLORS.selected;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(tx, ty, 4, 0, Math.PI * 2);
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
        ctx.setLineDash([2, 4]);
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
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(cx + 1, cy + 7, 5, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body (tunic)
    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.arc(cx, cy + 1, 6, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = '#d4a070';
    ctx.beginPath();
    ctx.arc(cx, cy - 5, 4, 0, Math.PI * 2);
    ctx.fill();

    // Helmet (own player = red, other = blue tint)
    ctx.fillStyle = isMe ? '#c03030' : '#204080';
    ctx.fillRect(cx - 3, cy - 9, 6, 3);

    // State indicator dot
    if (v.state === 'gathering') {
      ctx.fillStyle = '#60d040';
      ctx.beginPath();
      ctx.arc(cx + 7, cy - 7, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (v.state === 'moving') {
      ctx.fillStyle = '#d0d040';
      ctx.beginPath();
      ctx.arc(cx + 7, cy - 7, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ─── Input ────────────────────────────────────────────────────────────────────
function setupInput() {
  const canvas = G.canvas;

  canvas.addEventListener('click', (e) => {
    const { tx, ty } = pixelToTile(e);
    const villager = villagerAtTile(tx, ty);
    if (villager && villager.ownerId === G.playerId) {
      if (!e.shiftKey) G.selectedIds.clear();
      G.selectedIds.add(villager.id);
    } else {
      G.selectedIds.clear();
    }
    updatePanel();
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (G.selectedIds.size === 0) return;
    const { tx, ty } = pixelToTile(e);

    // Check if clicked on a resource node
    const node = resourceAtTile(tx, ty);
    if (node) {
      for (const vid of G.selectedIds) {
        send({ type: 'gather_resource', villagerId: vid, nodeId: node.id });
      }
    } else {
      // Move command
      for (const vid of G.selectedIds) {
        send({ type: 'move_villager', villagerId: vid, destination: { x: tx, y: ty } });
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    G.keysHeld[e.key] = true;
    // Prevent WASD from scrolling page
    if (['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
      e.preventDefault();
    }
  });

  document.addEventListener('keyup', (e) => {
    delete G.keysHeld[e.key];
  });

  document.getElementById('btn-train').addEventListener('click', () => {
    send({ type: 'train_villager' });
  });
}

function pixelToTile(e) {
  const rect = G.canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const tx = Math.floor(px / TILE + G.camX);
  const ty = Math.floor(py / TILE + G.camY);
  return { tx, ty };
}

function villagerAtTile(tx, ty) {
  if (!G.snapshot) return null;
  return G.snapshot.villagers.find(
    v => v.position.x === tx && v.position.y === ty
  ) ?? null;
}

function resourceAtTile(tx, ty) {
  if (!G.snapshot) return null;
  return G.snapshot.resourceNodes.find(
    n => n.position.x === tx && n.position.y === ty
  ) ?? null;
}

function isInView(tx, ty, camTX, camTY) {
  return tx >= camTX - 2
    && tx <= camTX + visibleTilesX() + 2
    && ty >= camTY - 2
    && ty <= camTY + visibleTilesY() + 2;
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

  const food = me.resources.food;
  document.getElementById('btn-train').disabled = food < 50;

  // Train status
  const myTc = G.snapshot.townCenters.find(tc => tc.ownerId === G.playerId);
  const trainEl = document.getElementById('train-status');
  if (myTc?.isTraining) {
    const secs = Math.ceil(myTc.trainTicksRemaining * 0.25);
    trainEl.textContent = `⏳ Treinando... ${secs}s`;
    document.getElementById('btn-train').disabled = true;
  } else {
    trainEl.textContent = '';
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
    const stateLabel = { idle: 'Ocioso', moving: 'Movendo', gathering: 'Coletando' };
    lines.push(`Aldeão [${v.position.x}, ${v.position.y}]\nEstado: ${stateLabel[v.state] ?? v.state}`);
  }
  el.textContent = lines.join('\n\n');
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function hideLobby() {
  document.getElementById('lobby').style.display = 'none';
  // Set initial camera to player's base
  if (G.myPlayerIndex === 0) { G.camX = 0; G.camY = 0; }
  else { G.camX = Math.max(0, MAP_SIZE - visibleTilesX()); G.camY = Math.max(0, MAP_SIZE - visibleTilesY()); }
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

// ─── Bootstrap ────────────────────────────────────────────────────────────────
(function init() {
  G.canvas  = document.getElementById('canvas');
  G.wrapper = document.getElementById('canvas-wrapper');
  G.ctx     = G.canvas.getContext('2d');

  // Resize canvas to fill wrapper
  function resizeCanvas() {
    G.canvas.width  = G.wrapper.clientWidth;
    G.canvas.height = G.wrapper.clientHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  setupInput();

  document.getElementById('join-btn').addEventListener('click', () => {
    const name = document.getElementById('name-input').value.trim() || 'Guerreiro';
    send({ type: 'join', playerName: name });
  });

  document.getElementById('name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('join-btn').click();
  });

  connect();
})();

// ─── Constants ────────────────────────────────────────────────────────────────
const TILE   = 32;
const COLORS = { me: '#f78166', other: '#58a6ff', text: '#ffffff', grid: '#1c2128', tile0: '#161b22', tile1: '#0d1117' };

const KEY_MAP = {
  ArrowUp: 'up',    w: 'up',    W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
};

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  ws: null,
  playerId: null,
  session: null,
  canvas: null,
  ctx: null,
};

// ─── WebSocket ────────────────────────────────────────────────────────────────
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${protocol}//${location.host}`);

  state.ws.addEventListener('open', () => {
    document.getElementById('status').textContent = 'Conectado. Digite seu nome e entre.';
    document.getElementById('joinBtn').disabled = false;
  });

  state.ws.addEventListener('close', () => {
    document.getElementById('status').textContent = 'Desconectado do servidor.';
    document.getElementById('joinBtn').disabled = true;
  });

  state.ws.addEventListener('message', (e) => {
    try {
      handleMessage(JSON.parse(e.data));
    } catch (_) {}
  });
}

function send(payload) {
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(payload));
  }
}

// ─── Message Handlers ─────────────────────────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case 'session_state':
      state.playerId = msg.playerId;
      state.session  = msg.session;
      showGame();
      render();
      break;

    case 'player_joined':
      if (state.session) {
        state.session.players.push(msg.player);
        updatePlayerCount();
        render();
      }
      break;

    case 'player_moved': {
      if (!state.session) break;
      const p = state.session.players.find((x) => x.id === msg.playerId);
      if (p) {
        p.position = msg.position;
        render();
      }
      break;
    }

    case 'player_left':
      if (state.session) {
        state.session.players = state.session.players.filter((x) => x.id !== msg.playerId);
        updatePlayerCount();
        render();
      }
      break;

    case 'error':
      console.warn('[server error]', msg.message);
      break;
  }
}

// ─── UI ───────────────────────────────────────────────────────────────────────
function showGame() {
  document.getElementById('lobby').style.display = 'none';
  const gameEl = document.getElementById('game');
  gameEl.style.display = 'flex';

  state.canvas = document.getElementById('canvas');
  state.ctx    = state.canvas.getContext('2d');

  if (state.session) {
    state.canvas.width  = state.session.mapWidth  * TILE;
    state.canvas.height = state.session.mapHeight * TILE;
  }

  updatePlayerCount();
}

function updatePlayerCount() {
  if (!state.session) return;
  const n = state.session.players.length;
  document.getElementById('playerCount').textContent =
    n < 2 ? `Aguardando outro jogador… (${n}/2)` : `Sessão cheia (${n}/2)`;
}

// ─── Rendering ────────────────────────────────────────────────────────────────
function render() {
  const { ctx, session } = state;
  if (!ctx || !session) return;

  const { mapWidth, mapHeight } = session;

  // Tiles
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? COLORS.tile0 : COLORS.tile1;
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }

  // Grid lines
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth   = 0.5;
  for (let x = 0; x <= mapWidth; x++) {
    ctx.beginPath();
    ctx.moveTo(x * TILE, 0);
    ctx.lineTo(x * TILE, mapHeight * TILE);
    ctx.stroke();
  }
  for (let y = 0; y <= mapHeight; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * TILE);
    ctx.lineTo(mapWidth * TILE, y * TILE);
    ctx.stroke();
  }

  // Players
  session.players.forEach((player) => {
    const isMe  = player.id === state.playerId;
    const color = isMe ? COLORS.me : COLORS.other;
    const cx    = player.position.x * TILE + TILE / 2;
    const cy    = player.position.y * TILE + TILE / 2;
    const r     = TILE / 2 - 4;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx + 1, cy + r + 2, r * 0.6, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Border highlight for local player
    if (isMe) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 2;
      ctx.stroke();
    }

    // Name label
    const label = player.name.length > 8 ? player.name.slice(0, 7) + '…' : player.name;
    ctx.fillStyle    = COLORS.text;
    ctx.font         = `bold 9px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, cx, player.position.y * TILE + TILE - 11);
  });
}

// ─── Input ────────────────────────────────────────────────────────────────────
function handleKeyDown(e) {
  if (!state.playerId) return;
  const direction = KEY_MAP[e.key];
  if (!direction) return;
  e.preventDefault();
  send({ type: 'move', direction });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.getElementById('joinBtn').addEventListener('click', () => {
  const name = document.getElementById('nameInput').value.trim() || 'Player';
  send({ type: 'join', playerName: name });
});

document.getElementById('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('joinBtn').click();
});

document.addEventListener('keydown', handleKeyDown);

connect();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '2mb' }));
// ─── CORS (sadece geliştirme için) ───────────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── GNU Backgammon Entegrasyonu ──────────────────────────────────────────────
let gnubg = null;
try {
    gnubg = require('./gnubg-bridge');
    // Sadece log - gnubg'yi null yapma, her status sorgusunda tekrar dene
    gnubg.checkAvailability().then(info => {
        if (info.available) {
            console.log(`✅ GNU Backgammon bulundu: ${info.version}`);
        } else {
            console.warn('⚠️  GNU Backgammon bulunamadı (PATH kontrol edin).');
        }
    }).catch(() => {});
} catch(e) {
    console.warn('⚠️  gnubg-bridge yüklenemedi:', e.message);
}

// ─── HTTP API: Oyun Analizi ───────────────────────────────────────────────────

// gnubg durumunu sorgula
app.get('/api/gnubg/status', async (req, res) => {
    if (!gnubg) {
        // Bridge yüklenemedi - tekrar dene
        try { gnubg = require('./gnubg-bridge'); } catch(e) {}
    }
    if (!gnubg) {
        return res.json({ available: false, message: 'gnubg-bridge yüklenemedi' });
    }
    try {
        const info = await gnubg.checkAvailability();
        res.json({ available: info.available, version: info.version });
    } catch(e) {
        res.json({ available: false, message: e.message });
    }
});

// Tek pozisyon analizi
app.post('/api/gnubg/analyze-position', async (req, res) => {
    if (!gnubg) {
        return res.status(503).json({ error: 'GNU Backgammon mevcut değil' });
    }
    const { board, bar, borneOff, turn, dice } = req.body;
    if (!board || !turn || !dice) {
        return res.status(400).json({ error: 'Eksik parametre: board, turn, dice gerekli' });
    }
    try {
        const result = await gnubg.analyzePosition(board, bar || {white:0,black:0}, borneOff || {white:0,black:0}, turn, dice);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Tüm oyun analizi (tur listesi)
app.post('/api/gnubg/analyze-game', async (req, res) => {
    if (!gnubg) {
        return res.status(503).json({ error: 'GNU Backgammon mevcut değil' });
    }
    const { turnHistory } = req.body;
    if (!Array.isArray(turnHistory)) {
        return res.status(400).json({ error: 'turnHistory dizisi gerekli' });
    }
    if (turnHistory.length > 200) {
        return res.status(400).json({ error: 'Maksimum 200 tur analiz edilebilir' });
    }
    try {
        const results = await gnubg.analyzeGame(turnHistory);
        // Debug: boş topMoves varsa logla
        const emptyCount = results.filter(r => !r.skipped && !r.error && r.topMoves?.length === 0).length;
        if (emptyCount > 0) {
            console.warn(`⚠ ${emptyCount} turda gnubg hamle bulunamadı. Örnek _debug:`,
                results.find(r => r._debug)?._debug?.slice(0, 200));
        }
        res.json({ results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Oyun Sabitleri ───────────────────────────────────────────────────────────
// Standart tavla dizilişi (index 1-24, Beyaz=+, Siyah=-)
// index 0 kullanılmaz (placeholder)
//
// Beyaz yönü: 24 -> 1  (saat yönünün tersi), Home: 1-6
// Siyah yönü:  1 -> 24 (saat yönü),          Home: 19-24
//
// Başlangıç dizilişi:
//   Beyaz: 2 pul #24, 5 pul #13, 3 pul #8, 5 pul #6
//   Siyah: 2 pul #1,  5 pul #12, 3 pul #17, 5 pul #19
const INITIAL_BOARD = [
  //  0(unused)  1   2   3   4   5   6    7   8   9  10  11  12
       0,       -2,  0,  0,  0,  0,  5,   0,  3,  0,  0,  0, -5,
  //  13  14  15  16  17  18  19  20  21  22  23  24
       5,  0,  0,  0, -3,  0, -5,  0,  0,  0,  0,  2
];

// ─── Oda Yönetimi ─────────────────────────────────────────────────────────────
const rooms = new Map();

function createRoom(roomId, settings) {
  return {
    id: roomId,
    players: [],
    settings: settings,
    gameState: null,
    matchScore: { white: 0, black: 0 },
    crawfordDone: false,
    crawfordGame: false,
    crawfordTriggered: false,
    gameNumber: 0,
    gameHistory: []  // Tüm oyunun tur bazlı hamle geçmişi
  };
}

function createGameState(firstTurn) {
  return {
    board: [...INITIAL_BOARD],
    bar: { white: 0, black: 0 },
    borneOff: { white: 0, black: 0 },
    turn: firstTurn,
    dice: [],
    diceUsed: [],
    phase: 'waiting_roll',
    cube: {
      value: 1,
      owner: null,
      offered: false,
      offeredBy: null
    },
    moveHistory: [],

    currentTurnMoves: [], // Mevcut turda yapılan hamleler
    currentTurnBoard: null, // Tur başındaki tahta
    lastRoll: null,
    winner: null,
    winType: 'normal'
  };
}

// ─── Pozisyon Yardımcıları ────────────────────────────────────────────────────

function allInHome(board, bar, color) {
  if (color === 'white') {
    // Beyaz home: 1-6
    if (bar.white > 0) return false;
    for (let i = 7; i <= 24; i++) {
      if (board[i] > 0) return false;
    }
  } else {
    // Siyah home: 19-24
    if (bar.black > 0) return false;
    for (let i = 1; i <= 18; i++) {
      if (board[i] < 0) return false;
    }
  }
  return true;
}

function isValidPoint(board, point, color) {
  const val = board[point];
  if (color === 'white') return val >= 0 || val === -1;
  return val <= 0 || val === 1;
}

function checkBearOff(board, bar, from, dv, color) {
  if (color === 'white') {
    // Beyaz home: 1-6, yön=-1, bearing off -> point < 1
    if (from - dv === 0) return true;   // tam exact (zar = from)
    if (from - dv < 0) {
      // Overshoot: from'dan yüksek numaralı beyaz pul yoksa geçerli
      for (let p = from + 1; p <= 6; p++) {
        if (board[p] > 0) return false;
      }
      return true;
    }
  } else {
    // Siyah home: 19-24, yön=+1, bearing off -> point > 24
    if (from + dv === 25) return true;  // tam exact (zar = 25-from)
    if (from + dv > 25) {
      // Overshoot: from'dan düşük numaralı siyah pul yoksa geçerli
      for (let p = 19; p < from; p++) {
        if (board[p] < 0) return false;
      }
      return true;
    }
  }
  return false;
}

// ─── Hamle Üretimi ────────────────────────────────────────────────────────────

function getLegalMovesRaw(gs) {
  const { board, bar, dice, diceUsed, turn } = gs;
  const moves = [];
  const remainingDice = dice.filter((_, i) => !diceUsed.includes(i));
  if (remainingDice.length === 0) return [];

  const color = turn;
  const dir = color === 'white' ? -1 : 1;
  const hasBar = color === 'white' ? bar.white > 0 : bar.black > 0;

  const usedDiceValues = new Set();

  for (let di = 0; di < dice.length; di++) {
    if (diceUsed.includes(di)) continue;
    const dv = dice[di];
    if (usedDiceValues.has(dv)) continue;
    usedDiceValues.add(dv);

    if (hasBar) {
      // Bar girişi: Siyah -> nokta (dv), Beyaz -> nokta (25-dv)
      const entryPoint = color === 'black' ? dv : 25 - dv;
      if (entryPoint >= 1 && entryPoint <= 24) {
        if (isValidPoint(board, entryPoint, color)) {
          moves.push({ from: 'bar', to: entryPoint, diceIdx: di });
        }
      }
    } else {
      for (let from = 1; from <= 24; from++) {
        const val = board[from];
        const hasChecker = color === 'white' ? val > 0 : val < 0;
        if (!hasChecker) continue;

        const to = from + dir * dv;

        if (to >= 1 && to <= 24) {
          if (isValidPoint(board, to, color)) {
            moves.push({ from, to, diceIdx: di });
          }
        } else {
          if (allInHome(board, bar, color)) {
            if (checkBearOff(board, bar, from, dv, color)) {
              moves.push({ from, to: 'off', diceIdx: di });
            }
          }
        }
      }
    }
  }
  return moves;
}

function simulateMove(gs, move) {
  const nextGs = JSON.parse(JSON.stringify(gs));
  const { board, bar, borneOff, turn } = nextGs;
  const color = turn;

  if (move.from === 'bar') {
    if (color === 'white') bar.white--;
    else bar.black--;
  } else {
    if (color === 'white') board[move.from]--;
    else board[move.from]++;
  }

  if (move.to === 'off') {
    if (color === 'white') borneOff.white++;
    else borneOff.black++;
  } else {
    const targetVal = board[move.to];
    const isHit = color === 'white' ? targetVal === -1 : targetVal === 1;
    if (isHit) {
      if (color === 'white') bar.black++;
      else bar.white++;
      board[move.to] = 0;
    }
    if (color === 'white') board[move.to]++;
    else board[move.to]--;
  }

  nextGs.diceUsed.push(move.diceIdx);
  return nextGs;
}

function getBestPathMetrics(gs) {
  const moves = getLegalMovesRaw(gs);
  if (moves.length === 0) return { count: 0, pips: 0 };

  let maxCount = 0;
  let maxPips = 0;

  for (const move of moves) {
    const nextGs = simulateMove(gs, move);
    const pipValue = gs.dice[move.diceIdx];
    const nextMetrics = getBestPathMetrics(nextGs);
    const currentCount = 1 + nextMetrics.count;
    const currentPips = pipValue + nextMetrics.pips;

    if (currentCount > maxCount) {
      maxCount = currentCount;
      maxPips = currentPips;
    } else if (currentCount === maxCount && currentPips > maxPips) {
      maxPips = currentPips;
    }
  }
  return { count: maxCount, pips: maxPips };
}

function getLegalMoves(gs) {
  const baseMoves = getLegalMovesRaw(gs);
  if (baseMoves.length === 0) return [];

  let globalMaxCount = 0;
  let globalMaxPips = 0;
  const moveMetrics = [];

  for (const move of baseMoves) {
    const nextGs = simulateMove(gs, move);
    const pipValue = gs.dice[move.diceIdx];
    const nextMetrics = getBestPathMetrics(nextGs);
    const count = 1 + nextMetrics.count;
    const pips = pipValue + nextMetrics.pips;

    moveMetrics.push({ move, count, pips });

    if (count > globalMaxCount) {
      globalMaxCount = count;
      globalMaxPips = pips;
    } else if (count === globalMaxCount && pips > globalMaxPips) {
      globalMaxPips = pips;
    }
  }

  return moveMetrics
    .filter(m => {
      if (m.count === globalMaxCount) {
        if (globalMaxCount === 1) {
          return m.pips === globalMaxPips;
        }
        return true;
      }
      return false;
    })
    .map(m => m.move);
}

// ─── Hamle Uygulama ───────────────────────────────────────────────────────────

function applyMove(gs, move) {
  const snapshot = JSON.parse(JSON.stringify(gs));
  const { board, bar, borneOff, turn } = gs;
  const color = turn;

  if (move.from === 'bar') {
    if (color === 'white') bar.white--;
    else bar.black--;
  } else {
    if (color === 'white') board[move.from]--;
    else board[move.from]++;
  }

  if (move.to === 'off') {
    if (color === 'white') borneOff.white++;
    else borneOff.black++;
  } else {
    const targetVal = board[move.to];
    const isHit = color === 'white' ? targetVal === -1 : targetVal === 1;
    if (isHit) {
      if (color === 'white') bar.black++;
      else bar.white++;
      board[move.to] = 0;
    }
    if (color === 'white') board[move.to]++;
    else board[move.to]--;
  }

  gs.diceUsed.push(move.diceIdx);
  gs.moveHistory.push({ move, snapshot });

  if (borneOff.white === 15) {
    gs.phase = 'game_over';
    gs.winner = 'white';
    gs.winType = getWinType(gs, 'white');
  } else if (borneOff.black === 15) {
    gs.phase = 'game_over';
    gs.winner = 'black';
    gs.winType = getWinType(gs, 'black');
  }

  return snapshot;
}

function getWinType(gs, winner) {
  const loser = winner === 'white' ? 'black' : 'white';
  if (gs.borneOff[loser] > 0) return 'normal';
  // Beyaz home: 1-6, Siyah home: 19-24
  const winnerHome = winner === 'white' ? [1,2,3,4,5,6] : [19,20,21,22,23,24];
  const hasInWinnerHome = winnerHome.some(p => {
    const v = gs.board[p];
    return loser === 'white' ? v > 0 : v < 0;
  });
  const barCount = gs.bar[loser];
  if (barCount > 0 || hasInWinnerHome) return 'backgammon';
  return 'gammon';
}

// ─── Tur Yönetimi ─────────────────────────────────────────────────────────────

function endTurn(room) {
  const gs = room.gameState;

  // Turu kaydet
  if (gs.currentTurnBoard && gs.dice && gs.dice.length > 0) {
    const turnEntry = {
      color: gs.turn,
      dice: [...gs.dice],
      moves: gs.currentTurnMoves ? [...gs.currentTurnMoves] : [],
      boardBefore: gs.currentTurnBoard,
      boardAfter: JSON.parse(JSON.stringify({ board: gs.board, bar: gs.bar, borneOff: gs.borneOff }))
    };
    room.gameHistory.push(turnEntry);
  }

  gs.turn = gs.turn === 'white' ? 'black' : 'white';
  gs.dice = [];
  gs.diceUsed = [];
  gs.phase = 'waiting_roll';
  gs.moveHistory = [];
  gs.currentTurnMoves = [];
  gs.currentTurnBoard = null;
  broadcast(room, { type: 'game_state', state: getPublicState(room) });

  // Bot sırası mı?
  setTimeout(() => triggerBotTurn(room), 500);
}

// ─── Bot (AI) Mantığı ───
async function triggerBotTurn(room) {
  const gs = room.gameState;
  if (!gs || gs.phase === 'game_over') return;

  const currentPlayer = room.players.find(p => p.color === gs.turn);
  if (!currentPlayer || !currentPlayer.isBot) return;

  // Bot sırası!
  console.log(`[BOT] Bot sırası başladı (${gs.turn}, Phase: ${gs.phase})`);

  if (gs.phase === 'waiting_roll') {
    // 1 sn bekle ve zar at
    setTimeout(() => {
      if (gs.phase !== 'waiting_roll' || gs.turn !== currentPlayer.color) return;
      
      const dice = rollDice();
      gs.dice = dice;
      gs.diceUsed = [];
      gs.phase = 'moving';
      gs.currentTurnMoves = [];
      gs.currentTurnBoard = JSON.parse(JSON.stringify({ board: gs.board, bar: gs.bar, borneOff: gs.borneOff }));

      broadcast(room, { type: 'dice_rolled', dice, turn: gs.turn, state: getPublicState(room) });
      
      // Hamle aşamasına geç
      setTimeout(() => triggerBotTurn(room), 1000);
    }, 1200);

  } else if (gs.phase === 'moving') {
    // GNUBG'den hamle iste
    try {
      if (!gnubg) throw new Error("GNUBG Bridge mevcut değil");

      const result = await gnubg.analyzePosition(gs.board, gs.bar, gs.borneOff, gs.turn, gs.dice);
      
      if (result.error || !result.bestMove) {
        console.warn("[BOT] Hamle bulunamadı veya hata:", result.error);
        setTimeout(() => endTurn(room), 500);
        return;
      }

      console.log(`[BOT] GNUBG Hamlesi: ${result.bestMove.moveStr}`);
      const botMoves = result.bestMove.moves || [];

      // Hamleleri sırayla uygula
      let delay = 800;
      for (const m of botMoves) {
        setTimeout(() => {
          if (gs.phase !== 'moving' || gs.turn !== currentPlayer.color) return;
          
          // Geçerli hamle mi kontrol et (Emniyet için)
          const legal = getLegalMoves(gs);
          const valid = legal.find(lm => lm.from === m.from && lm.to === m.to);
          
          if (valid) {
            applyMove(gs, valid);
            if (gs.currentTurnMoves) gs.currentTurnMoves.push({...valid, hit: m.hit});
            broadcast(room, { type: 'game_state', state: getPublicState(room) });
          }
        }, delay);
        delay += 800;
      }

      // Tüm hamleler bittiğinde sırayı bitir
      setTimeout(() => {
        if (gs.phase === 'game_over') return;
        endTurn(room);
      }, delay + 500);

    } catch (err) {
      console.error("[BOT] Hata:", err.message);
      setTimeout(() => endTurn(room), 1000);
    }
  }
}

function rollDice() {
  const d1 = Math.ceil(Math.random() * 6);
  const d2 = Math.ceil(Math.random() * 6);
  if (d1 === d2) return [d1, d1, d1, d1];
  return [d1, d2];
}

// ─── Mesaj İşleyici ───────────────────────────────────────────────────────────

function handleMessage(ws, room, msg) {
  const gs = room.gameState;
  const player = room.players.find(p => p.ws === ws);
  if (!player) return;

  switch (msg.type) {

    case 'roll_dice': {
      if (!gs || gs.phase !== 'waiting_roll') return;
      if (gs.turn !== player.color) return;
      if (gs.cube.offered) return;

      const dice = rollDice();
      gs.dice = dice;
      gs.diceUsed = [];
      gs.phase = 'moving';
      gs.moveHistory = [];
      gs.currentTurnMoves = [];
      gs.currentTurnBoard = JSON.parse(JSON.stringify({ board: gs.board, bar: gs.bar, borneOff: gs.borneOff }));

      broadcast(room, { type: 'dice_rolled', dice, turn: gs.turn, state: getPublicState(room) });

      const legal = getLegalMoves(gs);
      if (legal.length === 0) {
        setTimeout(() => endTurn(room), 800);
      }
      break;
    }

    case 'move': {
      if (!gs || gs.phase !== 'moving') return;
      if (gs.turn !== player.color) return;

      const { from, to, diceIdx } = msg;
      const legal = getLegalMoves(gs);
      const valid = legal.find(m => m.from === from && m.to === to && m.diceIdx === diceIdx);
      if (!valid) {
        ws.send(JSON.stringify({ type: 'error', message: 'Geçersiz hamle!' }));
        return;
      }

      // Vurma (hit) durumunu analiz için kaydet
      let isHit = false;
      if (to !== 'off') {
        const targetVal = gs.board[to];
        isHit = (gs.turn === 'white' ? targetVal === -1 : targetVal === 1);
      }

      applyMove(gs, { from, to, diceIdx });
      if (gs.currentTurnMoves) gs.currentTurnMoves.push({ from, to, diceIdx, hit: isHit });

      if (gs.phase === 'game_over') {
        handleGameOver(room);
        return;
      }

      broadcast(room, { type: 'game_state', state: getPublicState(room) });

      // Hamle bittiğinde bot ise bir sonraki hamle için tetikle (zarlar bitmemiş olabilir)
      // Ancak bot zaten triggerBotTurn içindeki for döngüsüyle hamleleri yapıyor.
      // Yine de oyuncunun hamlesi bittiğinde sıranın bota geçip geçmediğini kontrol etmek için:
      if (gs.phase !== 'game_over' && gs.dice.length === gs.diceUsed.length) {
         // Sıra bitecek, endTurn zaten triggerBotTurn çağıracak
      }
      break;
    }

    case 'undo': {
      if (!gs || gs.phase !== 'moving') return;
      if (gs.turn !== player.color) return;
      if (gs.moveHistory.length === 0) return;

      const last = gs.moveHistory.pop();
      gs.board    = last.snapshot.board;
      gs.bar      = last.snapshot.bar;
      gs.borneOff = last.snapshot.borneOff;
      gs.diceUsed = last.snapshot.diceUsed;
      gs.phase    = last.snapshot.phase;
      gs.winner   = last.snapshot.winner;
      gs.winType  = last.snapshot.winType;

      broadcast(room, { type: 'game_state', state: getPublicState(room) });
      break;
    }

    case 'double': {
      if (!gs || gs.phase !== 'waiting_roll') return;
      if (gs.turn !== player.color) return;
      if (room.crawfordGame) return;
      if (gs.cube.owner !== null && gs.cube.owner !== player.color) return;

      gs.cube.offered = true;
      gs.cube.offeredBy = player.color;

      const opponent = room.players.find(p => p.color !== player.color);
      if (opponent) {
        opponent.ws.send(JSON.stringify({
          type: 'cube_offered',
          value: gs.cube.value * 2,
          by: player.color,
          state: getPublicState(room)
        }));
      }
      ws.send(JSON.stringify({ type: 'cube_offer_sent', state: getPublicState(room) }));
      break;
    }

    case 'accept_double': {
      if (!gs || !gs.cube.offered) return;
      if (gs.turn === player.color) return;

      gs.cube.value *= 2;
      gs.cube.owner = player.color;
      gs.cube.offered = false;
      gs.cube.offeredBy = null;

      broadcast(room, {
        type: 'cube_accepted',
        cubeValue: gs.cube.value,
        owner: player.color,
        state: getPublicState(room)
      });
      break;
    }

    case 'decline_double': {
      if (!gs || !gs.cube.offered) return;
      if (gs.turn === player.color) return;

      const winner = gs.cube.offeredBy;
      const points = gs.cube.value;
      gs.cube.offered = false;
      awardPoints(room, winner, points, 'normal', true);
      break;
    }

    case 'end_turn': {
      if (!gs || gs.phase !== 'moving') return;
      if (gs.turn !== player.color) return;

      const remaining = getLegalMoves(gs);
      if (remaining.length > 0) {
        ws.send(JSON.stringify({ type: 'error', message: 'Zorunlu hamleler bitmeden sırayı bitiremezsiniz!' }));
        return;
      }

      endTurn(room);
      break;
    }

    case 'time_out': {
      if (!gs || gs.phase === 'game_over') return;
      const opp = room.players.find(p => p.color !== player.color);
      if (!opp) return;
      const winnerColor = opp.color;
      const points = gs.cube.value;
      gs.phase = 'game_over';
      gs.winner = winnerColor;
      awardPoints(room, winnerColor, points, 'normal', false);
      break;
    }

    case 'ping': {
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    }

    default:
      break;
  }
}

// ─── Oyun Sonu & Puan ─────────────────────────────────────────────────────────

function handleGameOver(room) {
  const gs = room.gameState;
  const winner = gs.winner;
  const winType = gs.winType;
  let points = gs.cube.value;
  if (winType === 'gammon') points *= 2;
  if (winType === 'backgammon') points *= 3;
  awardPoints(room, winner, points, winType, false);
}

function awardPoints(room, winner, points, winType, declined) {
  room.matchScore[winner] += points;
  const { matchLength } = room.settings;
  const loser = winner === 'white' ? 'black' : 'white';

  const crawfordTriggered =
    !room.crawfordTriggered &&
    (room.matchScore[winner] === matchLength - 1) &&
    (room.matchScore[loser] < matchLength - 1);

  if (crawfordTriggered) {
    room.crawfordGame = true;
    room.crawfordTriggered = true;
    room.crawfordDone = false;
  }

  // Son turu da kaydet (game_over öncesi hamle yapılmış olabilir)
  const gs = room.gameState;
  if (gs && gs.currentTurnBoard && gs.currentTurnMoves && gs.currentTurnMoves.length > 0) {
    const turnEntry = {
      color: gs.turn,
      dice: [...gs.dice],
      moves: [...gs.currentTurnMoves],
      boardBefore: gs.currentTurnBoard,
      boardAfter: JSON.parse(JSON.stringify({ board: gs.board, bar: gs.bar, borneOff: gs.borneOff }))
    };
    room.gameHistory.push(turnEntry);
  }

  const gameHistorySnapshot = [...room.gameHistory];
  const playerNames = {};
  room.players.forEach(p => { playerNames[p.color] = p.name; });

  broadcast(room, {
    type: 'game_over',
    winner,
    points,
    winType,
    declined,
    matchScore: room.matchScore,
    crawfordGame: crawfordTriggered,
    matchFinished: room.matchScore[winner] >= matchLength,
    gameHistory: gameHistorySnapshot,
    playerNames
  });

  if (room.matchScore[winner] >= matchLength) {
    broadcast(room, { type: 'match_over', winner, score: room.matchScore });
  } else {
    setTimeout(() => startNextGame(room), 3000);
  }
}

function startNextGame(room) {
  room.gameNumber++;
  room.gameHistory = []; // Yeni oyun için geçmişi sıfırla

  if (room.crawfordGame && room.crawfordDone) {
    room.crawfordGame = false;
    room.crawfordDone = false;
  } else if (room.crawfordGame && !room.crawfordDone) {
    room.crawfordDone = true;
  }

  let w, b;
  do {
    w = Math.ceil(Math.random() * 6);
    b = Math.ceil(Math.random() * 6);
  } while (w === b);
  const first = w > b ? 'white' : 'black';

  room.gameState = createGameState(first);
  room.gameState.dice = [w, b];
  room.gameState.diceUsed = [];
  room.gameState.phase = 'moving';

  broadcast(room, {
    type: 'new_game',
    gameNumber: room.gameNumber,
    crawfordGame: room.crawfordGame,
    firstTurn: first,
    openingDice: [w, b],
    matchScore: room.matchScore,
    state: getPublicState(room)
  });
}

// ─── Genel Durum & Yardımcılar ────────────────────────────────────────────────

function getPublicState(room) {
  const gs = room.gameState;
  if (!gs) return null;
  return {
    board: gs.board,
    bar: gs.bar,
    borneOff: gs.borneOff,
    turn: gs.turn,
    dice: gs.dice,
    diceUsed: gs.diceUsed,
    phase: gs.phase,
    cube: gs.cube,
    winner: gs.winner,
    winType: gs.winType,
    matchScore: room.matchScore,
    crawfordGame: room.crawfordGame,
    legalMoves: gs.phase === 'moving' ? getLegalMoves(gs) : [],
    canDouble: canOfferDouble(room)
  };
}

function canOfferDouble(room) {
  const gs = room.gameState;
  if (!gs) return false;
  if (room.crawfordGame) return false;
  if (gs.cube.offered) return false;
  if (gs.phase !== 'waiting_roll') return false;
  if (gs.cube.owner !== null && gs.cube.owner !== gs.turn) return false;
  return true;
}

function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  room.players.forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  });
}

// ─── WebSocket Bağlantı Yönetimi ──────────────────────────────────────────────

wss.on('connection', (ws) => {
  let currentRoom = null;

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }

    if (msg.type === 'join') {
      const { roomId, playerName, settings } = msg;
      // Bot tespiti için tüm kaynakları kontrol et
      const isBotGame = !!(msg.isBotGame || (settings && settings.isBotGame) || roomId.startsWith('BOT_'));
      
      console.log(`[JOIN] Raw MSG:`, JSON.stringify(msg));
      console.log(`[JOIN] Room: ${roomId}, Player: ${playerName}, Bot: ${isBotGame}`);
      
      let room = rooms.get(roomId);
      if (!room) {
        room = createRoom(roomId, settings || { matchLength: 5, matchTime: 5 });
        rooms.set(roomId, room);
      }

      if (room.players.length >= 2) {
        ws.send(JSON.stringify({ type: 'room_full' }));
        return;
      }

      const playerColor = room.players.length === 0 ? 'white' : 'black';
      room.players.push({
        ws,
        color: playerColor,
        name: playerName || `Oyuncu ${room.players.length + 1}`,
        isBot: false
      });
      currentRoom = room;

      // Bot Modu Kontrolü
      if (isBotGame && room.players.length === 1) {
        const botColor = playerColor === 'white' ? 'black' : 'white';
        console.log(`[JOIN] Bot ekleniyor... Color: ${botColor}`);
        room.players.push({
          ws: { send: () => {}, readyState: 1 }, 
          color: botColor,
          name: '🤖 GNUBG Bot',
          isBot: true
        });
      }

      ws.send(JSON.stringify({
        type: 'joined',
        color: playerColor,
        roomId,
        isBotGame: isBotGame,
        settings: room.settings || { matchLength: 5, matchTime: 5 }
      }));

      console.log(`[ROOM] ${roomId} current players: ${room.players.length}`);

      if (room.players.length === 2) {
        broadcast(room, {
          type: 'players_ready',
          players: room.players.map(p => ({ color: p.color, name: p.name }))
        });
        setTimeout(() => {
          startNextGame(room);
          triggerBotTurn(room);
        }, 1000);
      } else {
        ws.send(JSON.stringify({ type: 'waiting_for_opponent' }));
      }
      return;
    }

    if (currentRoom) {
      handleMessage(ws, currentRoom, msg);
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      broadcast(currentRoom, { type: 'opponent_disconnected' });
      currentRoom.players = currentRoom.players.filter(p => p.ws !== ws);
      if (currentRoom.players.length === 0) {
        rooms.delete(currentRoom.id);
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS Hata] ${err.message}`);
  });
});

// Ölü bağlantıları her 30sn'de temizle
const pingInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
    clearInterval(pingInterval);
    if (gnubg) gnubg.shutdown();
});

// ─── Sunucuyu Başlat ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🎲 Tavla V2 Sunucusu çalışıyor!`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   İki sekme açıp oynamak için aynı Oda Kodu'nu girin.\n`);
});

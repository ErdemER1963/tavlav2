// ─── Sabit Başlangıç Tahtası (1-24 index) ────────────────────────────────────
// index 0 kullanılmaz
const INITIAL_BOARD = [
  //  0(unused)  1   2   3   4   5   6    7   8   9  10  11  12
       0,       -2,  0,  0,  0,  0,  5,   0,  3,  0,  0,  0, -5,
  //  13  14  15  16  17  18  19  20  21  22  23  24
       5,  0,  0,  0, -3,  0, -5,  0,  0,  0,  0,  2
];

function allInHome(board, bar, color) {
  if (color === 'white') {
    if (bar.white > 0) return false;
    for (let i = 7; i <= 24; i++) { if (board[i] > 0) return false; }
  } else {
    if (bar.black > 0) return false;
    for (let i = 1; i <= 18; i++) { if (board[i] < 0) return false; }
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
    if (from - dv === 0) return true;
    if (from - dv < 0) {
      for (let p = from + 1; p <= 6; p++) { if (board[p] > 0) return false; }
      return true;
    }
  } else {
    if (from + dv === 25) return true;
    if (from + dv > 25) {
      for (let p = 19; p < from; p++) { if (board[p] < 0) return false; }
      return true;
    }
  }
  return false;
}

function getLegalMovesRaw(gs) {
  const { board, bar, dice, diceUsed, turn } = gs;
  const moves = [];
  if (dice.filter((_, i) => !diceUsed.includes(i)).length === 0) return [];

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
      const entryPoint = color === 'black' ? dv : 25 - dv;
      if (entryPoint >= 1 && entryPoint <= 24 && isValidPoint(board, entryPoint, color)) {
        moves.push({ from: 'bar', to: entryPoint, diceIdx: di });
      }
    } else {
      for (let from = 1; from <= 24; from++) {
        const val = board[from];
        const hasChecker = color === 'white' ? val > 0 : val < 0;
        if (!hasChecker) continue;
        const to = from + dir * dv;
        if (to >= 1 && to <= 24) {
          if (isValidPoint(board, to, color)) moves.push({ from, to, diceIdx: di });
        } else if (allInHome(board, bar, color) && checkBearOff(board, bar, from, dv, color)) {
          moves.push({ from, to: 'off', diceIdx: di });
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
  if (move.from === 'bar') { color === 'white' ? bar.white-- : bar.black--; }
  else { color === 'white' ? board[move.from]-- : board[move.from]++; }
  if (move.to === 'off') { color === 'white' ? borneOff.white++ : borneOff.black++; }
  else {
    const targetVal = board[move.to];
    const isHit = color === 'white' ? targetVal === -1 : targetVal === 1;
    if (isHit) { color === 'white' ? bar.black++ : bar.white++; board[move.to] = 0; }
    color === 'white' ? board[move.to]++ : board[move.to]--;
  }
  nextGs.diceUsed.push(move.diceIdx);
  return nextGs;
}

function getBestPathMetrics(gs) {
  const moves = getLegalMovesRaw(gs);
  if (moves.length === 0) return { count: 0, pips: 0 };
  let maxCount = 0, maxPips = 0;
  for (const move of moves) {
    const nextGs = simulateMove(gs, move);
    const pipValue = gs.dice[move.diceIdx];
    const next = getBestPathMetrics(nextGs);
    const c = 1 + next.count, p = pipValue + next.pips;
    if (c > maxCount) { maxCount = c; maxPips = p; }
    else if (c === maxCount && p > maxPips) maxPips = p;
  }
  return { count: maxCount, pips: maxPips };
}

function getLegalMoves(gs) {
  const baseMoves = getLegalMovesRaw(gs);
  if (baseMoves.length === 0) return [];
  let globalMaxCount = 0, globalMaxPips = 0;
  const moveMetrics = [];
  for (const move of baseMoves) {
    const nextGs = simulateMove(gs, move);
    const pipValue = gs.dice[move.diceIdx];
    const next = getBestPathMetrics(nextGs);
    const count = 1 + next.count, pips = pipValue + next.pips;
    moveMetrics.push({ move, count, pips });
    if (count > globalMaxCount) { globalMaxCount = count; globalMaxPips = pips; }
    else if (count === globalMaxCount && pips > globalMaxPips) globalMaxPips = pips;
  }
  return moveMetrics
    .filter(m => m.count === globalMaxCount && (globalMaxCount !== 1 || m.pips === globalMaxPips))
    .map(m => m.move);
}

// ─── Test Yardımcısı ─────────────────────────────────────────────────────────

function runTest(label, gs, expectedRaw, expectedFiltered) {
  const raw = getLegalMovesRaw(gs);
  const filtered = getLegalMoves(gs);
  const ok = (expectedRaw == null || raw.length === expectedRaw) &&
             (expectedFiltered == null || filtered.length === expectedFiltered);
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  console.log(`   Ham(${raw.length}):`, raw.map(m => `${m.from}->${m.to}`).join(', '));
  console.log(`   Filtre(${filtered.length}):`, filtered.map(m => `${m.from}->${m.to}`).join(', '));
  if (!ok) {
    if (expectedRaw != null) console.log(`   ⚠ Beklenen ham: ${expectedRaw}`);
    if (expectedFiltered != null) console.log(`   ⚠ Beklenen filtre: ${expectedFiltered}`);
  }
}

// ─── Testler ─────────────────────────────────────────────────────────────────

console.log('=== TAVLA 1-24 INDEX TEST ===\n');

// Test 1: Siyah bar girişi — zar(1) -> nokta 1, zar(3) -> nokta 3
runTest('Siyah Bar Girişi (1,3)', {
  board: Array(25).fill(0),
  bar: { white: 0, black: 1 },
  borneOff: { white: 0, black: 0 },
  dice: [1, 3], diceUsed: [], turn: 'black'
}, 2, 2);

// Test 2: Beyaz bar girişi — zar(4) -> nokta 21, zar(2) -> nokta 23
runTest('Beyaz Bar Girişi (4,2)', {
  board: Array(25).fill(0),
  bar: { white: 1, black: 0 },
  borneOff: { white: 0, black: 0 },
  dice: [4, 2], diceUsed: [], turn: 'white'
}, 2, 2);

// Test 3: Başlangıç tahtası
runTest('Başlangıç Tahtası — Siyah (3,1)', {
  board: [...INITIAL_BOARD],
  bar: { white: 0, black: 0 },
  borneOff: { white: 0, black: 0 },
  dice: [3, 1], diceUsed: [], turn: 'black'
}, null, null);

// Test 4: Başlangıç tahtası — Beyaz
runTest('Başlangıç Tahtası — Beyaz (4,2)', {
  board: [...INITIAL_BOARD],
  bar: { white: 0, black: 0 },
  borneOff: { white: 0, black: 0 },
  dice: [4, 2], diceUsed: [], turn: 'white'
}, null, null);

// Test 5: Beyaz bearing off — home 1-6'da tüm pullar
runTest('Beyaz Bearing Off (3,1)', {
  board: (() => { const b = Array(25).fill(0); b[1]=2;b[2]=3;b[3]=3;b[4]=3;b[5]=2;b[6]=2; return b; })(),
  bar: { white: 0, black: 0 }, borneOff: { white: 0, black: 0 },
  dice: [3, 1], diceUsed: [], turn: 'white'
}, null, null);

// Test 6: USBGF büyük zar seçimi
runTest('USBGF — Büyük Zar Seçilmeli (5,3)', {
  board: (() => { const b = Array(25).fill(0); b[24]=-1; return b; })(),
  bar: { white: 0, black: 0 }, borneOff: { white: 0, black: 0 },
  dice: [5, 3], diceUsed: [], turn: 'black'
}, null, null);

// Test 7: Tüm zarlar kullanılmış
runTest('Tüm Zarlar Kullanılmış', {
  board: [...INITIAL_BOARD],
  bar: { white: 0, black: 0 }, borneOff: { white: 0, black: 0 },
  dice: [3, 1], diceUsed: [0, 1], turn: 'black'
}, 0, 0);

// Test 8: Siyah bar girişi — nokta 1 ve 3 bloke (beyaz kontrolünde)
runTest('Siyah Bar — Girişler Bloke', {
  board: (() => { const b = Array(25).fill(0); b[1]=2; b[3]=2; return b; })(),
  bar: { white: 0, black: 1 }, borneOff: { white: 0, black: 0 },
  dice: [1, 3], diceUsed: [], turn: 'black'
}, 0, 0);

console.log('\n=== TESTLER TAMAMLANDI ===');

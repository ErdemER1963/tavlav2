/**
 * gnubg-bridge.js  v2.0
 * GNU Backgammon köprüsü — Position ID tabanlı, robust parse
 */
const { spawn } = require('child_process');

// ─── Position ID Encode ───────────────────────────────────────────────────────
// Spec: https://www.gnu.org/software/gnubg/manual/gnubg.html#position-id
// Doğrulanmış: başlangıç pozisyonu → "4HPwATDgc/ABMA"
function boardToPositionID(board, bar, borneOff, turn) {
    const p1 = [], p2 = [];

    if (turn === 'white') {
        for (let pt = 1; pt <= 24; pt++) {
            const n = board[pt];
            if (n > 0) for (let j = 0; j < n; j++) p1.push(pt);
        }
        for (let j = 0; j < (bar.white || 0); j++) p1.push(25);
        for (let pt = 1; pt <= 24; pt++) {
            const n = -board[pt];
            if (n > 0) for (let j = 0; j < n; j++) p2.push(25 - pt);
        }
        for (let j = 0; j < (bar.black || 0); j++) p2.push(25);
    } else {
        for (let pt = 1; pt <= 24; pt++) {
            const n = -board[pt];
            if (n > 0) for (let j = 0; j < n; j++) p1.push(25 - pt);
        }
        for (let j = 0; j < (bar.black || 0); j++) p1.push(25);
        for (let pt = 1; pt <= 24; pt++) {
            const n = board[pt];
            if (n > 0) for (let j = 0; j < n; j++) p2.push(pt);
        }
        for (let j = 0; j < (bar.white || 0); j++) p2.push(25);
    }

    // GNU spec: her nokta için önce o noktadaki pullar (1 bit'ler), sonra separator (0 bit)
    function encode(pieces) {
        const bits = new Array(40).fill(0);
        let bi = 0;
        for (let pt = 1; pt <= 25 && bi < 40; pt++) {
            const count = pieces.filter(p => p === pt).length;
            for (let k = 0; k < count && bi < 40; k++) {
                bits[bi++] = 1;
            }
            if (bi < 40) bi++; // separator 0
        }
        return bits;
    }

    const allBits = [...encode(p1), ...encode(p2)];
    const bytes = [];
    for (let i = 0; i < 10; i++) {
        let byte = 0;
        for (let j = 0; j < 8; j++) {
            if (allBits[i * 8 + j]) byte |= (1 << j);
        }
        bytes.push(byte);
    }
    return Buffer.from(bytes).toString('base64').replace(/=+$/, '');
}

// ─── gnubg Process ───────────────────────────────────────────────────────────
function runGnubgCommands(commands, timeoutMs = 15000) {
    return new Promise((resolve) => {
        const isWin = process.platform === 'win32';
        const proc  = spawn('gnubg-cli', ['--quiet'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: isWin
        });

        let output = '', finished = false;

        const finish = () => {
            if (finished) return;
            finished = true;
            resolve(output);
        };

        proc.stdout.on('data', d => { output += d.toString(); });
        proc.stderr.on('data', () => {});
        proc.on('error', finish);
        proc.on('close', finish);

        // Komutları sırayla gönder
        let delay = 300;
        for (const cmd of commands) {
            setTimeout(() => {
                if (!finished) {
                    try { proc.stdin.write(cmd + '\n'); } catch (_) {}
                }
            }, delay);
            delay += 180;
        }
        setTimeout(() => {
            try { proc.stdin.write('quit\n'); } catch (_) {}
        }, delay + 100);
        setTimeout(() => {
            if (!finished) { try { proc.kill(); } catch (_) {} finish(); }
        }, timeoutMs);
    });
}

// ─── Parse ───────────────────────────────────────────────────────────────────
function parseHintOutput(output, turn) {
    // Windows CR+LF → LF
    const lines = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const moves = [];

    // Robust regex: rank. <ply info>  <hamle(ler)>  Eq.: <değer>
    // Hamle: "24/20 13/11", "bar/22*", "6/off", vb.
    // En az 2 boşluk hamle bloğunu ply'den ayırır
    const RE = /^\s*(\d+)\.\s+.+?\s{2,}((?:(?:bar|\d+)\/(?:off|\d+)\*?\s*)+?)\s+Eq\.:\s*([-+]?\d+\.?\d*)/i;

    for (const line of lines) {
        const m = line.match(RE);
        if (!m) continue;
        const rank     = parseInt(m[1]);
        const moveStr  = m[2].trim();
        const equity   = parseFloat(m[3]);
        moves.push({ rank, moveStr, equity, moves: parseMoveStr(moveStr, turn) });
    }
    return moves;
}

function parseMoveStr(moveStr, turn) {
    const result = [];
    for (const part of moveStr.trim().split(/\s+/)) {
        const m = part.match(/^(bar|\d+)\/(off|\d+)(\*?)$/i);
        if (!m) continue;
        let from = m[1].toLowerCase() === 'bar' ? 'bar' : parseInt(m[1]);
        let to   = m[2].toLowerCase() === 'off' ? 'off' : parseInt(m[2]);
        if (turn === 'black') {
            if (typeof from === 'number') from = 25 - from;
            if (typeof to   === 'number') to   = 25 - to;
        }
        result.push({ from, to, hit: m[3] === '*' });
    }
    return result;
}

// ─── Public API ──────────────────────────────────────────────────────────────
async function analyzePosition(board, bar, borneOff, turn, dice) {
    try {
        const posID   = boardToPositionID(board, bar, borneOff, turn);
        const turnIdx = turn === 'white' ? 0 : 1;
        // Çift zar: [d,d,d,d] → gnubg'ye sadece d d yeter
        const d1 = dice[0];
        const d2 = dice.length === 4 ? dice[0] : dice[1];

        const commands = [
            'new game',
            `set board ${posID}`,
            `set turn ${turnIdx}`,
            `set dice ${d1} ${d2}`,
            'hint'
        ];

        const output   = await runGnubgCommands(commands);
        const topMoves = parseHintOutput(output, turn);

        return {
            error:    null,
            bestMove: topMoves[0] || null,
            equity:   topMoves[0]?.equity ?? null,
            topMoves: topMoves.slice(0, 5),
            rawOutput: output   // debug için
        };
    } catch (err) {
        return { error: err.message, bestMove: null, equity: null, topMoves: [], rawOutput: '' };
    }
}

async function analyzeGame(turnHistory) {
    const results = [];
    const BATCH   = 4;

    for (let i = 0; i < turnHistory.length; i += BATCH) {
        const batch = turnHistory.slice(i, i + BATCH);
        const batchResults = await Promise.all(batch.map(async (turn) => {
            // Gerekli veri kontrolü
            if (!turn.boardBefore?.board || !Array.isArray(turn.dice) || turn.dice.length === 0) {
                return { skipped: true, reason: 'Eksik veri', color: turn.color, dice: turn.dice };
            }

            const result = await analyzePosition(
                turn.boardBefore.board,
                turn.boardBefore.bar   || { white: 0, black: 0 },
                turn.boardBefore.borneOff || { white: 0, black: 0 },
                turn.color,
                turn.dice
            );

            const actualMoveStr = !turn.moves?.length
                ? 'pas'
                : turn.moves.map(m => `${m.from}→${m.to}`).join(' ');

            const isOptimal  = isMoveSimilar(turn.moves || [], result.bestMove?.moves || []);
            const equityLoss = calcEquityLoss(result.topMoves || [], turn.moves || []);

            return {
                color:      turn.color,
                dice:       turn.dice,
                actualMove: actualMoveStr,
                bestMove:   result.bestMove,
                isOptimal,
                equityLoss,
                topMoves:   result.topMoves,
                error:      result.error,
                // Debug: topMoves yoksa rawOutput snippet'i sakla
                _debug:     result.topMoves.length === 0 ? result.rawOutput?.slice(0, 300) : undefined
            };
        }));
        results.push(...batchResults);
    }
    return results;
}

function isMoveSimilar(actual, gnubgMoves) {
    if (!actual?.length || !gnubgMoves?.length) return false;
    const actualSet = new Set(actual.map(m => `${m.from}-${m.to}`));
    return gnubgMoves.every(m => actualSet.has(`${m.from}-${m.to}`));
}

function calcEquityLoss(topMoves, actualMoves) {
    if (!topMoves?.length) return null;
    const best = topMoves[0].equity;
    for (const c of topMoves) {
        if (isMoveSimilar(actualMoves, c.moves)) {
            return +(best - c.equity).toFixed(3);
        }
    }
    return null;
}

async function checkAvailability() {
    return new Promise((resolve) => {
        const isWin = process.platform === 'win32';
        const proc  = spawn('gnubg-cli', ['--version'], {
            stdio: ['ignore', 'pipe', 'ignore'],
            shell: isWin
        });
        let out = '';
        proc.stdout.on('data', d => { out += d.toString(); });
        proc.on('close', code  => resolve({ available: code === 0, version: out.trim().split('\n')[0] }));
        proc.on('error', ()    => resolve({ available: false, version: null }));
        setTimeout(()          => resolve({ available: false, version: null }), 3000);
    });
}

function shutdown() {}

module.exports = { analyzePosition, analyzeGame, checkAvailability, shutdown, boardToPositionID };

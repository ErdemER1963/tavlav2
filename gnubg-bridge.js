/**
 * gnubg-bridge.js  v2.0
 * GNU Backgammon köprüsü — Position ID tabanlı, robust parse
 */
const { spawn } = require('child_process');

// ─── Position ID Encode ───────────────────────────────────────────────────────
// Spec: https://www.gnu.org/software/gnubg/manual/gnubg.html#position-id
// Doğrulanmış: başlangıç pozisyonu → "4HPwATDgc/ABMA"
// GNUBG "set board" komutunu çalıştırırken (yeni oyunda turn=0 olduğu için)
// encode'un HER ZAMAN White'ın perspektifinden (absolute) yapılması gerekiyor. 
// Çünkü set turn 1 (black) sonradan veriliyor, GNUBG kendisi internal çevirmesini yapıyor.
function boardToPositionID(board, bar, borneOff) {
    const p1 = [], p2 = [];

    // Player 1 (White) kendi perspektifi (ev=1)
    for (let pt = 1; pt <= 24; pt++) {
        const n = board[pt];
        if (n > 0) for (let j = 0; j < n; j++) p1.push(pt);
    }
    for (let j = 0; j < (bar.white || 0); j++) p1.push(25);
    
    // Player 2 (Black) kendi perspektifi (Black ev=24, yani 25-pt)
    for (let pt = 1; pt <= 24; pt++) {
        const n = -board[pt];
        if (n > 0) for (let j = 0; j < n; j++) p2.push(25 - pt);
    }
    for (let j = 0; j < (bar.black || 0); j++) p2.push(25);

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
        let hintSent  = false;   // 'hint' komutu gönderildi mi
        let quietTimer = null;   // output debounce timer

        const finish = () => {
            if (finished) return;
            finished = true;
            if (quietTimer) clearTimeout(quietTimer);
            resolve(output);
        };

        const sendQuit = () => {
            if (finished) return;
            try { proc.stdin.write('quit\n'); } catch (_) {}
            // quit sonrası GNUBG kapanır → close event → finish()
            // Güvenlik: 2sn içinde close gelmezse zorla bitir
            setTimeout(() => { if (!finished) { try { proc.kill(); } catch (_) {} finish(); } }, 2000);
        };

        proc.stdout.on('data', d => {
            output += d.toString();
            // 'hint' gönderildikten sonra gelen her veri parçasında debounce başlat.
            // Son veri parçasından 400ms sonra yeni veri gelmezse hint tamamlandı say → quit.
            if (hintSent && !finished) {
                if (quietTimer) clearTimeout(quietTimer);
                quietTimer = setTimeout(sendQuit, 400);
            }
        });
        proc.stderr.on('data', () => {});
        proc.on('error', finish);
        proc.on('close', finish);

        // Komutları sırayla gönder (hint dahil)
        let delay = 200;
        for (const cmd of commands) {
            setTimeout(() => {
                if (!finished) {
                    try { proc.stdin.write(cmd + '\n'); } catch (_) {}
                    if (cmd === 'hint') hintSent = true;
                }
            }, delay);
            delay += 150;
        }

        // Global timeout — hint hiç çıktı vermezse (GNUBG crash vb.)
        setTimeout(() => {
            if (!finished) { try { proc.kill(); } catch (_) {} finish(); }
        }, timeoutMs);
    });
}

// ─── Parse ───────────────────────────────────────────────────────────────────
// ─── Parantezli Çift-Zar Notasyonu Açıcı ────────────────────────────────────
// GNUBG çift zar hamlesini kısa yazar: '13/8(4)', '13/8(2) 8/3(2)', '24/19/16(2)'
// Bu fonksiyon bunları tam listeye çevirir: '13/8 13/8 13/8 13/8'
function expandParenNotation(str) {
    return str.replace(/((?:(?:bar|\d+)(?:\/(?:off|\d+)\*?)+))\((\d+)\)/gi, (_, move, count) => {
        return Array(parseInt(count)).fill(move).join(' ');
    });
}

function parseHintOutput(output, turn) {
    // Windows CR+LF → LF
    const lines = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const moves = [];
    let forcedMove = null;

    // Robust regex: rank. <ply info>  <hamle(ler)>  Eq.: <değer>
    // Multi-slash ve parantezli notasyon expand edildikten sonra eşleşir.
    const RE = /^\s*(\d+)\.\s+.+?\s{2,}((?:(?:bar|\d+)(?:\/(?:off|\d+)\*?)+\s*)+)\s+Eq\.:\s*([-+]?\d+\.?\d*)/i;
    // Forced move: tek seçenek varsa GNUBG rank+equity olmadan yazar
    const FORCED_RE = /^\s*Forced move:\s+((?:(?:bar|\d+)(?:\/(?:off|\d+)\*?)+\s*)+)/i;

    for (const line of lines) {
        // Önce parantezli notasyonu genişlet: '13/8(4)' → '13/8 13/8 13/8 13/8'
        const expanded = expandParenNotation(line);

        // Forced move kontrolü
        const forced = expanded.match(FORCED_RE);
        if (forced) {
            const moveStr = forced[1].trim();
            const parsed  = parseMoveStr(moveStr, turn);
            if (parsed.length > 0) forcedMove = { rank: 1, moveStr, equity: 0, moves: parsed };
            continue;
        }

        const m = expanded.match(RE);
        if (!m) continue;
        const rank     = parseInt(m[1]);
        const moveStr  = m[2].trim();
        const equity   = parseFloat(m[3]);
        moves.push({ rank, moveStr, equity, moves: parseMoveStr(moveStr, turn) });
    }

    // Ranked sonuç yoksa forced move'u kullan
    if (moves.length === 0 && forcedMove) moves.push(forcedMove);
    return moves;
}

function parseMoveStr(moveStr, turn) {
    const result = [];
    // Parantezli çift-zar notasyonunu önce genişlet: '13/8(4)' → '13/8 13/8 13/8 13/8'
    const expanded = expandParenNotation(moveStr);
    for (const part of expanded.trim().split(/\s+/)) {
        // GNUBG kısa notasyonunu genişlet:
        //   '24/19/16'   → [{24→19}, {19→16}]
        //   '24/19 19/16' → aynı sonuç (zaten ayrı parçalar)
        //   'bar/22/17'  → [{bar→22}, {22→17}]
        //   '13/10/7/4'  → üç hamle (çift zar)
        // Hit (*) sadece son segmentin sonunda olabilir.
        const segments = part.split('/');
        if (segments.length < 2) continue;

        for (let i = 0; i < segments.length - 1; i++) {
            const fromRaw = segments[i];
            const toRaw   = segments[i + 1];
            const hit     = toRaw.endsWith('*');
            const toClean = hit ? toRaw.slice(0, -1) : toRaw;

            const validFrom = /^(bar|\d+)$/i.test(fromRaw);
            const validTo   = /^(off|\d+)$/i.test(toClean);
            if (!validFrom || !validTo) continue;

            let from = fromRaw.toLowerCase() === 'bar' ? 'bar' : parseInt(fromRaw);
            let to   = toClean.toLowerCase() === 'off' ? 'off' : parseInt(toClean);

            if (turn === 'black') {
                if (typeof from === 'number') from = 25 - from;
                if (typeof to   === 'number') to   = 25 - to;
            }
            result.push({ from, to, hit });
        }
    }
    return result;
}

// ─── Public API ──────────────────────────────────────────────────────────────
async function analyzePosition(board, bar, borneOff, turn, dice) {
    try {
        const posID   = boardToPositionID(board, bar, borneOff);
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

        console.log(`[GNUBG] Komutlar: set board ${posID}, set turn ${turnIdx}, set dice ${d1} ${d2}`);
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

function buildJourneys(moves) {
    // Ara noktaları zincirle: [{bar→20},{20→18}] → [{bar→18}]
    const journeys = [];
    const remaining = [...moves];
    while (remaining.length > 0) {
        const first = remaining.shift();
        let start = first.from;
        let end   = first.to;
        let merged = true;
        while (merged && end !== 'off') {
            merged = false;
            const idx = remaining.findIndex(m => m.from === end);
            if (idx !== -1) { end = remaining[idx].to; remaining.splice(idx, 1); merged = true; }
        }
        journeys.push({ from: start, to: end });
    }
    return journeys;
}

function isMoveSimilar(actual, gnubgMoves) {
    if (!actual?.length || !gnubgMoves?.length) return false;
    const parsePos = (p) => p === 'bar' ? 25 : p === 'off' ? 0 : (parseInt(p) || 0);
    const sortFn   = (a, b) => {
        const d = parsePos(a.from) - parsePos(b.from);
        return d !== 0 ? d : parsePos(a.to) - parsePos(b.to);
    };
    // Önce birebir karşılaştır
    if (actual.length === gnubgMoves.length) {
        const as = [...actual].sort(sortFn);
        const gs = [...gnubgMoves].sort(sortFn);
        if (gs.every((m, i) => as[i].from === m.from && as[i].to === m.to)) return true;
    }
    // Net yolculuk karşılaştırması: bar→20→18 == bar→18
    const aJ = buildJourneys([...actual]);
    const gJ = buildJourneys([...gnubgMoves]);
    if (aJ.length !== gJ.length) return false;
    const as = aJ.sort(sortFn);
    const gs = gJ.sort(sortFn);
    return gs.every((m, i) => as[i].from === m.from && as[i].to === m.to);
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

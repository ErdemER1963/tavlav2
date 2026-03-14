/* ============================================================
   TAVLA V2 – İstemci Oyun Motoru
   ============================================================ */

// ─── Durum Değişkenleri ───────────────────────────────────────
let ws = null;
let myColor = null;
let myName = '';
let gameState = null;
let matchSettings = { matchLength: 5, matchTime: 5 };
let timerInterval = null;
let whiteTime = 0;
let blackTime = 0;
let dragState = null; // { from, fromType, startX, startY }
let selectedFrom = null; // Seçili pul noktası

// Canvas
let canvas, ctx;
const BOARD_W = 1180; // 1000 + 180 (sidebar space)
const BOARD_H = 700;
const POINT_W = 75;
const BAR_W = 60;
const MARGIN_LEFT = 200; // Cube sidebar 180px + 20px boşluk
const MARGIN_RIGHT = 20;
const CHECKER_R = 25;

// ─── LOBİ UI ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    setupLobby();
    setupCanvas();
});

window.joinGame = joinGame;

function joinGame(overrides = null) {
    if (overrides) {
        myName = overrides.playerName || 'Oyuncu';
        matchSettings = {
            matchLength: overrides.matchLength || 5,
            matchTime: overrides.matchTime || 5,
            isTrainingMode: !!overrides.isTrainingMode,
            isBotGame: !!overrides.isBotGame
        };
        const roomId = overrides.roomId || 'TAVLA';
        showLobbyStatus('Bağlanılıyor...');
        connectWS(roomId);
        return;
    }

    // Eski (Fallback) Mantık
    myName = document.getElementById('player-name')?.value.trim() || 'Oyuncu';
    const roomId = document.getElementById('room-id')?.value.trim() || 'TAVLA';
    
    const sliderEl = document.getElementById('match-length-hidden');
    const matchLength = sliderEl ? parseInt(sliderEl.value) : 5;

    const timeHidden = document.getElementById('match-time-hidden');
    const matchTime = timeHidden ? parseInt(timeHidden.value) : 5;
    
    const toggleEl = document.getElementById('training-mode-toggle');
    const isTrainingMode = toggleEl ? toggleEl.checked : false;

    const isBotGame = !!window._isBotGame;

    matchSettings = { matchLength, matchTime, isTrainingMode, isBotGame };

    showLobbyStatus('Sunucuya bağlanılıyor...');
    connectWS(roomId);
}

function showLobbyStatus(text) {
    const el = document.getElementById('lobby-status');
    document.getElementById('lobby-status-text').textContent = text;
    el.classList.remove('hidden');
}

// ─── WEBSOCKET ────────────────────────────────────────────────
function connectWS(roomId) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: 'join',
            roomId,
            playerName: myName,
            settings: matchSettings
        }));
    };

    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        handleServerMessage(msg);
    };

    ws.onclose = () => {
        setStatus('Bağlantı kesildi. Sayfayı yenileyin.');
    };

    ws.onerror = () => {
        setStatus('Bağlantı hatası!');
        showLobbyStatus('Bağlantı hatası! Sunucu açık mı?');
    };
}

function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

// ─── SUNUCU MESAJLARI ─────────────────────────────────────────
function handleServerMessage(msg) {
    switch (msg.type) {
        case 'joined':
            myColor = msg.color;
            document.getElementById('room-display').textContent = `Oda: ${msg.roomId}`;
            document.getElementById('match-length-display').textContent = `${msg.settings.matchLength} puan maç`;
            whiteTime = msg.settings.matchTime * 60;
            blackTime = msg.settings.matchTime * 60;
            showLobbyStatus(`✓ Katıldınız (${myColor === 'white' ? '⬜ Beyaz' : '🔴 Kırmızı'}). Rakip bekleniyor...`);
            break;

        case 'waiting_for_opponent':
            showLobbyStatus('Rakip bekleniyor...');
            break;

        case 'room_full':
            showLobbyStatus('Oda dolu! Başka bir oda kodu deneyin.');
            break;

        case 'players_ready':
            showGameScreen(msg.players);
            break;

        case 'new_game':
            gameState = msg.state;
            updateMatchScore(msg.matchScore);
            setCrawfordBadge(msg.crawfordGame);
            renderBoard();
            updateDiceUI();
            updateUndoBtn();
            updateCubeUI();
            setStatus(`Oyun ${msg.gameNumber} başlıyor! İlk hamle: ${colorTR(msg.firstTurn)}`);
            animateDiceRoll(msg.firstTurn, msg.openingDice);
            updateRollBtn();
            startTimer();
            break;

        case 'dice_rolled':
            gameState = msg.state;
            animateDiceRoll(msg.turn, msg.dice);
            updateDiceUI();
            updateRollBtn();
            renderBoard();
            setStatus(`${colorTR(msg.turn)} zar attı: ${msg.dice.join(', ')}`);
            break;

        case 'game_state':
            gameState = msg.state;
            renderBoard();
            updateDiceUI();
            updateUndoBtn();
            updateCubeUI();
            updateRollBtn();
            break;

        case 'cube_offered':
            gameState = msg.state;
            updateCubeUI();
            if (myColor !== msg.by) {
                // Rakip teklif etti → bana kabul/red göster
                document.getElementById('cube-respond-info').textContent = `Rakip ${msg.value}× çift teklif etti!`;
                document.getElementById('cube-action-row').classList.add('hidden');
                document.getElementById('cube-respond-row').classList.remove('hidden');
            }
            setStatus(`${colorTR(msg.by)} ${msg.value}× çift teklif etti!`);
            break;

        case 'cube_offer_sent':
            gameState = msg.state;
            setStatus('Çift teklifiniz rakibe gönderildi...');
            document.getElementById('cube-action-row').classList.add('hidden');
            break;

        case 'cube_accepted':
            gameState = msg.state;
            updateCubeUI();
            document.getElementById('cube-respond-row').classList.add('hidden');
            setStatus(`Çift kabul edildi! Küp değeri: ${msg.cubeValue}`);
            break;

        case 'game_over':
            gameState && renderBoard();
            updateMatchScore(msg.matchScore);
            const winTR = { normal: 'normal', gammon: 'Gammon', backgammon: 'Backgammon' };
            const reason = msg.declined ? 'Rakip reddetti' : `${winTR[msg.winType] || ''}`;
            showOverlay(
                msg.winner === myColor ? '🏆' : '😔',
                msg.winner === myColor ? 'Oyunu Kazandınız!' : 'Oyunu Kaybettiniz!',
                `${reason ? reason + ' – ' : ''}+${msg.points} puan\nSkor: ${msg.matchScore.white} – ${msg.matchScore.black}`
            );
            // Analiz verisini sakla
            if (msg.gameHistory && msg.gameHistory.length > 0) {
                window._lastGameHistory = msg.gameHistory;
                window._lastGamePlayers = msg.playerNames || {};
                window._lastGameResult = { winner: msg.winner, winType: msg.winType, points: msg.points, matchScore: msg.matchScore };
                // Analiz butonu ekle
                const existingBtn = document.getElementById('analyze-btn');
                if (!existingBtn) {
                    const analyzeBtn = document.createElement('button');
                    analyzeBtn.id = 'analyze-btn';
                    analyzeBtn.className = 'btn-secondary';
                    analyzeBtn.style.cssText = 'margin-top:10px;width:100%;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.4);color:#f59e0b;';
                    analyzeBtn.textContent = '📊 Analizi Gör';
                    analyzeBtn.addEventListener('click', openAnalysis);
                    document.querySelector('.overlay-card').appendChild(analyzeBtn);
                } else {
                    existingBtn.style.display = '';
                }
            }
            if (!msg.matchFinished) {
                setTimeout(() => hideOverlay(), 2800);
            }
            break;

        case 'match_over':
            showOverlay(
                msg.winner === myColor ? '🎉' : '🥈',
                msg.winner === myColor ? 'MAÇI KAZANDINIZ!' : 'Maçı Kaybettiniz',
                `Final Skor: Beyaz ${msg.score.white} – Kırmızı ${msg.score.black}`
            );
            document.getElementById('overlay').dataset.matchOver = '1';
            stopTimer();
            break;

        case 'opponent_disconnected':
            setStatus('⚠ Rakip bağlantısı kesildi.');
            showOverlay('⚠', 'Rakip Ayrıldı', 'Rakip bağlantısı kesildi. Sayfayı yenileyerek yeni oyun başlatabilirsiniz.');
            stopTimer();
            break;
    }
}

// ─── EKRAN GEÇİŞLERİ ─────────────────────────────────────────
function showGameScreen(players) {
    document.getElementById('lobby-screen').classList.remove('active');
    const gs = document.getElementById('game-screen');
    gs.style.display = 'flex';

    // İsim gösterimi
    const white = players.find(p => p.color === 'white');
    const black = players.find(p => p.color === 'black');
    if (white) document.getElementById('score-white-name').textContent = white.name;
    if (black) document.getElementById('score-black-name').textContent = black.name;

    setupGameEvents();
}

function setupGameEvents() {
    // Zar at
    document.getElementById('roll-btn').addEventListener('click', () => send({ type: 'roll_dice' }));
    // Geri al
    document.getElementById('undo-btn').addEventListener('click', () => send({ type: 'undo' }));
    // Cube butonları
    document.getElementById('btn-double').addEventListener('click', () => send({ type: 'double' }));
    document.getElementById('btn-accept').addEventListener('click', () => {
        send({ type: 'accept_double' });
        document.getElementById('cube-respond-row').classList.add('hidden');
    });
    document.getElementById('btn-decline').addEventListener('click', () => {
        send({ type: 'decline_double' });
        document.getElementById('cube-respond-row').classList.add('hidden');
    });
    // Tamam (Sıra Bitir)
    document.getElementById('done-btn').addEventListener('click', async () => {
        if (matchSettings.isTrainingMode && gameState && gameState.phase === 'moving' && gameState.turn === myColor) {
            if (gameState.legalMoves && gameState.legalMoves.length > 0) {
                send({ type: 'end_turn' });
                return;
            }

            const btn = document.getElementById('done-btn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳ Analiz...';
            btn.disabled = true;

            try {
                const res = await fetch('/api/gnubg/analyze-position', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        board: gameState.currentTurnBoard.board,
                        bar: gameState.currentTurnBoard.bar,
                        borneOff: gameState.currentTurnBoard.borneOff,
                        turn: gameState.turn,
                        dice: gameState.dice
                    })
                });
                
                if (!res.ok) throw new Error("GNUBG Error");
                const data = await res.json();
                
                const actualMoves = gameState.currentTurnMoves || [];
                
                function isSim(am, tm) {
                    if (!am?.length || !tm?.length) return false;
                    const amSet = new Set(am.map(m => `${m.from}-${m.to}`));
                    return tm.every(m => amSet.has(`${m.from}-${m.to}`));
                }

                let equityLoss = null;
                const bestEq = data.topMoves[0]?.equity || 0;
                let foundMatch = false;

                for (const cand of data.topMoves) {
                    if (isSim(actualMoves, cand.moves)) {
                        equityLoss = bestEq - cand.equity;
                        foundMatch = true;
                        break;
                    }
                }

                if (!foundMatch && data.topMoves.length > 0) {
                     equityLoss = 999; 
                }

                if (equityLoss !== null && equityLoss > 0.05) {
                    const isBlunder = equityLoss > 0.1;
                    const lossText = equityLoss === 999 ? "ÇOK BÜYÜK HATA (Geçersiz veya Çok Kötü Hamle)" : 
                                    (isBlunder ? `BÜYÜK HATA (−${equityLoss.toFixed(3)} Puan)` : `HATA (−${equityLoss.toFixed(3)} Puan)`);
                    
                    const bestMoves = data.topMoves[0].moves || [];
                    const formatPt = (pt) => {
                        if (pt === 'bar') return 'bar';
                        if (pt === 'off') return 'off';
                        if (myColor === 'black') return (25 - parseInt(pt)).toString();
                        return pt;
                    };
                    const bestStr = bestMoves.map(m => `${formatPt(m.from)}→${formatPt(m.to)}`).join(' ');
                    const actualStr = actualMoves.map(m => `${formatPt(m.from)}→${formatPt(m.to)}`).join(' ') || 'Pas';

                    document.getElementById('tutor-msg').innerHTML = 
                        `<strong style="color:var(--red); font-size:16px;">${lossText}</strong><br><br>` + 
                        `<span style="opacity:0.8">Sizin Hamleniz:</span> <b style="color:#fff">${actualStr}</b><br><br>` + 
                        `<span style="opacity:0.8;color:var(--green)">GNUBG Önerisi:</span> <b style="color:var(--green)">${bestStr}</b>`;
                    
                    document.getElementById('tutor-overlay').classList.remove('hidden');

                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    return; 
                }

            } catch (e) {
                console.error("Tutor Analiz Hatası", e);
            }
            
            btn.innerHTML = originalText;
            btn.disabled = false;
        }

        send({ type: 'end_turn' });
    });

    // Tutor Modal Eylemleri
    document.getElementById('tutor-undo-btn').addEventListener('click', () => {
        document.getElementById('tutor-overlay').classList.add('hidden');
        while (gameState.moveHistory && gameState.moveHistory.length > 0) {
            send({ type: 'undo' });
        }
    });

    document.getElementById('tutor-force-btn').addEventListener('click', () => {
        document.getElementById('tutor-overlay').classList.add('hidden');
        send({ type: 'end_turn' });
    });
    // Overlay kapat
    document.getElementById('overlay-close').addEventListener('click', hideOverlay);
    // Canvas olayları
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseUp);
    // Bearing off alanına tıklama ile pul toplama
    ['white-bearing', 'black-bearing'].forEach(id => {
        document.getElementById(id).addEventListener('click', () => {
            if (!gameState || gameState.phase !== 'moving') return;
            if (gameState.turn !== myColor) return;
            const bearingColor = id.startsWith('white') ? 'white' : 'black';
            if (bearingColor !== myColor) return;
            if (selectedFrom !== null) {
                const hasOffMove = gameState.legalMoves.some(m => m.from === selectedFrom && m.to === 'off');
                if (hasOffMove) {
                    tryMove(selectedFrom, 'off');
                    selectedFrom = null;
                    clearBearingHighlight();
                    renderBoard();
                }
            }
        });
    });
}

// ─── CANVAS KURULUMU ─────────────────────────────────────────
function setupCanvas() {
    canvas = document.getElementById('board-canvas');
    ctx = canvas.getContext('2d');
    // Dahili çözünürlük sabit (1180×700); CSS aspect-ratio ile görsel ölçekleme CSS tarafında
    canvas.width = BOARD_W;
    canvas.height = BOARD_H;
}

// Pencere boyutu değişince board yeniden çizilir (scale CSS tarafında, koordinatlar getBoundingClientRect ile zaten doğru)
window.addEventListener('resize', () => {
    if (gameState) renderBoard();
});

// ─── TAHTA ÇİZİMİ ────────────────────────────────────────────
function renderBoard() {
    if (!ctx || !gameState) return;
    const gs = gameState;

    ctx.clearRect(0, 0, BOARD_W, BOARD_H);

    // Glassmorphism için arka planı temiz bırakıyoruz (CSS'teki board-wrapper blur'u gözüksün)
    // Eğer hafif bir renk istenirse rgba kullanılabilir:
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);

    // Orta çizgi (bar alanı)
    const barX = MARGIN_LEFT + (6 * POINT_W);

    // Noktaları çiz
    drawPoints(barX);

    // Pulları çiz (bar dahil)
    drawCheckers(gs, barX);

    // Seçili pul vurgusu
    if (selectedFrom !== null) {
        drawLegalHighlights(gs, barX);
    }

    // Drag pul çiz
    if (dragState && dragState.currentX !== undefined) {
        const color = myColor;
        drawChecker(dragState.currentX, dragState.currentY, color, true);
    }

    // Süsleme çizgisi (Glassmorphism kenarlığı gibi)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, BOARD_W, BOARD_H);
}

function drawPoints(barX) {
    // Sol taraf: 12 nokta (index 24→13 üstte, 1→12 altta)
    // Sağ taraf: 12 nokta (index 25→13 üstte, 0→11 altta)
    // Tahta düzeni (perspektiften bağımsız, Beyaz 0→23):
    // Üst sol: 12,11,10,9,8,7 (index 12-7)   Üst sağ: 6,5,4,3,2,1 (index 6-1)  → ziyaret sırası
    // Alt sol: 13,14,15,16,17,18             Alt sağ: 19,20,21,22,23,24(bar yok, hep 24 nokta)

    const colors = ['#7c3aed', '#0f766e'];

    for (let i = 1; i <= 24; i++) {
        const isBottom = i <= 12;
        const isRight = (i <= 6) || (i >= 19);

        const { x, isBottom: ptIsBottom } = getPointCenter(i);
        const y = ptIsBottom ? BOARD_H : 0;
        const tipY = ptIsBottom ? BOARD_H - 280 : 280;

        ctx.beginPath();
        ctx.moveTo(x - POINT_W / 2, y);
        ctx.lineTo(x + POINT_W / 2, y);
        ctx.lineTo(x, tipY);
        ctx.closePath();

        // Gradient for triangle
        const grad = ctx.createLinearGradient(0, y, 0, tipY);
        if (i % 2 === 0) { // Mor / Violet
            grad.addColorStop(0, '#8b5cf6');
            grad.addColorStop(1, '#4c1d95');
        } else { // Turkuaz / Teal
            grad.addColorStop(0, '#14b8a6');
            grad.addColorStop(1, '#115e59');
        }

        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Nokta numarası etiketi (1-24 numaralandırması kendi rengine göre)
        const { x: labelX, isBottom: labelBottom } = getPointCenter(i);
        const labelY = labelBottom ? BOARD_H - 8 : 8;
        const displayNum = myColor === 'black' ? (25 - i) : i;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = 'bold 11px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = labelBottom ? 'bottom' : 'top';
        ctx.fillText(displayNum, labelX, labelY);
    }
}

// Pul konumlarını hesapla — board index 1-24
// Standart tavla görünümü:
//   Üst sıra soldan sağa: 13,14,15,16,17,18 | BAR | 19,20,21,22,23,24
//   Alt sıra soldan sağa: 12,11,10, 9, 8, 7 | BAR |  6, 5, 4, 3, 2, 1
function getPointCenter(pointIdx) {
    const barX = MARGIN_LEFT + (6 * POINT_W);
    let x, isBottom;

    if (pointIdx >= 1 && pointIdx <= 6) {
        // Q1 (Bottom-Right): 1-6 → 6 en solda (bar'a yakın), 1 en sağda
        x = barX + BAR_W + (6 - pointIdx) * POINT_W + POINT_W / 2;
        isBottom = true;
    } else if (pointIdx >= 7 && pointIdx <= 12) {
        // Q2 (Bottom-Left): 7-12 → 12 en solda, 7 bar'a yakın (sağda)
        x = MARGIN_LEFT + (12 - pointIdx) * POINT_W + POINT_W / 2;
        isBottom = true;
    } else if (pointIdx >= 13 && pointIdx <= 18) {
        // Q3 (Top-Left): 13-18 → 13 en solda, 18 bar'a yakın (sağda)
        x = MARGIN_LEFT + (pointIdx - 13) * POINT_W + POINT_W / 2;
        isBottom = false;
    } else {
        // Q4 (Top-Right): 19-24 → 19 bar'a yakın (solda), 24 en sağda
        x = barX + BAR_W + (pointIdx - 19) * POINT_W + POINT_W / 2;
        isBottom = false;
    }
    return { x, isBottom };
}

function drawCheckers(gs) {
    const barX = MARGIN_LEFT + (6 * POINT_W);
    for (let i = 1; i <= 24; i++) {
        const val = gs.board[i];
        if (val === 0) continue;
        const color = val > 0 ? 'white' : 'black';
        const count = Math.abs(val);
        const { x, isBottom } = getPointCenter(i);

        for (let j = 0; j < Math.min(count, 5); j++) {
            const offsetY = (isBottom ? -1 : 1) * (CHECKER_R * 2 * j + CHECKER_R);
            const baseY = isBottom ? BOARD_H - 1 : 1;
            const cy = baseY + offsetY;
            drawChecker(x, cy, color, false, (count > 5 && j === 4) ? count.toString() : null);
        }
    }

    // Bar - orta dikey çizgi
    const cx = barX + BAR_W / 2;

    // Bar arka planı (Daha şık ve şeffaf cam hissi)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.fillRect(barX, 0, BAR_W, BOARD_H);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, 0, BAR_W, BOARD_H);

    // Orta ayırıcı çizgi
    ctx.strokeStyle = 'rgba(245,158,11,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(barX, BOARD_H / 2);
    ctx.lineTo(barX + BAR_W, BOARD_H / 2);
    ctx.stroke();

    // Siyah bar pulları — üstte (siyah 1→24 yönünde, 1-6 arası girer)
    const blackCount = gs.bar.black || 0;
    for (let j = 0; j < blackCount; j++) {
        drawChecker(cx, 60 + j * (CHECKER_R * 2 + 4), 'black', false);
    }

    // Beyaz bar pulları — altta (beyaz 24→1 yönünde, 19-24 arası girer)
    const whiteCount = gs.bar.white || 0;
    for (let j = 0; j < whiteCount; j++) {
        drawChecker(cx, BOARD_H - 60 - j * (CHECKER_R * 2 + 4), 'white', false);
    }
}

function drawChecker(cx, cy, color, dragging, stackLabel) {
    const r = CHECKER_R;
    ctx.save();

    // Gölge
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = dragging ? 16 : 6;
    ctx.shadowOffsetY = dragging ? 4 : 2;

    // Pul
    const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    if (color === 'white') {
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.6, '#e2e8f0');
        grad.addColorStop(1, '#94a3b8');
    } else {
        grad.addColorStop(0, '#ff6b6b');
        grad.addColorStop(0.6, '#dc2626');
        grad.addColorStop(1, '#991b1b');
    }

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Kenar
    ctx.strokeStyle = color === 'white' ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Parlaklık
    const shine = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, 0, cx - r * 0.3, cy - r * 0.35, r * 0.5);
    shine.addColorStop(0, 'rgba(255,255,255,0.4)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = shine;
    ctx.fill();

    // Stack etiketi
    if (stackLabel) {
        ctx.fillStyle = color === 'white' ? '#1e293b' : '#ffffff';
        ctx.font = `bold ${r * 0.8}px Outfit, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(stackLabel, cx, cy);
    }

    ctx.restore();
}

function drawLegalHighlights(gs, barX) {
    if (!gameState || !gameState.legalMoves) return;
    const moves = gameState.legalMoves.filter(m => m.from === selectedFrom);
    const targets = [...new Set(moves.map(m => m.to))];

    // Seçili pulun bulunduğu noktayı vurgula
    if (selectedFrom !== null && selectedFrom !== 'bar') {
        const { x, isBottom } = getPointCenter(selectedFrom);
        const baseY = isBottom ? BOARD_H - 1 : 1;
        const cy = baseY + (isBottom ? -1 : 1) * CHECKER_R;
        ctx.beginPath();
        ctx.arc(x, cy, CHECKER_R + 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(245,158,11,0.9)';
        ctx.lineWidth = 3;
        ctx.stroke();
    } else if (selectedFrom === 'bar') {
        // Bar'daki seçili pulu vurgula
        const barX = MARGIN_LEFT + (6 * POINT_W);
        const cx = barX + BAR_W / 2;
        const cy = myColor === 'black' ? 80 : BOARD_H - 80;
        ctx.beginPath();
        ctx.arc(cx, cy, CHECKER_R + 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(245,158,11,0.9)';
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    // Hedef noktaları vurgula
    targets.forEach(to => {
        if (to === 'off') {
            const bearingEl = document.getElementById(myColor === 'white' ? 'white-bearing' : 'black-bearing');
            if (bearingEl) bearingEl.style.boxShadow = '0 0 16px rgba(245,158,11,0.7)';
            return;
        }
        const { x, isBottom } = getPointCenter(to);
        const y = isBottom ? BOARD_H - 20 : 20;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(245,158,11,0.7)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    });
}

// ─── MOUSE OLAYLARI ──────────────────────────────────────────
function onMouseDown(e) {
    if (!gameState || gameState.phase !== 'moving') return;
    if (gameState.turn !== myColor) return;

    const pos = getCanvasPos(e);

    // Eğer bir pul zaten seçiliyse, hedef noktaya tıklanıyor olabilir (click-to-move)
    if (selectedFrom !== null) {
        const targetPoint = getPointAt(pos.x, pos.y);
        if (targetPoint !== null && targetPoint !== selectedFrom) {
            const legal = gameState.legalMoves.filter(m => m.from === selectedFrom && m.to === targetPoint);
            if (legal.length > 0) {
                tryMove(selectedFrom, targetPoint);
                selectedFrom = null;
                dragState = null;
                renderBoard();
                return;
            }
        }
        // Bearing off alanına canvas üzerinde tıklandı mı? (canvas içi tıklama ile 'off' hamlesi)
        const hasOffMove = gameState.legalMoves.some(m => m.from === selectedFrom && m.to === 'off');
        if (hasOffMove) {
            // Bearing off bölgesi: canvas'ın dışındaki HTML elementi — canvas event'inden DOM rect ile kontrol
            const bearingEl = document.getElementById(myColor === 'white' ? 'white-bearing' : 'black-bearing');
            if (bearingEl) {
                const rect = bearingEl.getBoundingClientRect();
                if (e.clientX >= rect.left && e.clientX <= rect.right &&
                    e.clientY >= rect.top && e.clientY <= rect.bottom) {
                    tryMove(selectedFrom, 'off');
                    selectedFrom = null;
                    dragState = null;
                    clearBearingHighlight();
                    renderBoard();
                    return;
                }
            }
        }
    }

    const hit = getCheckerAt(pos.x, pos.y);
    if (!hit) { selectedFrom = null; dragState = null; renderBoard(); return; }

    const { pointIdx, type } = hit;
    const legalFromHere = gameState.legalMoves.some(m => m.from === pointIdx);
    if (!legalFromHere) { selectedFrom = null; dragState = null; renderBoard(); return; }

    if (selectedFrom === pointIdx) {
        selectedFrom = null;
        dragState = null;
    } else {
        selectedFrom = pointIdx;
        dragState = { from: pointIdx, type, startX: pos.x, startY: pos.y };
    }
    renderBoard();
}

function onMouseMove(e) {
    if (!dragState) return;
    const pos = getCanvasPos(e);
    dragState.currentX = pos.x;
    dragState.currentY = pos.y;
    renderBoard();
}

function onMouseUp(e) {
    if (!dragState) return;

    if (dragState.currentX !== undefined) {
        const pos = getCanvasPos(e);
        const targetPoint = getPointAt(pos.x, pos.y);

        if (targetPoint !== null) {
            tryMove(dragState.from, targetPoint);
            selectedFrom = null;
        } else {
            // Bearing off bölgesine bıraktı mı?
            const bearingEl = document.getElementById(myColor === 'white' ? 'white-bearing' : 'black-bearing');
            if (bearingEl) {
                const rect = bearingEl.getBoundingClientRect();
                if (e.clientX >= rect.left && e.clientX <= rect.right &&
                    e.clientY >= rect.top && e.clientY <= rect.bottom) {
                    tryMove(dragState.from, 'off');
                    selectedFrom = null;
                }
            }
        }
        dragState = null;
        clearBearingHighlight();
        renderBoard();
    } else {
        // Sadece tıklama (sürükleme yok) — dragState'i temizle, selectedFrom'u koru
        dragState = null;
    }

    if (e.type === 'mouseleave') {
        dragState = null;
        renderBoard();
    }
}

function clearBearingHighlight() {
    const ids = ['white-bearing', 'black-bearing'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.boxShadow = '';
    });
}

function tryMove(from, to) {
    if (!gameState || !gameState.legalMoves) return;
    // En uygun zar indeksini bul
    const legal = gameState.legalMoves.filter(m => m.from === from && m.to === to);
    if (legal.length === 0) return;
    send({ type: 'move', from, to, diceIdx: legal[0].diceIdx });
}

function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = BOARD_W / rect.width;
    const scaleY = BOARD_H / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

function getCheckerAt(mx, my) {
    if (!gameState) return null;
    const gs = gameState;
    // [DÜZELTME] barX, getPointCenter ile aynı formül kullanılmalı
    const barX = MARGIN_LEFT + (6 * POINT_W); // 630, getPointCenter ile tutarlı

    // Bar kontrolü — siyah üstte (my < BOARD_H/2), beyaz altta (my >= BOARD_H/2)
    if (mx >= barX && mx <= barX + BAR_W) {
        if (my < BOARD_H / 2) {
            if (myColor === 'black' && gs.bar.black > 0) return { pointIdx: 'bar', type: 'bar' };
        } else {
            if (myColor === 'white' && gs.bar.white > 0) return { pointIdx: 'bar', type: 'bar' };
        }
    }

    // Normal noktalar
    const color = myColor;
    for (let i = 1; i <= 24; i++) {
        const val = gs.board[i];
        const hasChecker = color === 'white' ? val > 0 : val < 0;
        if (!hasChecker) continue;
        const count = Math.abs(val);
        const { x, isBottom } = getPointCenter(i);
        for (let j = 0; j < Math.min(count, 5); j++) {
            const offsetY = (isBottom ? -1 : 1) * (CHECKER_R * 2 * j + CHECKER_R);
            const baseY = isBottom ? BOARD_H - 1 : 1;
            const cy = baseY + offsetY;
            if (dist(mx, my, x, cy) < CHECKER_R) return { pointIdx: i, type: 'board' };
        }
    }
    return null;
}

function getPointAt(mx, my) {
    const barX = MARGIN_LEFT + (6 * POINT_W); // getPointCenter ile tutarlı

    for (let i = 1; i <= 24; i++) {
        const { x, isBottom } = getPointCenter(i);
        const halfH = 350;

        // Bar bölgesine denk gelen x koordinatlarını atla
        if (mx >= barX && mx <= barX + BAR_W) return null;

        let xLeft = x - POINT_W / 2;
        let xRight = x + POINT_W / 2;

        if (mx >= xLeft && mx <= xRight) {
            if (isBottom && my >= halfH) return i;
            if (!isBottom && my < halfH) return i;
        }
    }
    return null;
}

function dist(x1, y1, x2, y2) {
    return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

// ─── ZAR UI ───────────────────────────────────────────────────
function animateDiceRoll(color, dice) {
    const areaId = color === 'white' ? 'white-dice-area' : 'black-dice-area';
    const area = document.getElementById(areaId);
    // Eski zarları temizle ve roll animasyonu göster
    area.innerHTML = '';
    dice.forEach((_, i) => {
        const el = createDieEl(color, Math.ceil(Math.random() * 6), false);
        el.classList.add('rolling');
        area.appendChild(el);
    });
    setTimeout(() => updateDiceUI(), 700);
}

function updateDiceUI() {
    if (!gameState) return;
    const { dice, diceUsed, turn } = gameState;

    ['white', 'black'].forEach(color => {
        const area = document.getElementById(`${color}-dice-area`);
        area.innerHTML = '';
        if (gameState.turn !== color || !dice || dice.length === 0) return;

        // Çift gelirse sadece 2 zar görseli göster ama 4 hamle hakkını koru
        // dice array'i [val, val, val, val] şeklindeyse ilk ikisini göster
        const visibleDiceCount = (dice.length === 4) ? 2 : dice.length;

        for (let i = 0; i < visibleDiceCount; i++) {
            const val = dice[i];
            let isUsed = false;
            if (dice.length === 4) {
                // Progressive dimming: 
                // i=0 zar: 2 hamle yapılınca söner (diceUsed.length >= 2)
                // i=1 zar: 4 hamle yapılınca söner (diceUsed.length >= 4)
                if (i === 0) isUsed = diceUsed.length >= 2;
                else isUsed = diceUsed.length >= 4;
            } else {
                isUsed = diceUsed.includes(i);
            }

            const el = createDieEl(color, val, isUsed);
            if (!isUsed && color === myColor && gameState.phase === 'moving') {
                el.style.cursor = 'pointer';
            }
            area.appendChild(el);
        }
    });
}

function createDieEl(color, value, used) {
    const die = document.createElement('div');
    die.className = `die ${color}-die${used ? ' used' : ''}`;
    const pipsEl = document.createElement('div');
    pipsEl.className = 'die-pips';
    pipsEl.innerHTML = getPipLayout(value);
    die.appendChild(pipsEl);
    return die;
}

const PIP_PATTERNS = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [0, 2], [2, 0], [2, 2]],
    5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
    6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]]
};

function getPipLayout(val) {
    const cells = Array(9).fill('<div class="pip" style="opacity:0"></div>');
    const pattern = PIP_PATTERNS[val] || [];
    pattern.forEach(([r, c]) => {
        cells[r * 3 + c] = '<div class="pip"></div>';
    });
    return cells.join('');
}

// ─── KÜÇÜK UI GÜNCELLEMELERİ ─────────────────────────────────
function updateRollBtn() {
    const btn = document.getElementById('roll-btn');
    const doneBtn = document.getElementById('done-btn');
    const undoBtn = document.getElementById('undo-btn');
    const indicator = document.getElementById('turn-indicator');
    if (!gameState) return;
    const isMyTurn = gameState.turn === myColor;

    // Zar atma butonu
    const canRoll = isMyTurn && gameState.phase === 'waiting_roll' && !gameState.cube.offered;
    btn.classList.toggle('hidden', !canRoll);

    // Tamam butonu
    const canEndTurn = isMyTurn && gameState.phase === 'moving' && gameState.legalMoves && gameState.legalMoves.length === 0;
    doneBtn.classList.toggle('hidden', !canEndTurn);

    // Geri Al butonu — her zaman görünür, hamle yoksa disabled
    const hasMove = gameState.diceUsed && gameState.diceUsed.length > 0;
    const canUndo = isMyTurn && gameState.phase === 'moving' && hasMove;
    undoBtn.disabled = !canUndo;

    indicator.textContent = gameState.phase === 'waiting_roll'
        ? (isMyTurn ? '🎲 Zarınızı atın!' : `${colorTR(gameState.turn)} zar atacak...`)
        : (isMyTurn ? '♟ Pul oynatın' : `${colorTR(gameState.turn)} oynuyor...`);
}

function updateUndoBtn() {
    // Merkezi yönetim updateRollBtn içinde yapılıyor
}

function updateCubeUI() {
    if (!gameState) return;
    const { cube, canDouble, crawfordGame } = gameState;

    // Küp yüzü
    document.getElementById('cube-face').textContent = cube.value;
    const ownerMap = { null: 'Serbest', white: '⬜ Beyaz', black: '🔴 Kırmızı' };
    document.getElementById('cube-owner-label').textContent = crawfordGame ? '🚫 Crawford' : (ownerMap[cube.owner] || 'Serbest');

    // Double buton
    const showDouble = canDouble && gameState.turn === myColor && !cube.offered;
    document.getElementById('cube-action-row').classList.toggle('hidden', !showDouble);

    // Cevap satırı (offered ama bana değil)
    const cubeOfferedToMe = cube.offered && cube.offeredBy !== myColor;
    if (!cubeOfferedToMe) {
        document.getElementById('cube-respond-row').classList.add('hidden');
    }
}

function updateMatchScore(score) {
    document.getElementById('score-white').textContent = score.white;
    document.getElementById('score-black').textContent = score.black;
}

function updateBearingOff() {
    if (!gameState) return;
    const wb = gameState.borneOff.white;
    const bb = gameState.borneOff.black;
    document.getElementById('white-borne-count').textContent = wb;
    document.getElementById('black-borne-count').textContent = bb;

    const render = (id, count, color) => {
        const el = document.getElementById(id);
        el.innerHTML = Array(count).fill(`<span class="bearing-checker ${color}"></span>`).join('');
    };
    render('white-borne-off', wb, 'white');
    render('black-borne-off', bb, 'black');
}

function setCrawfordBadge(isCrawford) {
    document.getElementById('crawford-badge').classList.toggle('hidden', !isCrawford);
}

// ─── ZAMANLAYICI ──────────────────────────────────────────────
function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => {
        if (!gameState || gameState.phase === 'game_over' || gameState.phase === 'waiting_for_opponent') return;

        // Sadece sırası olanın süresi düşer
        if (gameState.turn === 'white') {
            whiteTime--;
        } else if (gameState.turn === 'black') {
            blackTime--;
        }

        updateTimerDisplay();

        // Eğer benim sürem bittiyse ve bildirmedimse (bunu sadece kendi sürem bitince gönderirim)
        const myTime = myColor === 'white' ? whiteTime : blackTime;
        if (myTime <= 0 && gameState.turn === myColor) {
            stopTimer();
            setStatus('⏰ Süre doldu! Oyunu kaybettiniz.');
            send({ type: 'time_out' });
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function updateTimerDisplay() {
    if (!gameState) return;
    const el = document.getElementById('timer-display');
    const myTimeVal = myColor === 'white' ? whiteTime : blackTime;
    const oppTimeVal = myColor === 'white' ? blackTime : whiteTime;

    const format = (t) => {
        const m = Math.floor(Math.max(0, t) / 60).toString().padStart(2, '0');
        const s = (Math.max(0, t) % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    const myLabel = myColor === 'white' ? '⬜' : '🔴';
    const oppLabel = myColor === 'white' ? '🔴' : '⬜';

    const actTime = gameState.turn === 'white' ? whiteTime : blackTime;
    const isMyTurn = gameState.turn === myColor;

    el.innerHTML = `
        <span style="${isMyTurn ? 'font-weight:bold;color:var(--clr-accent);' : 'opacity:0.55;'}">${myLabel}${format(myTimeVal)}</span>
        <span style="opacity:0.4;margin:0 4px;">|</span>
        <span style="${!isMyTurn ? 'font-weight:bold;color:var(--clr-accent);' : 'opacity:0.55;'}">${oppLabel}${format(oppTimeVal)}</span>
    `;
    el.classList.toggle('danger', actTime <= 30 && actTime > 0);
}

// ─── OVERLAY ──────────────────────────────────────────────────
function showOverlay(emoji, title, msg) {
    document.getElementById('overlay-emoji').textContent = emoji;
    document.getElementById('overlay-title').textContent = title;
    document.getElementById('overlay-msg').textContent = msg;
    const ov = document.getElementById('overlay');
    ov.classList.remove('hidden');
    ov.style.zIndex = '9999';
    ov.style.pointerEvents = 'auto';
    // Kapat butonunu garantile
    const closeBtn = document.getElementById('overlay-close');
    if (closeBtn) {
        closeBtn.style.pointerEvents = 'auto';
        closeBtn.style.zIndex = '10000';
        closeBtn.style.position = 'relative';
    }
}

function hideOverlay() {
    const ov = document.getElementById('overlay');
    ov.classList.add('hidden');
    // match_over sonrası sayfayı yenile (lobi'ye dön)
    if (ov.dataset.matchOver === '1') {
        ov.dataset.matchOver = '';
        setTimeout(() => location.reload(), 400);
    }
}

// ─── UTILS ────────────────────────────────────────────────────
function setStatus(msg) {
    document.getElementById('game-status-msg').textContent = msg;
}

function openAnalysis() {
    const data = {
        history: window._lastGameHistory || [],
        players: window._lastGamePlayers || {},
        result: window._lastGameResult || {},
        myColor: myColor
    };
    localStorage.setItem('tavla_analysis', JSON.stringify(data));
    window.open('analyze.html', '_blank');
}

function colorTR(color) {
    return color === 'white' ? '⬜ Beyaz' : '🔴 Kırmızı';
}

// Bearing off güncellemesini game_state güncellemelerine bağla
const origRenderBoard = renderBoard;
window.renderBoard = function () {
    origRenderBoard();
    updateBearingOff();
    // Bar sayıları
    if (gameState) {
        document.getElementById('bar-white-count').textContent = gameState.bar.white || 0;
        document.getElementById('bar-black-count').textContent = gameState.bar.black || 0;
        // Bar görünürlüğü
        document.getElementById('bar-white-area').style.opacity = gameState.bar.white > 0 ? '1' : '0.3';
        document.getElementById('bar-black-area').style.opacity = gameState.bar.black > 0 ? '1' : '0.3';
    }
};

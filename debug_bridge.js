// gnubg-bridge'in gerçekten farklı pozisyonlar üretip üretmediğini test et
const gnubg = require('./gnubg-bridge');

async function test() {
    // Başlangıç pozisyonu
    const board1 = [0,-2,0,0,0,0,5,0,3,0,0,0,-5,5,0,0,0,-3,0,-5,0,0,0,0,2,0];
    // Birkaç hamle sonrası pozisyon (13→10, 24→21)
    const board2 = [0,-2,0,0,0,0,5,0,3,0,0,0,-5,4,0,0,0,-3,0,-5,0,1,0,0,1,0];
    
    const bar = { white: 0, black: 0 };
    const bo  = { white: 0, black: 0 };

    console.log('=== Test 1: Başlangıç ===');
    const r1 = await gnubg.analyzePosition(board1, bar, bo, 'white', [3,1]);
    console.log('rawOutput snippet:', r1.rawOutput?.substring(0,500));
    console.log('topMoves:', r1.topMoves);

    console.log('\n=== Test 2: Farklı pozisyon ===');
    const r2 = await gnubg.analyzePosition(board2, bar, bo, 'white', [4,2]);
    console.log('rawOutput snippet:', r2.rawOutput?.substring(0,500));
    console.log('topMoves:', r2.topMoves);
}
test();

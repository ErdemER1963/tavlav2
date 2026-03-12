const gnubg = require('./gnubg-bridge');

async function test() {
    console.log('--- GNUBG Bridge Test Başlatıldı ---');
    try {
        console.log('1. Availability Check:');
        const info = await gnubg.checkAvailability();
        console.log(info);

        if (!info.available) {
            console.error('GNUBG bulunamadı!');
            return;
        }

        console.log('\n2. Single Position Analysis:');
        const board = [0, -2, 0, 0, 0, 0, 5, 0, 3, 0, 0, 0, -5, 5, 0, 0, 0, -3, 0, -5, 0, 0, 0, 0, 2];
        const bar = { white: 0, black: 0 };
        const borneOff = { white: 0, black: 0 };
        const turn = 'white';
        const dice = [4, 2];

        const result = await gnubg.analyzePosition(board, bar, borneOff, turn, dice);
        console.log(JSON.stringify(result, null, 2));

        gnubg.shutdown();
        console.log('\n--- Test Başarıyla Tamamlandı ---');
    } catch (err) {
        console.error('\n!!! TEST HATASI:', err);
    }
}

test();

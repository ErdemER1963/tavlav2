// gnubg position ID ile import etmeyi test et
// Önce mevcut pozisyonun ID'sini alıp sonra import edelim
const { spawn } = require('child_process');

const proc = spawn('gnubg-cli', ['--quiet'], { stdio:['pipe','pipe','pipe'], shell:true });
let output = '';
proc.stdout.on('data', d => { output+=d.toString(); process.stdout.write(d.toString()); });
proc.stderr.on('data', d => process.stderr.write(d.toString()));

// gnubg pozisyon formatı: "import position <posID> <matchID>"
// Veya "load position" komutu
// Deneyelim: set board komutu 'new game' sonrası çalışıyor mu?
const cmds = [
  [400,  'new game'],          // match değil game deneyelim
  [900,  'set board 0 -2 0 0 0 0 5 0 3 0 0 0 -5 5 0 0 0 -3 0 -5 0 0 0 0 2 0'],
  [1300, 'set turn 0'],
  [1700, 'set dice 3 1'],
  [2100, 'hint'],
  [2500, 'show board'],        // pozisyonu göster - doğru set edildi mi?
  [5000, '__done__']
];

cmds.forEach(([d,c]) => setTimeout(() => {
  if(c==='__done__') { console.log('\n\nFULL:\n'+output); proc.kill(); }
  else { console.log('\n>> SEND:', c); proc.stdin.write(c+'\n'); }
}, d));

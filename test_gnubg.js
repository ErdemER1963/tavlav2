const { spawn } = require('child_process');
const proc = spawn('gnubg-cli', ['--quiet'], { stdio: ['pipe','pipe','pipe'], shell: true });
let output = '';
proc.stdout.on('data', d => { output += d.toString(); console.log('OUT:', JSON.stringify(d.toString())); });
proc.stderr.on('data', d => console.log('ERR:', d.toString()));
const cmds = [[500,'new match 1'],[1200,'set board 0 -2 0 0 0 0 5 0 3 0 0 0 -5 5 0 0 0 -3 0 -5 0 0 0 0 2 0'],[1800,'set turn 0'],[2200,'set dice 3 1'],[2600,'hint']];
cmds.forEach(([d,c]) => setTimeout(() => { console.log('SEND:',c); proc.stdin.write(c+'\n'); }, d));
setTimeout(() => { console.log('DONE\n'+output); proc.kill(); }, 7000);

// "claude" de mentira para las pruebas: imprime un banner, responde a cada línea y sale con /exit.
const mode = process.env.FAKE_MODE || '';
if (mode === 'alt') process.stdout.write('\x1b[?1049h\x1b[2J\x1b[HALT SCREEN\r\n'); // pantalla alternativa, como Claude a pantalla completa
if (mode === 'mouse') process.stdout.write('\x1b[?1000h\x1b[?1006h'); // Claude captura el ratón
process.stdout.write((process.env.FAKE_BANNER ? '\x1b[1m' : '\x1b[1;38;2;217;119;87m') + (process.env.FAKE_BANNER || '» FAKE CLAUDE') + '\x1b[0m' + (process.env.FAKE_BANNER ? '' : ' args=' + process.argv.slice(2).join(' ')) + '\n> '); // con FAKE_BANNER (capturas del README) no se muestran los argumentos
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.search(/[\r\n]/)) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (line.trim() === '/exit') process.exit(0);
    if (line) process.stdout.write('\r\neco: ' + line + '\r\n> ');
  }
});

if (process.env.FAKE_PRINT) process.stdout.write('\r\n' + process.env.FAKE_PRINT + '\r\n> ');
if (mode === 'mouse' || mode === 'alt') { // entrada cruda: responde a la rueda y a las flechas
  try { process.stdin.setRawMode(true); } catch { /* sin TTY */ }
  const say = (x) => process.stdout.write('\r\n' + x + '\r\n');
  process.stdin.on('data', (d) => {
    const x = String(d);
    if (/\x1b\[<64;/.test(x)) say('WHEEL-UP');
    else if (/\x1b\[<65;/.test(x)) say('WHEEL-DOWN');
    else if (x.includes('\x1b[A') || x.includes('\x1bOA')) say('ARROW-UP');
    else if (x.includes('\x1b[B') || x.includes('\x1bOB')) say('ARROW-DOWN');
  });
}

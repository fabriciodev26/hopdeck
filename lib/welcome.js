'use strict';

// First-run welcome. Only the interactive CLI calls this module.
const { version } = require('../package.json');
const RESET = '\x1b[0m';

function renderWelcome({ lang = 'en', color = false, columns = 80 } = {}) {
  const es = lang.toLowerCase().startsWith('es');
  const paint = (s, code) => color ? `\x1b[${code}m${s}${RESET}` : s;
  const rows = [
    [paint('» Hopdeck', '1;38;5;173') + '  ' + paint('v' + version, '90')],
    [es ? 'Tus proyectos. Tus conversaciones. Tu terminal.' : 'Your projects. Your conversations. Your terminal.', '90'],
    [''],
    [es ? '✓ Bienvenido a Hopdeck' : '✓ Welcome to Hopdeck', '32'],
    [''],
    [es ? 'EMPIEZA AQUÍ' : 'GET STARTED', '1'],
    ['hopdeck --provider claude   → Claude Code', '38;5;105'],
    ['hopdeck --provider codex    → Codex CLI', '38;5;105'],
    [''],
    [es ? 'ATAJOS OPCIONALES' : 'OPTIONAL SHORTCUTS', '1'],
    ['hopdeck shortcut on', '38;5;105'],
    [es ? 'Luego abre otra terminal: claude o codex' : 'Then open a new terminal: claude or codex', '90'],
  ];
  const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  if (columns < 56) return '\n' + rows.map(([s, code]) => '  ' + (code ? paint(s, code) : s)).join('\n') + '\n\n';
  const inner = 50;
  const edge = (s) => paint(s, '90');
  return '\n' + edge('  ╭' + '─'.repeat(inner + 2) + '╮') + '\n' +
    rows.map(([s, code]) => edge('  │ ') + (code ? paint(s, code) : s) + ' '.repeat(Math.max(0, inner - [...plain(s)].length)) + edge(' │')).join('\n') + '\n' +
    edge('  ╰' + '─'.repeat(inner + 2) + '╯') + '\n\n';
}

async function showWelcome({ config, save, wait, lang = 'en', env = process.env, input = process.stdin, output = process.stdout }) {
  if (config.welcomeSeen || env.HOPDECK_NOPROMPT ||
    (env.CI && !['false', '0'].includes(env.CI)) || !input.isTTY || !output.isTTY) return false;
  const out = output;
  const color = !env.NO_COLOR && env.TERM !== 'dumb' && env.FORCE_COLOR !== '0' &&
    Boolean(out.isTTY || env.FORCE_COLOR);
  out.write(renderWelcome({ lang, color, columns: out.columns || 80 }));
  const hint = lang.toLowerCase().startsWith('es') ? 'Enter para empezar · Esc para omitir' : 'Enter to get started · Esc to skip';
  out.write('  ' + hint + '\n');
  await wait();
  out.write('\x1b[1A\r\x1b[2K'); // remove the acknowledgement hint before the next screen
  config.welcomeSeen = true;
  save();
  return true;
}

module.exports = { renderWelcome, showWelcome };

'use strict';
const path = require('path');
const os = require('os');

// Hopdeck options precede the options forwarded to the selected CLI.
function parseProvider(argv, fallback = 'claude') {
  const args = [...argv]; let id = fallback;
  if (args[0] === '--provider') {
    id = args[1]; args.splice(0, 2);
  } else if (args[0] && args[0].startsWith('--provider=')) id = args.shift().slice(11);
  if (!['claude', 'codex'].includes(id)) throw new Error('Usage: hopdeck --provider claude|codex');
  return { id, args };
}

const selected = parseProvider(require.main && /hopdeck\.js$/.test(require.main.filename) ? process.argv.slice(2) : [], process.env.HOPDECK_PROVIDER || 'claude');
const isCodex = selected.id === 'codex';
// Child Hopdeck instances (including tmux panes) inherit the selected provider.
process.env.HOPDECK_PROVIDER = selected.id;
module.exports = {
  ...selected, isCodex, parseProvider,
  label: isCodex ? 'Codex' : 'Claude',
  configFile: path.join(os.homedir(), isCodex ? '.hopdeck-codex.json' : '.hopdeck.json'),
  launchArgs: (session, extra = []) => [...(session ? (isCodex ? ['resume', session.id] : ['--resume', session.id]) : []), ...extra],
};

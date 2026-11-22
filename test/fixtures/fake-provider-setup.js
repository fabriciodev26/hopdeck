'use strict';
// Loaded only by the setup UI tests through Node's --require. No vendor downloads.
const fs = require('fs'), path = require('path');
const setup = require('../../lib/provider-setup');
const originalRun = setup.runCommand;
const record = (event) => fs.appendFileSync(process.env.FAKE_SETUP_LOG, JSON.stringify(event) + '\n');
setup.installProvider = async (id) => {
  record({ action: 'install', id });
  const bin = path.join(process.env.FAKE_SETUP_ROOT, 'installed'); fs.mkdirSync(bin, { recursive: true });
  const fake = path.join(__dirname, 'fake-' + id + '.js');
  if (process.platform === 'win32') fs.writeFileSync(path.join(bin, id + '.cmd'), `@echo off\r\n"${process.execPath}" "${fake}" %*\r\n`);
  else fs.writeFileSync(path.join(bin, id), `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`, { mode: 0o755 });
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  process.env[key] = bin + path.delimiter + process.env[key];
  return 0;
};
setup.runCommand = async (bin, args, options) => {
  if (args.at(-1) === 'status') { record({ action: 'status', args }); return 1; }
  if (args.at(-1) === 'login') { record({ action: 'login', args }); return 0; }
  return originalRun(bin, args, options);
};

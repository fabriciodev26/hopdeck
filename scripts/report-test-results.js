'use strict';
// Publish only allowlisted names from committed tests and known error codes, never raw logs.
const fs = require('fs');
const status = Number(process.argv[2] || 0);
const log = fs.readFileSync('test-results.log', 'utf8');
const plain = log.replace(/\x1b\[[0-9;]*m/g, '');
if (process.env.GITHUB_STEP_SUMMARY) {
  const counts = plain.split('\n').filter((line) => /(?:ℹ|#) (?:tests|pass|fail|skipped) \d+/.test(line));
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${process.platform} · Node ${process.version}\n\n\`\`\`text\n${counts.join('\n')}\n\`\`\`\n`);
}
if (status !== 0) {
  const names = new Set();
  for (const file of fs.readdirSync('test').filter((name) => name.endsWith('.test.js'))) {
    const source = fs.readFileSync('test/' + file, 'utf8');
    for (const match of source.matchAll(/\btest\('([^'\r\n]+)'/g)) names.add(match[1]);
  }
  for (const name of names) if (plain.includes('✖ ' + name) || plain.split('\n').some((line) => line.startsWith('not ok ') && line.endsWith(' - ' + name))) {
    console.log('::error title=Prueba fallida::' + name.replace(/%/g, '%25'));
  }
  const codes = ['ERR_ASSERTION', 'ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT', 'ERR_TEST_FAILURE'].filter((code) => plain.includes(code));
  console.log('::error title=Resultado::' + (codes.length ? codes.join(', ') : 'La batería de pruebas falló'));
}

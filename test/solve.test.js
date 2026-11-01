// Run: node test/solve.test.js
// Loads the userscript in a minimal fake DOM and solves a batch of random games.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'snake-cache-solver.user.js'), 'utf8');
global.location = { hostname: 'games.cachesleuth.com', search: '?id=test' };
global.window = {};
const el = () => ({ style: {}, append() {}, appendChild() {}, addEventListener() {}, querySelector() { return {}; } });
global.document = { createElement: el, body: { appendChild() {} } };
eval(src);

const S = window.__snakeSolver;
const configs = [
  { size: 'small', wrap: false, powerups: true, goal: 25 },
  { size: 'medium', wrap: false, powerups: true, goal: 15 },
  { size: 'medium', wrap: true, powerups: false, goal: 40 },
  { size: 'large', wrap: false, powerups: true, goal: 30 },
];
const games = Number(process.argv[2]) || 100;
let ok = 0, total = 0;
const t0 = Date.now();
for (let i = 0; i < games; i++) {
  for (const cfg of configs) {
    total++;
    const r = S.solve('seed' + i, cfg, 50);
    if (r && S.replay('seed' + i, cfg, r.turns).won) ok++;
    else console.log('FAIL', 'seed' + i, JSON.stringify(cfg));
  }
}
console.log(`${ok}/${total} solved in ${Date.now() - t0} ms`);
process.exit(ok === total ? 0 : 1);

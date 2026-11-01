// ==UserScript==
// @name         CacheSleuth Snake Cache – Solver
// @namespace    https://github.com/knutos/snake-cache-solver
// @version      1.0.0
// @homepageURL  https://github.com/knutos/snake-cache-solver
// @supportURL   https://github.com/knutos/snake-cache-solver/issues
// @updateURL    https://raw.githubusercontent.com/knutos/snake-cache-solver/main/snake-cache-solver.user.js
// @downloadURL  https://raw.githubusercontent.com/knutos/snake-cache-solver/main/snake-cache-solver.user.js
// @description  Løser CacheSleuth Snake-cacher automatisk: simulerer spillmotoren lokalt, planlegger en trygg rute og sender trekkene til serverens verifisering.
// @author       knutos
// @match        https://games.cachesleuth.com/snake-cache/*
// @match        https://www.cachesleuth.com/snake-cache/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Motor – 1:1 kopi av logikken i snake-play.js (CacheSleuth)
  // ---------------------------------------------------------------------------
  const N = 0, E = 1, S = 2, W = 3;
  const OPP = [S, W, N, E];
  const CACHE = 1, LITTER = 2, GHOST = 3, MAGNET = 4, CITO = 5, SLOW = 6;
  const POWERUPS = [GHOST, MAGNET, CITO, SLOW];
  const SIZES = { small: { cols: 11, rows: 11 }, medium: { cols: 15, rows: 15 }, large: { cols: 19, rows: 19 } };

  function fnv1a(str) {
    let h = 2166136261; const s = String(str || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function makeRng(seed) {
    let n = seed >>> 0;
    const rng = function () {
      n |= 0; n = n + 1831565813 | 0;
      let r = Math.imul(n ^ n >>> 15, 1 | n);
      r = r + Math.imul(r ^ r >>> 7, 61 | r) ^ r;
      return ((r ^ r >>> 14) >>> 0) / 4294967296;
    };
    rng.getState = () => n;
    rng.setState = (v) => { n = v; };
    return rng;
  }
  function spawn(st, type) {
    const free = [];
    for (let c = 0; c < st.cols * st.rows; c++) if (!st.snake.includes(c) && st.items[c] == null) free.push(c);
    const r = st.rng();
    if (!free.length) return -1;
    const cell = free[Math.min(free.length - 1, Math.floor(r * free.length))];
    st.items[cell] = type;
    return cell;
  }
  function newState(seedStr, cfg) {
    const sz = SIZES[String(cfg.size || '').trim().toLowerCase()] || SIZES.medium;
    const st = {
      cols: sz.cols, rows: sz.rows, wrap: !!cfg.wrap, goal: Math.max(1, Math.round(cfg.goal || 10)),
      powerupsOn: cfg.powerups !== false, rng: makeRng(fnv1a(seedStr)), snake: [], dir: E, items: {},
      pendingGrowth: 0, ghostTicks: 0, magnetCharges: 0, collected: 0, foodEaten: 0, tick: 0, alive: true, won: false,
    };
    const y = Math.floor(st.rows / 2), x = Math.floor(st.cols / 2);
    for (let t = 0; t < 3; t++) st.snake.push(y * st.cols + (x - t));
    spawn(st, CACHE);
    return st;
  }
  function clone(st) {
    const rng = makeRng(0); rng.setState(st.rng.getState());
    return Object.assign({}, st, { rng, snake: st.snake.slice(), items: Object.assign({}, st.items) });
  }
  function legal(st, d) { return st.snake.length < 2 || d !== OPP[st.dir]; }
  function step(st, d) {
    if (!st.alive || st.won) return { moved: false };
    if (d != null) { if (!legal(st, d)) return { moved: false, illegal: true }; st.dir = d; }
    let x = st.snake[0] % st.cols, y = Math.floor(st.snake[0] / st.cols);
    if (st.dir === N) y--; else if (st.dir === E) x++; else if (st.dir === S) y++; else x--;
    if (x < 0 || x >= st.cols || y < 0 || y >= st.rows) {
      if (!st.wrap) { st.alive = false; return { moved: true, died: 'wall' }; }
      x = (x + st.cols) % st.cols; y = (y + st.rows) % st.rows;
    }
    const head = y * st.cols + x, growing = st.pendingGrowth > 0;
    for (let i = 0; i < st.snake.length; i++) {
      if (st.snake[i] === head) {
        if ((i === st.snake.length - 1 && !growing) || st.ghostTicks > 0) break;
        st.alive = false; return { moved: true, died: 'self' };
      }
    }
    st.snake.unshift(head);
    if (growing) st.pendingGrowth--; else st.snake.pop();
    const item = st.items[head];
    if (item) {
      delete st.items[head];
      if (item === CACHE) {
        const worth = st.magnetCharges > 0 ? 2 : 1;
        if (st.magnetCharges > 0) st.magnetCharges--;
        st.collected += worth; st.pendingGrowth += 2; st.foodEaten++;
        spawn(st, CACHE);
        if (st.powerupsOn && st.foodEaten % 3 === 0) spawn(st, POWERUPS[Math.min(3, Math.floor(st.rng() * 4))]);
        if (st.foodEaten % 4 === 0) spawn(st, LITTER);
      } else if (item === LITTER) {
        const k = Math.min(2, Math.max(0, st.snake.length - 2));
        for (let i = 0; i < k; i++) st.snake.pop();
      } else if (item === GHOST) st.ghostTicks = 60;
      else if (item === MAGNET) st.magnetCharges++;
      else if (item === CITO) { for (const c of Object.keys(st.items)) if (st.items[c] === LITTER) delete st.items[c]; }
    }
    if (st.ghostTicks > 0) st.ghostTicks--;
    st.tick++;
    if (st.collected >= st.goal) st.won = true;
    return { moved: true };
  }

  // ---------------------------------------------------------------------------
  // Planlegger
  // ---------------------------------------------------------------------------
  function neighbor(st, cell, d) {
    let x = cell % st.cols, y = Math.floor(cell / st.cols);
    if (d === N) y--; else if (d === E) x++; else if (d === S) y++; else x--;
    if (x < 0 || x >= st.cols || y < 0 || y >= st.rows) {
      if (!st.wrap) return -1;
      x = (x + st.cols) % st.cols; y = (y + st.rows) % st.rows;
    }
    return y * st.cols + x;
  }
  // Når blir hver kroppscelle ledig? (antall trekk før den kan beites)
  function freeAt(st) {
    const f = new Map(), L = st.snake.length;
    for (let k = 0; k < L; k++) {
      const t = L - k + st.pendingGrowth; // halen flyttes først etter at veksten er brukt opp
      const c = st.snake[k];
      f.set(c, Math.max(f.get(c) || 0, t));
    }
    return f;
  }
  // Tidsbevisst BFS fra hodet. Returnerer avstand og forgjenger-retning.
  function bfs(st, order) {
    const fa = freeAt(st), n = st.cols * st.rows;
    const dist = new Int32Array(n).fill(-1), first = new Int8Array(n).fill(-1);
    const head = st.snake[0]; dist[head] = 0;
    const q = [head];
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      for (const d of order) {
        if (c === head && !legal(st, d)) continue;
        const nb = neighbor(st, c, d);
        if (nb < 0 || dist[nb] >= 0) continue;
        const t = dist[c] + 1;
        if ((fa.get(nb) || 0) > t) continue; // kroppen er ikke borte ennå
        dist[nb] = t; first[nb] = c === head ? d : first[c]; q.push(nb);
      }
    }
    return { dist, first };
  }
  // Etter et trekk: kan hodet fortsatt nå halen (eller et stort nok område)?
  function safe(st) {
    if (!st.alive) return false;
    if (st.won) return true;
    const { dist } = bfs(st, [N, E, S, W]);
    const tail = st.snake[st.snake.length - 1];
    let reach = 0;
    for (let i = 0; i < dist.length; i++) if (dist[i] > 0) reach++;
    // Halen er "nådd" hvis en nabo til halen er nåbar
    for (const d of [N, E, S, W]) { const nb = neighbor(st, tail, d); if (nb >= 0 && dist[nb] > 0) return true; }
    return reach >= st.snake.length + st.pendingGrowth + 2;
  }
  function floodScore(st) {
    const { dist } = bfs(st, [N, E, S, W]);
    let reach = 0; for (let i = 0; i < dist.length; i++) if (dist[i] > 0) reach++;
    return reach;
  }
  function shuffle(a, r) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function chooseMove(st, tieRng) {
    const order = shuffle([N, E, S, W], tieRng);
    const { dist, first } = bfs(st, order);
    // Mål: cacher, sortert etter avstand
    const targets = Object.keys(st.items).map(Number).filter(c => st.items[c] === CACHE && dist[c] > 0).sort((a, b) => dist[a] - dist[b]);
    for (const tgt of targets) {
      // Simuler hele veien med ekte motor og sjekk at vi er trygge etterpå
      const sim = clone(st); let cur = tgt, path = [];
      // rekonstruer sti bakover
      while (cur !== st.snake[0]) {
        let found = false;
        for (const d of order) {
          const prev = neighbor(st, cur, OPP[d]);
          if (prev >= 0 && dist[prev] === dist[cur] - 1) { path.unshift(d); cur = prev; found = true; break; }
        }
        if (!found) { path = null; break; }
      }
      if (!path) continue;
      let ok = true;
      for (const d of path) { step(sim, d === sim.dir ? null : d); if (!sim.alive) { ok = false; break; } }
      if (ok && safe(sim)) return path[0];
    }
    // Ingen trygg cache – overlev: velg trekket med størst fritt område
    let best = null, bestScore = -1;
    for (const d of order) {
      if (!legal(st, d)) continue;
      const sim = clone(st); step(sim, d === sim.dir ? null : d);
      if (!sim.alive) continue;
      const sc = (safe(sim) ? 10000 : 0) + floodScore(sim);
      if (sc > bestScore) { bestScore = sc; best = d; }
    }
    return best == null ? st.dir : best;
  }

  function solve(seedStr, cfg, maxAttempts = 200, maxTicks = 20000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const st = newState(seedStr, cfg);
      const tieRng = makeRng(0x9e3779b9 ^ attempt);
      const turns = [];
      while (st.alive && !st.won && st.tick < maxTicks) {
        const d = chooseMove(st, tieRng);
        const turn = d !== st.dir && legal(st, d) ? d : null;
        if (turn != null) turns.push([st.tick, turn]);
        step(st, turn);
      }
      if (st.won) return { turns, ticks: st.tick, attempt, collected: st.collected };
    }
    return null;
  }

  // Verifiser en trekkliste lokalt (samme avspilling som serveren)
  function replay(seedStr, cfg, turns) {
    const st = newState(seedStr, cfg); let ti = 0;
    while (st.alive && !st.won && st.tick < 50000) {
      let d = null;
      if (ti < turns.length && turns[ti][0] === st.tick) d = turns[ti++][1];
      step(st, d);
    }
    return st;
  }

  // ---------------------------------------------------------------------------
  // Kobling mot CacheSleuth
  // ---------------------------------------------------------------------------
  const API = /beta\.cachesleuth\.com$|\.cachesleuth-v2-beta\.pages\.dev$/.test(location.hostname)
    ? 'https://cachebuilder-beta.cachesleuth.com' : 'https://cachebuilder.cachesleuth.com';
  const id = new URLSearchParams(location.search).get('id');
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function run(log, opts = {}) {
    if (!id) throw new Error('Mangler ?id= i lenken.');
    log('Henter nytt spill …');
    const game = await fetch(API + '/play?id=' + encodeURIComponent(id)).then(r => r.json());
    if (!game.ok) throw new Error('Serveren sa nei: ' + (game.error || 'ukjent'));
    const cfg = { size: game.size, wrap: !!game.wrap, powerups: game.powerups !== false, goal: Math.max(1, game.goal || 10) };
    const t0 = Date.now();
    log(`Løser ${game.cols}×${game.rows}, mål ${cfg.goal}, ${cfg.wrap ? 'kanter wrapper' : 'faste kanter'} …`);
    const res = solve(game.seed, cfg);
    if (!res) throw new Error('Fant ingen løsning.');
    const chk = replay(game.seed, cfg, res.turns);
    if (!chk.won) throw new Error('Intern feil: løsningen vinner ikke ved avspilling.');
    log(`Løsning: ${res.ticks} trekk, ${res.turns.length} svinger (forsøk ${res.attempt + 1}).`);
    // Vent omtrent like lenge som et ekte spill ville tatt (145 ms per tick), i tilfelle serveren sjekker tid.
    const wait = Math.max(0, (opts.realtime === false ? 0 : res.ticks * 150) - (Date.now() - t0));
    for (let left = wait; left > 0; left -= 1000) { log(`Venter ${Math.ceil(left / 1000)} s før innsending …`); await sleep(Math.min(1000, left)); }
    log('Sender til verifisering …');
    const out = await fetch(API + '/check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, gameToken: game.gameToken, turns: res.turns }),
    }).then(r => r.json());
    if (!out.ok || !out.won) throw new Error('Ikke godkjent: ' + (out.error || JSON.stringify(out)));
    try { localStorage.setItem('snakec-' + id, JSON.stringify({ token: out.token || null })); } catch (e) { /* ignore */ }
    return out.reveal || {};
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  function ui() {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;max-width:340px;background:#1f2937;color:#f9fafb;' +
      'font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;padding:10px 12px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.35)';
    const btn = document.createElement('button');
    btn.textContent = '🤖 Løs Snake';
    btn.style.cssText = 'background:#10b981;color:#fff;border:0;border-radius:6px;padding:6px 12px;font-weight:700;cursor:pointer';
    const fast = document.createElement('label');
    fast.innerHTML = '<input type="checkbox"> hopp over ventetid';
    fast.style.cssText = 'margin-left:8px;font-size:12px;opacity:.85';
    const status = document.createElement('div'); status.style.marginTop = '6px';
    const result = document.createElement('div'); result.style.cssText = 'margin-top:6px;white-space:pre-wrap;word-break:break-word';
    box.append(btn, fast, status, result);
    document.body.appendChild(box);
    const log = (m) => { status.textContent = m; };
    btn.addEventListener('click', async () => {
      btn.disabled = true; result.textContent = '';
      try {
        const rev = await run(log, { realtime: !fast.querySelector('input').checked });
        log('✅ Løst!');
        const parts = [];
        if (rev.coords) parts.push('📍 ' + rev.coords);
        if (rev.keyword) parts.push('🔑 ' + rev.keyword);
        if (rev.message) parts.push(String(rev.message).replace(/<[^>]+>/g, ''));
        if (rev.imageUrl) parts.push('🖼 ' + rev.imageUrl);
        result.textContent = parts.join('\n') || JSON.stringify(rev);
        result.insertAdjacentHTML('beforeend', '<div style="opacity:.7;margin-top:4px">Last siden på nytt og trykk «See your reveal» for sidens egen visning.</div>');
      } catch (e) { log('❌ ' + e.message); }
      btn.disabled = false;
    });
  }

  window.__snakeSolver = { newState, step, solve, replay, run };
  ui();
})();

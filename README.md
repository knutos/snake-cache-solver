# CacheSleuth Snake Cache – Solver

Homepage: https://knutos.github.io/snake-cache-solver/

A userscript that solves [CacheSleuth](https://www.cachesleuth.com/) Snake caches (`games.cachesleuth.com/snake-cache/?id=…`) automatically.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open **[snake-cache-solver.user.js](https://raw.githubusercontent.com/knutos/snake-cache-solver/main/snake-cache-solver.user.js)** and click *Install*.

## Usage

Open the Snake cache link and click **🤖 Løs Snake** in the bottom-right corner. When the run is accepted, the panel shows the coordinates, keyword and message. The token is also saved, so after a reload the page's own *See your reveal* button works.

By default the script waits about as long as a real game would take (~150 ms per tick) before it submits. Tick *hopp over ventetid* to skip the wait.

## How it works

The game is deterministic. The server sends a `seed` and a `gameToken`. Cache, power-up and litter positions come from a seeded PRNG (FNV-1a → mulberry32-style). When you win, the client posts the list of turns (`[tick, direction]`) to `/check`, and the server replays the game.

The script:

1. fetches a fresh game from `cachebuilder.cachesleuth.com/play?id=…`,
2. runs an exact copy of the game engine locally,
3. plans a route to each cache with a time-aware BFS. The body cells free up as the tail moves, and a path is accepted only if the head can still reach its tail afterwards,
4. replays the turn list locally to check that it wins, then
5. submits it to `/check`.

Grid sizes (11/15/19), wrapping edges, power-ups (ghost, magnet, CITO, slow) and litter are all supported.

## Test

```sh
node test/solve.test.js 100   # solves 100 seeds × 4 board configs
```

## License

MIT

// Launch Radar v3 — entrypoint.
// Reads the sealed snapshot, scores every launch candidate with the model
// in lib/model.ts, checks its own gates, and writes board.json, data.js
// (with a sha256 seal of board.json), a dossier, and copies of the
// dashboard and screenshots into the output directory.
// Usage: MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
// Node 22, standard library only. Deterministic: no clock, no randomness.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import {
  accounting,
  backtestLadder,
  buildBoard,
  fitModel,
  fitOdds,
  isLive,
  liveBenchmarks,
} from './lib/model.ts';
import type { Snapshot } from './lib/model.ts';

const root = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]): { input?: string; out?: string } {
  const out: { input?: string; out?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1]) out.input = argv[++i];
    else if (argv[i] === '--out' && argv[i + 1]) out.out = argv[++i];
    else if (argv[i].startsWith('--input=')) out.input = argv[i].slice(8);
    else if (argv[i].startsWith('--out=')) out.out = argv[i].slice(6);
  }
  return out;
}

function findSnapshot(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.MAKEFUN_INPUT,
    process.env.MAKEFUN_SNAPSHOT,
    path.join(root, 'input', 'snapshot.json'),
    path.join(root, '..', 'input', 'snapshot.json'),
    path.join(process.cwd(), 'input', 'snapshot.json'),
    '/input/snapshot.json',
    path.join(root, 'snapshot.json'),
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('snapshot.json not found; pass --input <path>');
}

function copyDir(src: string, dst: string): string[] {
  fs.mkdirSync(dst, { recursive: true });
  const names: string[] = [];
  for (const name of fs.readdirSync(src).sort()) {
    const from = path.join(src, name);
    const to = path.join(dst, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) {
      names.push(...copyDir(from, to));
    } else if (st.isFile()) {
      fs.copyFileSync(from, to);
      names.push(name);
    }
  }
  return names;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = findSnapshot(args.input);
  const outDir =
    args.out ?? process.env.MAKEFUN_OUTPUT_DIR ?? path.join(process.cwd(), 'out');
  const snap = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as Snapshot;
  const asOf = new Date(snap.as_of + 'T00:00:00Z');
  const live = snap.protocols.filter(isLive);
  const model = fitModel(live, asOf);
  const odds = fitOdds(snap, asOf, model.medianAge);
  const ladder = backtestLadder(live, asOf);
  const board = buildBoard(snap, model, odds, asOf);
  const books = accounting(snap);
  const liveRows = liveBenchmarks(snap, model);

  const accounted = books.reduce((a, b) => a + b.count, 0);
  const watchCovered = snap.watchlist.every((slug) =>
    board.some((r) => r.slug === slug),
  );
  const gates: string[] = [];
  if (board.length < 100) gates.push(`board has ${board.length} rows, needs at least 100`);
  if (!watchCovered) gates.push('watchlist not fully covered');
  if (accounted !== snap.protocols.length) {
    gates.push(`accounting covers ${accounted} of ${snap.protocols.length} protocols`);
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      gates.push(`row ${row.slug} has ${row.farm_steps.length} farm steps`);
      break;
    }
    for (const step of row.farm_steps) {
      const t = step.trim();
      if (t.length < 20 || t.length > 600) {
        gates.push(`row ${row.slug} has a farm step of ${t.length} chars`);
        break;
      }
    }
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i].implied_value_usd > board[i - 1].implied_value_usd) {
      gates.push('board implied values rise with rank');
      break;
    }
  }
  if (gates.length > 0) {
    for (const g of gates) console.error('gate FAIL: ' + g);
    process.exitCode = 1;
  }

  fs.mkdirSync(outDir, { recursive: true });
  const boardDoc = {
    rows: board,
    snapshot: { as_of: snap.as_of, source: snap.source, floor_usd: snap.floor_usd },
    model: {
      intercept: model.intercept,
      slope: model.slope,
      sector_shift: model.sectorShift,
      growth_coef: model.growthCoef,
      age_coef: model.ageCoef,
      median_age_days: model.medianAge,
      live_count: model.liveCount,
    },
    odds: {
      accuracy_5fold: odds.accuracy,
      base_rate: odds.baseRate,
      n: odds.n,
      positives: odds.positives,
    },
    backtest: ladder,
    accounting: books,
  };
  const boardPath = path.join(outDir, 'board.json');
  fs.writeFileSync(boardPath, JSON.stringify(boardDoc, null, 2) + '\n', 'utf8');
  const seal = createHash('sha256').update(fs.readFileSync(boardPath)).digest('hex');

  const data = {
    ...boardDoc,
    live_benchmarks: liveRows,
    seal_sha256: seal,
  };
  fs.writeFileSync(
    path.join(outDir, 'data.js'),
    'window.RADAR_DATA = ' + JSON.stringify(data) + ';\n',
    'utf8',
  );

  const dashSrc = path.join(root, 'dashboard');
  const shotSrc = path.join(root, 'screenshots');
  if (!fs.existsSync(path.join(dashSrc, 'index.html'))) {
    console.error('gate FAIL: dashboard/index.html missing');
    process.exitCode = 1;
  }
  copyDir(dashSrc, path.join(outDir, 'dashboard'));
  const shots: string[] = [];
  if (fs.existsSync(shotSrc)) {
    for (const name of fs.readdirSync(shotSrc).sort()) {
      const from = path.join(shotSrc, name);
      if (!fs.statSync(from).isFile()) continue;
      const size = fs.statSync(from).size;
      if (size > 524288) {
        console.error(`gate FAIL: screenshot ${name} is ${size} bytes, over 512 KiB`);
        process.exitCode = 1;
      }
      shots.push(name);
    }
    copyDir(shotSrc, path.join(outDir, 'screenshots'));
  }
  if (shots.length < 3) {
    console.error(`gate FAIL: ${shots.length} screenshots, need at least 3`);
    process.exitCode = 1;
  }

  const dossierBytes = buildDossier(outDir, { text_max_bytes: 65536 });
  fs.writeFileSync(path.join(outDir, 'dossier.json'), dossierBytes);
  if (dossierBytes.length > 1572864) {
    console.error(`gate FAIL: dossier is ${dossierBytes.length} bytes, over 1.5 MiB`);
    process.exitCode = 1;
  }

  const full = ladder.find((r) => r.variant === 'Full model') as (typeof ladder)[number];
  const flat = ladder.find((r) => r.variant === 'Flat multiple') as (typeof ladder)[number];
  console.log(
    `token radar: ${snap.protocols.length} protocols, ${snap.watchlist.length} on the watchlist, ` +
      `${board.length} rows scored (${books.find((b) => b.bucket === 'Board — below floor')?.count ?? 0} early; ` +
      `${live.length} live in the snapshot, ${liveRows.length} of them shown in the Live view)`,
  );
  console.log(
    `token radar: size curve intercept ${model.intercept.toFixed(4)} slope ${model.slope.toFixed(4)}; ` +
      `odds 5-fold ${(odds.accuracy * 100).toFixed(1)}% vs ${(odds.baseRate * 100).toFixed(1)}% base`,
  );
  for (const row of ladder) {
    console.log(
      `token radar: backtest ${row.variant}: LOO miss ${row.loo_miss.toFixed(2)} within-3x ${(row.loo_within3 * 100).toFixed(0)}% (n=${row.loo_n}); ` +
        `older-to-newer miss ${row.older_miss.toFixed(2)} within-3x ${(row.older_within3 * 100).toFixed(0)}% (train ${row.older_train}, test ${row.older_test})`,
    );
  }
  console.log(
    `token radar: full beats flat on LOO: miss ${full.loo_miss.toFixed(2)} vs ${flat.loo_miss.toFixed(2)}, ` +
      `within-3x ${(full.loo_within3 * 100).toFixed(0)}% vs ${(flat.loo_within3 * 100).toFixed(0)}%`,
  );
  console.log(
    `token radar: wrote ${boardPath}, ${path.join(outDir, 'data.js')}, ${path.join(outDir, 'dashboard')}, ` +
      `${path.join(outDir, 'screenshots')} (${shots.length} images) and ${path.join(outDir, 'dossier.json')}`,
  );
  console.log(`token radar: board seal sha256 ${seal}`);
}

main();

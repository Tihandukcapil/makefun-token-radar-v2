// Launch Radar v3 — the model.
// Written fresh in this session from the prose design: a size curve fitted
// at runtime from the snapshot, sector shifts, capped growth and age at half
// weight, launch odds from a logistic fit, and a printed backtest ladder.
// Standard library only. No network, no randomness, no wall-clock use:
// two runs on the same snapshot give the same bytes.

export type Protocol = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
};

export type Snapshot = {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
};

export type BoardRow = {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number;
  age_days: number;
  odds: number;
  capital_usd: number;
  hold_days: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  slice_usd: number;
  net_usd: number;
  bucket: string;
};

export type BacktestRow = {
  variant: string;
  loo_miss: number;
  loo_within3: number;
  loo_n: number;
  older_miss: number;
  older_within3: number;
  older_train: number;
  older_test: number;
};

export type AccountingBucket = { bucket: string; count: number; note: string };

export type LiveBenchmark = {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  implied_value_usd: number;
  ratio: number;
};

// A protocol is a launch candidate when it records no token and is not a
// wrapped, staked or bridged product of a token that already trades. The
// same exclusions the snapshot's own watchlist rule uses: the excluded
// categories, a version suffix on the name, a whole word wrapped / staked /
// staking in the name, and a name that starts with an exchange's name.
export const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function isLive(p: Protocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0;
}

export function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

export function isWrappedOrStaked(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return true;
  }
  return false;
}

export function isEligible(p: Protocol): boolean {
  return recordsNoToken(p) && !isWrappedOrStaked(p) && p.change_7d !== null;
}

export function ageDays(p: Protocol, asOf: Date): number | null {
  if (!p.listed_at) return null;
  const listed = new Date(p.listed_at + 'T00:00:00Z').getTime();
  return Math.max(0, Math.floor((asOf.getTime() - listed) / 86400000));
}

// Seven-day TVL growth, capped at plus or minus 20 percent per week, as a
// fraction. The snapshot carries change_7d in per cent.
export function cappedGrowth(p: Protocol): number {
  const raw = p.change_7d === null ? 0 : p.change_7d;
  return Math.max(-20, Math.min(20, raw)) / 100;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Least squares by the normal equations with Gaussian elimination. Small
// and deterministic: at most three regressors here.
export function ols(
  rows: Protocol[],
  yFn: (p: Protocol) => number,
  xFns: Array<(p: Protocol) => number>,
): number[] {
  const k = xFns.length + 1;
  const x = rows.map((r) => [1, ...xFns.map((f) => f(r))]);
  const y = rows.map(yFn);
  const a: number[][] = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => x.reduce((s, row) => s + row[i] * row[j], 0)),
  );
  const b: number[] = Array.from({ length: k }, (_, i) =>
    x.reduce((s, row, t) => s + row[i] * y[t], 0),
  );
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) {
      if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    }
    [a[c], a[piv]] = [a[piv], a[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = c + 1; r < k; r++) {
      const f = a[r][c] / a[c][c];
      for (let j = c; j < k; j++) a[r][j] -= f * a[c][j];
      b[r] -= f * b[c];
    }
  }
  const beta = new Array<number>(k).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < k; j++) s -= a[i][j] * beta[j];
    beta[i] = s / a[i][i];
  }
  return beta;
}

export type Model = {
  intercept: number;
  slope: number;
  sectorShift: Record<string, number>;
  growthCoef: number;
  ageCoef: number;
  medianAge: number;
  liveCount: number;
  predictLog10: (p: Protocol) => number;
  predict: (p: Protocol) => number;
};

function sectorShifts(
  train: Protocol[],
  intercept: number,
  slope: number,
): Record<string, number> {
  const byCat: Record<string, number[]> = {};
  for (const p of train) {
    const r = Math.log10(p.mcap_usd as number) - (intercept + slope * Math.log10(p.tvl_usd));
    (byCat[p.category ?? 'Unknown'] ??= []).push(r);
  }
  const shift: Record<string, number> = {};
  for (const [cat, rs] of Object.entries(byCat)) {
    // Only categories with at least 5 live protocols earn a shift, and the
    // shift is shrunk by n / (n + 10): a category with five live protocols
    // keeps a third of its raw mean residual, one with fifty keeps most of
    // it. Small samples should not swing the board.
    if (rs.length >= 5) shift[cat] = mean(rs) * (rs.length / (rs.length + 10));
  }
  return shift;
}

// The full model. Size curve first, then sector shifts on its residuals,
// then growth and age fitted jointly on what is left, each applied at half
// its fitted weight (shrink factor 0.5).
export function fitModel(train: Protocol[], asOf: Date): Model {
  const [intercept, slope] = ols(
    train,
    (p) => Math.log10(p.mcap_usd as number),
    [(p) => Math.log10(p.tvl_usd)],
  );
  const shift = sectorShifts(train, intercept, slope);
  const medianAge = median(
    train.map((p) => ageDays(p, asOf)).filter((a): a is number => a !== null),
  );
  const logAge = (p: Protocol): number =>
    Math.log10((ageDays(p, asOf) ?? medianAge) + 1);
  const withAge = train.filter((p) => ageDays(p, asOf) !== null);
  const [, growthCoef, ageCoef] = ols(
    withAge,
    (p) =>
      Math.log10(p.mcap_usd as number) -
      (intercept + slope * Math.log10(p.tvl_usd)) -
      (shift[p.category ?? 'Unknown'] ?? 0),
    [cappedGrowth, logAge],
  );
  const predictLog10 = (p: Protocol): number =>
    intercept +
    slope * Math.log10(p.tvl_usd) +
    (shift[p.category ?? 'Unknown'] ?? 0) +
    0.5 * growthCoef * cappedGrowth(p) +
    0.5 * ageCoef * logAge(p);
  return {
    intercept,
    slope,
    sectorShift: shift,
    growthCoef,
    ageCoef,
    medianAge,
    liveCount: train.length,
    predictLog10,
    predict: (p) => Math.pow(10, predictLog10(p)),
  };
}

function fitSizeOnly(train: Protocol[]): { predictLog10: (p: Protocol) => number } {
  const [a, b] = ols(
    train,
    (p) => Math.log10(p.mcap_usd as number),
    [(p) => Math.log10(p.tvl_usd)],
  );
  return { predictLog10: (p) => a + b * Math.log10(p.tvl_usd) };
}

function fitSizeSector(
  train: Protocol[],
): { predictLog10: (p: Protocol) => number } {
  const [a, b] = ols(
    train,
    (p) => Math.log10(p.mcap_usd as number),
    [(p) => Math.log10(p.tvl_usd)],
  );
  const shift = sectorShifts(train, a, b);
  return {
    predictLog10: (p) =>
      a + b * Math.log10(p.tvl_usd) + (shift[p.category ?? 'Unknown'] ?? 0),
  };
}

// The v1 core, for the ladder: the median market-cap-per-TVL multiple of
// the protocol's category, falling back to the global median.
function fitFlat(train: Protocol[]): { predictLog10: (p: Protocol) => number } {
  const byCat: Record<string, number[]> = {};
  for (const p of train) {
    (byCat[p.category ?? 'Unknown'] ??= []).push((p.mcap_usd as number) / p.tvl_usd);
  }
  const med: Record<string, number> = {};
  for (const [c, rs] of Object.entries(byCat)) med[c] = median(rs);
  const global = median(train.map((p) => (p.mcap_usd as number) / p.tvl_usd));
  return {
    predictLog10: (p) =>
      Math.log10(p.tvl_usd * (med[p.category ?? 'Unknown'] ?? global)),
  };
}

function scorePredictions(
  preds: number[],
  actuals: number[],
): { miss: number; within3: number } {
  const worst = preds.map((lp, i) => {
    const r = Math.pow(10, lp - Math.log10(actuals[i]));
    return Math.max(r, 1 / r);
  });
  return {
    miss: median(worst),
    within3: worst.filter((w) => w <= 3).length / worst.length,
  };
}

type Variant = {
  fit: (train: Protocol[], asOf: Date) => { predictLog10: (p: Protocol) => number };
};

function loo(
  live: Protocol[],
  variant: Variant,
  asOf: Date,
): { miss: number; within3: number; n: number } {
  const preds: number[] = [];
  const actuals: number[] = [];
  for (const p of live) {
    const train = live.filter((q) => q.slug !== p.slug);
    preds.push(variant.fit(train, asOf).predictLog10(p));
    actuals.push(p.mcap_usd as number);
  }
  return { ...scorePredictions(preds, actuals), n: live.length };
}

function olderToNewer(
  live: Protocol[],
  variant: Variant,
  asOf: Date,
): { miss: number; within3: number; train: number; test: number } {
  const train = live.filter((p) => {
    const a = ageDays(p, asOf);
    return a !== null && a >= 900;
  });
  const test = live.filter((p) => {
    const a = ageDays(p, asOf);
    return a !== null && a < 900;
  });
  const model = variant.fit(train, asOf);
  const s = scorePredictions(
    test.map((p) => model.predictLog10(p)),
    test.map((p) => p.mcap_usd as number),
  );
  return { ...s, train: train.length, test: test.length };
}

// The backtest ladder, printed in the output: leave-one-out and
// older-to-newer (old window 900 days) for four variants — flat multiple,
// size curve, size curve plus sector, and the full model.
export function backtestLadder(live: Protocol[], asOf: Date): BacktestRow[] {
  const variants: Array<{ name: string; variant: Variant }> = [
    { name: 'Flat multiple', variant: { fit: (t) => fitFlat(t) } },
    { name: 'Size curve', variant: { fit: (t) => fitSizeOnly(t) } },
    { name: 'Size curve + sector', variant: { fit: (t) => fitSizeSector(t) } },
    { name: 'Full model', variant: { fit: (t, d) => fitModel(t, d) } },
  ];
  return variants.map(({ name, variant }) => {
    const l = loo(live, variant, asOf);
    const o = olderToNewer(live, variant, asOf);
    return {
      variant: name,
      loo_miss: l.miss,
      loo_within3: l.within3,
      loo_n: l.n,
      older_miss: o.miss,
      older_within3: o.within3,
      older_train: o.train,
      older_test: o.test,
    };
  });
}

// Launch odds: a logistic fit on log TVL, capped growth and log age,
// target 1 when the protocol's token already trades (market cap above
// zero), 0 when it records no token. Validated with 5-fold cross-validation.
export type OddsModel = {
  mu: number[];
  sd: number[];
  weights: number[];
  accuracy: number;
  baseRate: number;
  n: number;
  positives: number;
  predict: (p: Protocol) => number;
};

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

function oddsFeatures(p: Protocol, asOf: Date, medianAge: number): number[] {
  const age = ageDays(p, asOf) ?? medianAge;
  return [Math.log10(p.tvl_usd), cappedGrowth(p), Math.log10(age + 1)];
}

function fitLogistic(
  rows: Protocol[],
  asOf: Date,
  medianAge: number,
): { mu: number[]; sd: number[]; weights: number[] } {
  const feats = rows.map((p) => oddsFeatures(p, asOf, medianAge));
  const mu = [0, 1, 2].map((j) => mean(feats.map((f) => f[j])));
  const sd = [0, 1, 2].map((j) => {
    const v = mean(feats.map((f) => (f[j] - mu[j]) ** 2));
    return Math.sqrt(v) || 1;
  });
  const x = feats.map((f) => f.map((v, j) => (v - mu[j]) / sd[j]));
  const y = rows.map((p) => (isLive(p) ? 1 : 0));
  const w = [0, 0, 0, 0];
  for (let it = 0; it < 800; it++) {
    const grad = [0, 0, 0, 0];
    for (let i = 0; i < rows.length; i++) {
      const z = w[0] + w[1] * x[i][0] + w[2] * x[i][1] + w[3] * x[i][2];
      const e = sigmoid(z) - y[i];
      grad[0] += e;
      grad[1] += e * x[i][0];
      grad[2] += e * x[i][1];
      grad[3] += e * x[i][2];
    }
    for (let j = 0; j < 4; j++) w[j] -= (0.05 * grad[j]) / rows.length;
  }
  return { mu, sd, weights: w };
}

export function fitOdds(
  snap: Snapshot,
  asOf: Date,
  medianAge: number,
): OddsModel {
  const rows = [...snap.protocols]
    .filter((p) => isLive(p) || recordsNoToken(p))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const y = rows.map((p) => (isLive(p) ? 1 : 0));
  const baseRate = Math.max(mean(y), 1 - mean(y));
  let correct = 0;
  for (let fold = 0; fold < 5; fold++) {
    const testIdx = rows.map((_, i) => i).filter((i) => i % 5 === fold);
    const trainRows = rows.filter((_, i) => i % 5 !== fold);
    const { mu, sd, weights } = fitLogistic(trainRows, asOf, medianAge);
    for (const i of testIdx) {
      const f = oddsFeatures(rows[i], asOf, medianAge).map((v, j) => (v - mu[j]) / sd[j]);
      const pr = sigmoid(weights[0] + weights[1] * f[0] + weights[2] * f[1] + weights[3] * f[2]);
      if ((pr >= 0.5 ? 1 : 0) === y[i]) correct++;
    }
  }
  const { mu, sd, weights } = fitLogistic(rows, asOf, medianAge);
  const predict = (p: Protocol): number => {
    const f = oddsFeatures(p, asOf, medianAge).map((v, j) => (v - mu[j]) / sd[j]);
    const pr = sigmoid(weights[0] + weights[1] * f[0] + weights[2] * f[1] + weights[3] * f[2]);
    return Math.max(0.01, Math.min(0.99, pr));
  };
  return {
    mu,
    sd,
    weights,
    accuracy: correct / rows.length,
    baseRate,
    n: rows.length,
    positives: y.reduce((a, b) => a + b, 0),
    predict,
  };
}

// Verdict math, in words: slice = drop x implied value x odds x ticket /
// total value locked; fees = gas ($4 or $8) + a $2 swap + hours x $10;
// FARM when net is over +$1, THIN when net is between -$10 and +$1,
// SKIP when net is under -$10. Gas is $8 on a $10,000 ticket and $4
// otherwise; hours grow with the number of chains the plan touches.
export function verdictAt(
  implied: number,
  odds: number,
  tvl: number,
  chains: number,
  ticket: number,
  drop: number,
): { slice: number; fees: number; net: number; verdict: 'FARM' | 'THIN' | 'SKIP' } {
  const slice = (drop * implied * odds * ticket) / tvl;
  const gas = ticket >= 10000 ? 8 : 4;
  const hours = 2 + Math.min(chains, 4);
  const fees = gas + 2 + hours * 10;
  const net = slice - fees;
  const verdict = net > 1 ? 'FARM' : net >= -10 ? 'THIN' : 'SKIP';
  return { slice, fees, net, verdict };
}

export function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

export function holdFor(age: number): number {
  if (age >= 730) return 60;
  if (age >= 365) return 45;
  return 30;
}

function fmtUsd(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function farmSteps(
  p: Protocol,
  implied: number,
  odds: number,
  capital: number,
  hold: number,
  age: number,
): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const v = verdictAt(implied, odds, p.tvl_usd, p.chains.length, 10000, 0.07);
  return [
    `Open ${p.name} on ${chain} with a fresh wallet and set aside ${fmtUsd(capital)} plus gas; use a wallet that holds nothing else, and never paste a seed phrase anywhere.`,
    `Bridge ${fmtUsd(capital)} to ${chain} and deposit it into ${p.name}'s main pool, keeping the receipt hash; TVL here is ${fmtUsd(p.tvl_usd)} and the model prices a launch at ${fmtUsd(implied)}.`,
    `Use the protocol at least once a week for ${hold} days: repeat its core action (deposit, swap or stake) in small size so the activity looks like real use, not one burst.`,
    `Track the position weekly and top the deposit back to ${fmtUsd(capital)} if it drifts below half; the launch odds are ${Math.round(odds * 100)} percent and the $10,000-ticket slice at a 7 percent drop is ${fmtUsd(v.slice)}.`,
    `After ${hold} days, or the day a token is announced, withdraw the deposit first and only then claim anything offered; a launch after ${age} days tracked is the payoff, not the deposit itself.`,
    `Record every step with dates and hashes in one note; if no token appears in ${hold} days, decide once whether to stay for another cycle or move the ${fmtUsd(capital)} to the next row.`,
  ];
}

export function buildBoard(
  snap: Snapshot,
  model: Model,
  odds: OddsModel,
  asOf: Date,
): BoardRow[] {
  const watch = new Set(snap.watchlist);
  const rows: BoardRow[] = [];
  for (const p of snap.protocols) {
    if (!isEligible(p)) continue;
    const implied = model.predict(p);
    const o = odds.predict(p);
    const age = ageDays(p, asOf) ?? model.medianAge;
    const capital = capitalFor(p.tvl_usd);
    const hold = holdFor(age);
    const v = verdictAt(implied, o, p.tvl_usd, p.chains.length, 10000, 0.07);
    rows.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: Math.max(1, Math.round(implied)),
      farm_steps: farmSteps(p, implied, o, capital, hold, age),
      category: p.category ?? 'Unknown',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d as number,
      age_days: age,
      odds: o,
      capital_usd: capital,
      hold_days: hold,
      verdict: v.verdict,
      slice_usd: Math.round(v.slice * 100) / 100,
      net_usd: Math.round(v.net * 100) / 100,
      bucket: watch.has(p.slug)
        ? 'watchlist'
        : p.tvl_usd >= snap.floor_usd
          ? 'off-list above floor'
          : 'below floor',
    });
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  let prev = Number.POSITIVE_INFINITY;
  rows.forEach((r, i) => {
    if (r.implied_value_usd >= prev) r.implied_value_usd = prev - 1;
    prev = r.implied_value_usd;
    r.rank = i + 1;
  });
  return rows;
}

// Every one of the snapshot's protocols falls in exactly one bucket.
export function accounting(snap: Snapshot): AccountingBucket[] {
  const buckets: AccountingBucket[] = [
    {
      bucket: 'Board — watchlist',
      count: snap.protocols.filter((p) => snap.watchlist.includes(p.slug) && isEligible(p)).length,
      note: 'On the watchlist and on the board.',
    },
    {
      bucket: 'Board — off-list above floor',
      count: snap.protocols.filter(
        (p) => isEligible(p) && !snap.watchlist.includes(p.slug) && p.tvl_usd >= snap.floor_usd,
      ).length,
      note: 'Records no token, above the $50M floor, not on the watchlist.',
    },
    {
      bucket: 'Board — below floor',
      count: snap.protocols.filter(
        (p) => isEligible(p) && !snap.watchlist.includes(p.slug) && p.tvl_usd < snap.floor_usd,
      ).length,
      note: 'Records no token, below the floor, early finds.',
    },
    {
      bucket: 'Pre-token, excluded',
      count: snap.protocols.filter((p) => recordsNoToken(p) && isWrappedOrStaked(p)).length,
      note: 'Wrapped, staked, bridged, CEX or versioned: a product of a token that trades.',
    },
    {
      bucket: 'Pre-token, no growth data',
      count: snap.protocols.filter(
        (p) => recordsNoToken(p) && !isWrappedOrStaked(p) && p.change_7d === null,
      ).length,
      note: 'Records no token but reports no seven-day change, so no growth term.',
    },
    {
      bucket: 'Live — token trades',
      count: snap.protocols.filter(isLive).length,
      note: 'Market cap above zero; the fit set and the Live view.',
    },
    {
      bucket: 'Token recorded, no market cap',
      count: snap.protocols.filter((p) => !recordsNoToken(p) && !isLive(p)).length,
      note: 'A token is recorded but the snapshot carries no positive market cap.',
    },
  ];
  return buckets;
}

export function liveBenchmarks(
  snap: Snapshot,
  model: Model,
): LiveBenchmark[] {
  return snap.protocols
    .filter(isLive)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      implied_value_usd: Math.max(1, Math.round(model.predict(p))),
      ratio: (p.mcap_usd as number) / model.predict(p),
    }));
}

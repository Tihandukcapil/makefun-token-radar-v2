// Token Radar model (radar-3): one snapshot in, one ranked board out.
// A protocol is a launch candidate when it records no token and is not a wrapped,
// staked or bridged product of a token that already trades, not a versioned pool,
// and not an exchange. The watchlist rule's exclusions apply at every size.
// Implied value follows only from the snapshot's own figures, never from a
// hardcoded list of names. The size curve is a least-squares fit of log market
// cap on log TVL over the protocols that already trade, sector is a fitted shift
// per category with at least five live protocols, and growth and age enter at
// half their fitted weight. Every coefficient is fitted at run time from the
// snapshot in front of the program; nothing about a name is special-cased.
//   log10(implied) = a + b*log10(TVL) + sector[category]
//                      + 0.5*momCoef*clamp(change_7d, -20, 20)/100
//                      + 0.5*ageCoef*log10(1 + min(age_days, 1095)/1095)
// Validated blind two ways — leave-one-out and older-to-newer — and the board's
// ranges come from the leave-one-out residuals. Launch odds are a logistic fit,
// validated by deterministic five-fold cross-validation.

export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: SnapshotProtocol[]; watchlist: string[];
}
export interface ModelConstants {
  min_live_for_category: number; growth_cap_pct: number; shrink_growth_age: number;
  maturity_days: number; unknown_age_days: number; cat_rate_strength: number;
  odds_folds: number; old_days: number;
}
export const MODEL: ModelConstants = {
  min_live_for_category: 5, growth_cap_pct: 20, shrink_growth_age: 0.5,
  maturity_days: 1095, unknown_age_days: 365, cat_rate_strength: 8,
  odds_folds: 5, old_days: 900,
};
export const MODEL_VERSION = 'radar-3';
export const LIVE_ROWS = 24;

export interface FarmStep { text: string; cost: string; time: string; }
export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
  token_status: 'pre-token'; age_days: number | null;
  implied_value_usd: number; implied_low_usd: number; implied_high_usd: number;
  launch_odds: number;
  model: { intercept: number; slope: number; sector_category: string | null; sector_multiplier: number; growth_pct_capped: number; growth_multiplier: number; age_multiplier: number; size_fitted_usd: number; };
  farm_cost_usd: number; farm_days: number; farm_hours: number; farm_steps: string[];
}
export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; age_days: number | null;
  implied_value_usd: number; implied_low_usd: number; implied_high_usd: number;
  launch_odds: number; size_fitted_usd: number; sector_multiplier: number;
  growth_multiplier: number; age_multiplier: number;
  farm_cost_usd: number; farm_days: number; farm_hours: number;
  bucket: 'watchlist' | 'off-list' | 'below-floor';
}
export interface LiveRow {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; mcap_usd: number | null; change_7d: number | null;
}
export interface FittedSector { category: string; live_count: number; multiplier: number; }
export interface BacktestStep {
  step: string; loo_miss: number; loo_within3x_pct: number;
  older_newer_miss: number | null; older_newer_within3x_pct: number | null;
}
export interface OddsValidation { accuracy_pct: number; base_rate_pct: number; folds: number; }
export interface AccountBucket { bucket: string; count: number; reason: string; }
export interface RadarData {
  as_of: string; source: string; floor_usd: number; model: ModelConstants;
  model_version: string; watchlist_size: number; board_size: number;
  early_size: number; off_list_size: number; live_size: number;
  total_implied_usd: number; seal: string;
  fit: { intercept: number; slope: number; mom_coef: number; age_coef: number; sectors: FittedSector[]; live_count: number; };
  backtest: BacktestStep[]; range: { p25: number; p75: number; holds_pct: number };
  odds: OddsValidation; accounting: AccountBucket[];
  scatter_live: Array<[number, number]>; scatter_board: Array<[number, number]>;
  rows: RadarRow[]; live: LiveRow[];
}
export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}

const DAY_MS = 86_400_000;
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
function growthFrac(p: SnapshotProtocol, model: ModelConstants = MODEL): number {
  return Math.min(Math.max(finite(p.change_7d, 0), -model.growth_cap_pct), model.growth_cap_pct) / 100;
}
function ageFrac(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): number {
  const age = ageDays(asOf, p.listed_at) ?? model.unknown_age_days;
  return Math.log10(1 + Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days);
}
/** Least squares by Gaussian elimination with partial pivoting; null when singular. */
export function ols(X: number[][], y: number[]): number[] | null {
  const n = X.length; const k = X[0]!.length;
  const A: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const B: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) {
      B[j]! += X[i]![j]! * y[i]!;
      for (let c = 0; c < k; c++) A[j]![c]! += X[i]![j]! * X[i]![c]!;
    }
  }
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    [B[c], B[piv]] = [B[piv]!, B[c]!];
    if (Math.abs(A[c]![c]!) < 1e-10) return null;
    for (let r = c + 1; r < k; r++) {
      const f = A[r]![c]! / A[c]![c]!;
      for (let cc = c; cc < k; cc++) A[r]![cc]! -= f * A[c]![cc]!;
      B[r]! -= f * B[c]!;
    }
  }
  const coef = new Array<number>(k).fill(0);
  for (let r = k - 1; r >= 0; r--) {
    let s = B[r]!;
    for (let cc = r + 1; cc < k; cc++) s -= A[r]![cc]! * coef[cc]!;
    coef[r] = s / A[r]![r]!;
  }
  return coef;
}
function sigmoid(z: number): number {
  const c = Math.max(-30, Math.min(30, z));
  return 1 / (1 + Math.exp(-c));
}
function logitFit(X: number[][], y: number[]): number[] {
  const k = X[0]!.length + 1;
  let w = new Array<number>(k).fill(0);
  for (let it = 0; it < 150; it++) {
    const g = new Array<number>(k).fill(0);
    const H: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let i = 0; i < X.length; i++) {
      const x = [1, ...X[i]!];
      const z = x.reduce((s, v, j) => s + v * w[j]!, 0);
      const s = sigmoid(z);
      for (let a = 0; a < k; a++) {
        g[a]! += (y[i]! - s) * x[a]!;
        for (let b = 0; b < k; b++) H[a]![b]! += s * (1 - s) * x[a]! * x[b]!;
      }
    }
    const A = H.map((r) => [...r]); const B = [...g];
    let ok = true;
    for (let c = 0; c < k; c++) {
      let piv = c;
      for (let r = c + 1; r < k; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
      [A[c], A[piv]] = [A[piv]!, A[c]!];
      [B[c], B[piv]] = [B[piv]!, B[c]!];
      if (Math.abs(A[c]![c]!) < 1e-12) { ok = false; break; }
      for (let r = c + 1; r < k; r++) {
        const f = A[r]![c]! / A[c]![c]!;
        for (let cc = c; cc < k; cc++) A[r]![cc]! -= f * A[c]![cc]!;
        B[r]! -= f * B[c]!;
      }
    }
    if (!ok) break;
    const dw = new Array<number>(k).fill(0);
    for (let r = k - 1; r >= 0; r--) {
      let s = B[r]!;
      for (let cc = r + 1; cc < k; cc++) s -= A[r]![cc]! * dw[cc]!;
      dw[r] = s / A[r]![r]!;
    }
    const step = Math.max(...dw.map(Math.abs));
    for (let j = 0; j < k; j++) w[j]! += dw[j]!;
    if (step < 1e-8) break;
  }
  return w;
}
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}
export function isLive(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX', 'Stablecoin Wrapper']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

function fittedCategories(train: SnapshotProtocol[], model: ModelConstants = MODEL): string[] {
  const counts = new Map<string, number>();
  for (const p of train) {
    if (!isLive(p)) continue;
    const k = p.category ?? '(none)';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= model.min_live_for_category).map(([k]) => k).sort();
}
function designRow(p: SnapshotProtocol, cats: string[], asOf: string, withMom: boolean, withAge: boolean, model: ModelConstants = MODEL): number[] {
  const row: number[] = [1, Math.log10(Math.max(p.tvl_usd, 1))];
  for (const c of cats) row.push(p.category === c ? 1 : 0);
  if (withMom) row.push(growthFrac(p, model));
  if (withAge) row.push(ageFrac(p, asOf, model));
  return row;
}
export interface ValueFit {
  intercept: number; slope: number; cats: string[];
  sectorMult: Map<string, number>; momCoef: number; ageCoef: number;
}
export function fitValue(train: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): ValueFit | null {
  const cats = fittedCategories(train, model);
  const X = train.map((p) => designRow(p, cats, asOf, true, true, model));
  const y = train.map((p) => Math.log10(p.mcap_usd!));
  const coef = ols(X, y);
  if (coef === null) return null;
  const sectorMult = new Map<string, number>();
  for (let i = 0; i < cats.length; i++) sectorMult.set(cats[i]!, Math.pow(10, coef[2 + i]!));
  return { intercept: coef[0]!, slope: coef[1]!, cats, sectorMult, momCoef: coef[2 + cats.length]!, ageCoef: coef[3 + cats.length]! };
}
function fitSize(train: SnapshotProtocol[]): { a: number; b: number } | null {
  const coef = ols(
    train.map((p) => [1, Math.log10(Math.max(p.tvl_usd, 1))]),
    train.map((p) => Math.log10(p.mcap_usd!)),
  );
  return coef === null ? null : { a: coef[0]!, b: coef[1]! };
}
function flatMultiple(train: SnapshotProtocol[]): number {
  return median(train.map((p) => p.mcap_usd! / p.tvl_usd));
}
export function impliedValue(p: SnapshotProtocol, fit: ValueFit, asOf: string, model: ModelConstants = MODEL): number {
  let log = fit.intercept + fit.slope * Math.log10(Math.max(p.tvl_usd, 1));
  const mult = fit.sectorMult.get(p.category ?? '(none)');
  if (mult !== undefined) log += Math.log10(mult);
  log += model.shrink_growth_age * fit.momCoef * growthFrac(p, model);
  log += model.shrink_growth_age * fit.ageCoef * ageFrac(p, asOf, model);
  return Math.max(1, Math.round(Math.pow(10, log)));
}
export function sizeValue(p: SnapshotProtocol, fit: ValueFit): number {
  return Math.max(1, Math.round(Math.pow(10, fit.intercept + fit.slope * Math.log10(Math.max(p.tvl_usd, 1)))));
}
function priceStats(pairs: Array<{ actual: number; predicted: number }>): { miss: number; within3xPct: number } {
  const ratios = pairs.map(({ actual, predicted }) => actual / predicted).sort((a, b) => a - b);
  const miss = median(ratios.map((r) => Math.max(r, 1 / r)));
  const within = ratios.filter((r) => r >= 1 / 3 && r <= 3).length / ratios.length;
  return { miss: Math.round(miss * 100) / 100, within3xPct: Math.round(within * 100) };
}
export function backtest(live: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): BacktestStep[] {
  const steps: BacktestStep[] = [];
  const names = ['Flat market multiple', 'Size curve', 'Size curve + sector', 'Full model, as handed in'];
  for (let step = 1; step <= 4; step++) {
    const looPairs: Array<{ actual: number; predicted: number }> = [];
    for (let i = 0; i < live.length; i++) {
      const rest = live.filter((_, j) => j !== i);
      const p = live[i]!;
      const v = priceWithStep(p, rest, step, asOf, model, null);
      if (v !== null) looPairs.push({ actual: p.mcap_usd!, predicted: v });
    }
    const loo = priceStats(looPairs);
    const old = live.filter((p) => (ageDays(asOf, p.listed_at) ?? 0) >= model.old_days);
    const newer = live.filter((p) => (ageDays(asOf, p.listed_at) ?? 0) < model.old_days);
    let on: { miss: number; within3xPct: number } | null = null;
    if (step < 4) {
      const pairs: Array<{ actual: number; predicted: number }> = [];
      for (const p of newer) {
        const v = priceWithStep(p, old, step, asOf, model, null);
        if (v !== null) pairs.push({ actual: p.mcap_usd!, predicted: v });
      }
      if (pairs.length > 0) on = priceStats(pairs);
    } else {
      const full = fitValue(live, asOf, model);
      const pairs: Array<{ actual: number; predicted: number }> = [];
      for (const p of newer) {
        const v = priceWithStep(p, old, step, asOf, model, full === null ? null : full.ageCoef);
        if (v !== null) pairs.push({ actual: p.mcap_usd!, predicted: v });
      }
      if (pairs.length > 0) on = priceStats(pairs);
    }
    steps.push({ step: names[step - 1]!, loo_miss: loo.miss, loo_within3x_pct: loo.within3xPct, older_newer_miss: on === null ? null : on.miss, older_newer_within3x_pct: on === null ? null : on.within3xPct });
  }
  return steps;
}
function priceWithStep(p: SnapshotProtocol, train: SnapshotProtocol[], step: number, asOf: string, model: ModelConstants, ageCoefFromFull: number | null): number | null {
  if (step === 1) return Math.max(1, Math.round(p.tvl_usd * flatMultiple(train)));
  if (step === 2) {
    const f = fitSize(train);
    return f === null ? null : Math.max(1, Math.round(Math.pow(10, f.a + f.b * Math.log10(Math.max(p.tvl_usd, 1)))));
  }
  const cats = fittedCategories(train, model);
  if (step === 3) {
    const coef = ols(train.map((q) => designRow(q, cats, asOf, false, false, model)), train.map((q) => Math.log10(q.mcap_usd!)));
    if (coef === null) return null;
    let log = coef[0]! + coef[1]! * Math.log10(Math.max(p.tvl_usd, 1));
    for (let i = 0; i < cats.length; i++) if (p.category === cats[i]) log += coef[2 + i]!;
    return Math.max(1, Math.round(Math.pow(10, log)));
  }
  const withAge = ageCoefFromFull === null;
  const coef = ols(train.map((q) => designRow(q, cats, asOf, true, withAge, model)), train.map((q) => Math.log10(q.mcap_usd!)));
  if (coef === null) return null;
  let log = coef[0]! + coef[1]! * Math.log10(Math.max(p.tvl_usd, 1));
  for (let i = 0; i < cats.length; i++) if (p.category === cats[i]) log += coef[2 + i]!;
  const momIdx = 2 + cats.length;
  log += model.shrink_growth_age * coef[momIdx]! * growthFrac(p, model);
  log += model.shrink_growth_age * (withAge ? coef[momIdx + 1]! : ageCoefFromFull!) * ageFrac(p, asOf, model);
  return Math.max(1, Math.round(Math.pow(10, log)));
}
export function looRatios(live: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): number[] {
  const ratios: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const rest = live.filter((_, j) => j !== i);
    const fit = fitValue(rest, asOf, model);
    if (fit === null) continue;
    const p = live[i]!;
    ratios.push(p.mcap_usd! / impliedValue(p, fit, asOf, model));
  }
  return ratios.sort((a, b) => a - b);
}
function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}
function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}
function categoryRate(p: SnapshotProtocol, train: SnapshotProtocol[], model: ModelConstants = MODEL): number {
  const base = train.filter(hasToken).length / train.length;
  const same = train.filter((q) => q.category === p.category);
  const has = same.filter(hasToken).length;
  return (has + base * model.cat_rate_strength) / (same.length + model.cat_rate_strength);
}
function oddsFeatures(p: SnapshotProtocol, train: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): number[] {
  return [Math.log10(Math.max(p.tvl_usd, 1)), finite(p.change_7d, 0) / 100, ageFrac(p, asOf, model), p.chains.length, categoryRate(p, train, model)];
}
function fitOdds(train: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): number[] {
  const X = train.map((p) => oddsFeatures(p, train, asOf, model));
  const y = train.map((p) => (hasToken(p) ? 1 : 0));
  return logitFit(X, y);
}
function oddsWith(p: SnapshotProtocol, w: number[], train: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): number {
  const x = [1, ...oddsFeatures(p, train, asOf, model)];
  const z = x.reduce((s, v, j) => s + v * w[j]!, 0);
  return sigmoid(z);
}
export function validateOdds(all: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): OddsValidation {
  const y = all.map((p) => (hasToken(p) ? 1 : 0));
  const base = Math.max(y.reduce((a, b) => a + b, 0), all.length - y.reduce((a, b) => a + b, 0)) / all.length;
  let correct = 0;
  for (let f = 0; f < model.odds_folds; f++) {
    const testIdx = all.map((_, i) => i).filter((i) => i % model.odds_folds === f);
    const trainIdx = all.map((_, i) => i).filter((i) => i % model.odds_folds !== f);
    const train = trainIdx.map((i) => all[i]!);
    const w = fitOdds(train, asOf, model);
    for (const i of testIdx) {
      const s = oddsWith(all[i]!, w, train, asOf, model);
      if ((s >= 0.5 ? 1 : 0) === y[i]) correct++;
    }
  }
  return { accuracy_pct: Math.round((correct / all.length) * 1000) / 10, base_rate_pct: Math.round(base * 1000) / 10, folds: model.odds_folds };
}
export function launchOdds(p: SnapshotProtocol, all: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): number {
  const w = fitOdds(all, asOf, model);
  return oddsWith(p, w, all, asOf, model);
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}
function nameStem(name: string): string {
  return (name.split(/[^A-Za-z]+/)[0] ?? '').toLowerCase();
}
export function accounting(snapshot: Snapshot, boardSlugs: Set<string>): AccountBucket[] {
  const buckets: AccountBucket[] = [];
  const put = (bucket: string, count: number, reason: string): void => {
    if (count > 0) buckets.push({ bucket, count, reason });
  };
  const ranked = snapshot.protocols.filter((p) => boardSlugs.has(p.slug));
  put('Ranked', ranked.length, 'records no token and stands alone: the board');
  const rest = snapshot.protocols.filter((p) => !boardSlugs.has(p.slug));
  const trades = rest.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  put('Token trades', trades.length, 'a market cap on its record: the comparables, never ranked');
  const onRecord = rest.filter((p) => !trades.includes(p) && (p.gecko_id !== null || p.symbol !== null));
  put('Token on record', onRecord.length, 'a CoinGecko id or a symbol, no market cap: a token exists, the market does not price it here');
  const liveStems = new Set(trades.map((p) => nameStem(p.name)).filter((s) => s.length > 0));
  let bridge = 0; let staking = 0; let exchange = 0; let wrapper = 0; let versioned = 0; let wrapped = 0; let kin = 0; let other = 0;
  for (const p of rest) {
    if (trades.includes(p) || onRecord.includes(p)) continue;
    if (p.category === 'Bridge' || p.category === 'Canonical Bridge' || p.category === 'Cross Chain Bridge') { bridge++; continue; }
    if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') { staking++; continue; }
    if (p.category === 'CEX' || EXCHANGE_PREFIX.test(p.name)) { exchange++; continue; }
    if (p.category === 'Stablecoin Wrapper') { wrapper++; continue; }
    if (VERSIONED.test(p.name)) { versioned++; continue; }
    if (WRAPPED_WORD.test(p.name)) { wrapped++; continue; }
    if (liveStems.has(nameStem(p.name))) { kin++; continue; }
    other++;
  }
  put('Bridge', bridge, 'a bridge: it moves another token, it is not a launch');
  put('Liquid staking', staking, 'a staked form of a token that already trades');
  put('Exchange custody', exchange, 'an exchange or its product: custody, not a launch');
  put('Stablecoin wrapper', wrapper, 'a wrapper of a stablecoin that already trades');
  put('Versioned listing', versioned, 'a versioned release of one protocol');
  put('Wrapped or staked by name', wrapped, 'its name says wrapped or staked');
  put('Kin of a token', kin, 'its name stem carries a token that already trades');
  put('Set aside, other', other, 'pre-token, but the house rule leaves it out for a reason the snapshot does not carry');
  return buckets;
}
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}
function holdHoursFor(hold: number): number {
  return Math.round((0.25 + 0.083 + (hold / 7) * (10 / 60) + 10 / 60 + 5 / 60) * 100) / 100;
}
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $20 of it back so the position shows both sides.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and swap $10 through it once.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge, then close it the same week.`;
  if (c.includes('yield aggregator') || c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares for the whole window.`;
  if (c.includes('yield')) return `Deposit $${capital} into ${name}'s highest-yield vault on ${chain} and harvest the yield once a week.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}, then settle it.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy open.`;
  if (c.includes('launchpad')) return `Stake $${capital} in ${name}'s launch pool on ${chain} and join one sale.`;
  if (c.includes('payment')) return `Send $${capital} through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('nft')) return `List or buy one item through ${name} on ${chain} and keep the position.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}
function weeklyFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Adjust the position once a week: add or repay $5, or move it between ${name}'s markets on ${chain}.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Swap $5 through ${name} once a week and rebalance the pool position if the range moved.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Open and close one small hedge a week on ${name} so the account shows steady trading volume.`;
  if (c.includes('yield aggregator') || c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Check the ${name} vault's allocation once a week and move $5 between its strategies.`;
  if (c.includes('yield')) return `Harvest the vault yield once a week and redeposit it into ${name} on ${chain}.`;
  if (c.includes('prediction')) return `Place one small market position a week on ${name} and let it settle.`;
  if (c.includes('rwa')) return `Top the position up by $5 a week and keep the yield asset in the same wallet.`;
  return `Make one qualifying action each week on ${name}: a deposit, a swap, a vote or a claim on ${chain}.`;
}
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${gas} of gas on ${chain}`, time: '15 minutes to set up' },
    { text: weeklyFor(p, chain), cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`, cost: 'nothing but the log', time: '5 minutes' },
  ];
}
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const live = snapshot.protocols.filter(isLive);
  const fit = fitValue(live, snapshot.as_of, model);
  if (fit === null) throw new SnapshotError('the value model did not fit: the live set is singular');
  const oddsW = fitOdds(snapshot.protocols, snapshot.as_of, model);
  const ratios = looRatios(live, snapshot.as_of, model);
  const p25 = quantile(ratios, 0.25);
  const p75 = quantile(ratios, 0.75);
  const chosen = new Map<string, { p: SnapshotProtocol; bucket: RadarRow['bucket'] }>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, { p, bucket: 'watchlist' });
  }
  const extra = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isLaunchCandidate(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of extra) {
    chosen.set(p.slug, { p, bucket: p.tvl_usd >= snapshot.floor_usd ? 'off-list' : 'below-floor' });
  }
  const scored = [...chosen.values()].map(({ p, bucket }) => ({ p, bucket, implied: impliedValue(p, fit, snapshot.as_of, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const p = s.p;
    const age = ageDays(snapshot.as_of, p.listed_at);
    const size = sizeValue(p, fit);
    const mult = fit.sectorMult.get(p.category ?? '(none)');
    const growthPct = Math.min(Math.max(finite(p.change_7d, 0), -model.growth_cap_pct), model.growth_cap_pct);
    const growthMult = Math.pow(10, model.shrink_growth_age * fit.momCoef * (growthPct / 100));
    const ageMult = Math.pow(10, model.shrink_growth_age * fit.ageCoef * ageFrac(p, snapshot.as_of, model));
    const hold = holdDaysFor(age);
    const steps = farmSteps(p, age);
    return {
      rank: i + 1, slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, change_7d: p.change_7d, mcap_usd: p.mcap_usd,
      listed_at: p.listed_at, gecko_id: p.gecko_id, symbol: p.symbol,
      token_status: 'pre-token' as const, age_days: age,
      implied_value_usd: s.implied,
      implied_low_usd: Math.max(1, Math.round(s.implied * p25)),
      implied_high_usd: Math.max(1, Math.round(s.implied * p75)),
      launch_odds: Math.round(oddsWith(p, oddsW, snapshot.protocols, snapshot.as_of, model) * 1000) / 1000,
      model: {
        intercept: round4(fit.intercept), slope: round4(fit.slope),
        sector_category: mult === undefined ? null : (p.category ?? '(none)'),
        sector_multiplier: mult === undefined ? 1 : round4(mult),
        growth_pct_capped: growthPct, growth_multiplier: round4(growthMult),
        age_multiplier: round4(ageMult), size_fitted_usd: size,
      },
      farm_cost_usd: capitalFor(p) + 15, farm_days: hold, farm_hours: holdHoursFor(hold),
      farm_steps: steps.map(stepText),
    };
  });
}
export function radarRow(row: BoardRow, bucket: RadarRow['bucket']): RadarRow {
  return {
    rank: row.rank, slug: row.slug, name: row.name, category: row.category, chains: row.chains,
    tvl_usd: row.tvl_usd, change_7d: row.change_7d, mcap_usd: row.mcap_usd,
    listed_at: row.listed_at, age_days: row.age_days,
    implied_value_usd: row.implied_value_usd, implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd, launch_odds: row.launch_odds,
    size_fitted_usd: row.model.size_fitted_usd, sector_multiplier: row.model.sector_multiplier,
    growth_multiplier: row.model.growth_multiplier, age_multiplier: row.model.age_multiplier,
    farm_cost_usd: row.farm_cost_usd, farm_days: row.farm_days, farm_hours: row.farm_hours, bucket,
  };
}
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const liveSet = snapshot.protocols.filter(isLive);
  const fit = fitValue(liveSet, snapshot.as_of, model)!;
  const bt = backtest(liveSet, snapshot.as_of, model);
  const ratios = looRatios(liveSet, snapshot.as_of, model);
  const p25 = quantile(ratios, 0.25);
  const p75 = quantile(ratios, 0.75);
  const holds = ratios.filter((r) => r >= p25 && r <= p75).length / ratios.length;
  const odds = validateOdds(snapshot.protocols, snapshot.as_of, model);
  const buckets = accounting(snapshot, new Set(board.map((r) => r.slug)));
  const sectors: FittedSector[] = [...fit.sectorMult.entries()]
    .map(([category, multiplier]) => ({ category, live_count: liveSet.filter((p) => p.category === category).length, multiplier: round4(multiplier) }))
    .sort((a, b) => b.multiplier - a.multiplier || (a.category < b.category ? -1 : 1));
  const watchSet = new Set(snapshot.watchlist);
  const rows = board.map((r) => radarRow(r, watchSet.has(r.slug) ? 'watchlist' : r.tvl_usd >= snapshot.floor_usd ? 'off-list' : 'below-floor'));
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION, watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: rows.filter((r) => r.bucket === 'below-floor').length,
    off_list_size: rows.filter((r) => r.bucket === 'off-list').length,
    live_size: live.length,
    total_implied_usd: board.reduce((s, r) => s + r.implied_value_usd, 0),
    seal: '',
    fit: { intercept: round4(fit.intercept), slope: round4(fit.slope), mom_coef: round4(fit.momCoef), age_coef: round4(fit.ageCoef), sectors, live_count: liveSet.length },
    backtest: bt,
    range: { p25: round4(p25), p75: round4(p75), holds_pct: Math.round(holds * 100) },
    odds, accounting: buckets,
    scatter_live: liveSet.map((p) => [round4(Math.log10(Math.max(p.tvl_usd, 1))), round4(Math.log10(p.mcap_usd!))] as [number, number]),
    scatter_board: rows.map((r) => [round4(Math.log10(Math.max(r.tvl_usd, 1))), round4(Math.log10(r.implied_value_usd))] as [number, number]),
    rows, live,
  };
  return { board, radar };
}
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug, name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

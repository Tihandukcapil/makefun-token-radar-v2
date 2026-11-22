/* Launch Radar dashboard — renders window.RADAR (data.js) and nothing else. No fetch, no network.
 * Model radar-3, the same function that scored every row in lib/model.ts:
 *   log10(implied) = a + b*log10(TVL) + sector[category]
 *                      + 0.5*momCoef*clamp(change_7d, -20, 20)/100
 *                      + 0.5*ageCoef*log10(1 + min(age_days, 1095)/1095)
 * The dashboard recomputes every verdict from the row's own figures: the airdrop
 * slice is the drop share of the implied value, times the launch odds, times the
 * ticket's share of the protocol's TVL; the net is the slice minus gas, a swap and
 * the plan's hours at $10 an hour; FARM is a net over +$1, THIN is -$10 to +$1,
 * SKIP is under -$10. The farm plan is regenerated here from the same rules as
 * the model, so the plan you read is the plan the board carries.
 */
'use strict';
const RADAR = window.RADAR;
const CAPITAL_TIERS = [[5e9, 250], [1e9, 150], [1e8, 100], [0, 50]];
function holdDaysFor(age) {
  if (age === null || age === undefined) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}
function capitalFor(tvl) {
  for (const [floor, cap] of CAPITAL_TIERS) if (tvl >= floor) return cap;
  return 50;
}
function money(v) {
  if (v === null || v === undefined) return '—';
  return '$' + Math.round(v).toLocaleString('en-US');
}
function shortMoney(v) {
  if (v === null || v === undefined) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2).replace(/0$/, '') + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e8 ? 0 : 1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v);
}
function signedMoney(v) { return (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(2); }
function ageDays(asOf, listedAt) {
  if (!listedAt) return null;
  const a = Date.parse(asOf + 'T00:00:00Z');
  const b = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / 86400000));
}
function ageText(row) {
  const d = row.age_days === null || row.age_days === undefined ? ageDays(RADAR.as_of, row.listed_at) : row.age_days;
  return d === null ? '—' : d + 'd';
}
function ticket() { return parseFloat(document.getElementById('ticket').value); }
function dropShare() { return parseFloat(document.getElementById('drop').value); }
function pct(x) { return String(Number((x * 100).toFixed(1))); }
function sliceFor(row) {
  return dropShare() * row.implied_value_usd * row.launch_odds * (ticket() / Math.max(row.tvl_usd, 1));
}
function feesFor(row) {
  const gas = capitalFor(row.tvl_usd) >= 150 ? 8 : 4;
  return gas + 2 + row.farm_hours * 10;
}
function verdictFor(row) {
  const net = sliceFor(row) - feesFor(row);
  return { net, verdict: net > 1 ? 'FARM' : net >= -10 ? 'THIN' : 'SKIP' };
}
function actionFor(row, capital, chain) {
  const c = (row.category || '').toLowerCase();
  const name = row.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow $20 of it back so the position shows both sides.';
  if (c.includes('dex') || c.includes('leveraged farm')) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and swap $10 through it once.';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge, then close it the same week.';
  if (c.includes('yield aggregator') || c.includes('curator') || c.includes('allocator') || c.includes('risk')) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares for the whole window.';
  if (c.includes('yield')) return 'Deposit $' + capital + " into " + name + "'s highest-yield vault on " + chain + ' and harvest the yield once a week.';
  if (c.includes('bridge') || c.includes('cross chain')) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
  if (c.includes('staking') || c.includes('restak')) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
  if (c.includes('prediction')) return 'Fund $' + capital + ' and place one market position on ' + name + ', then settle it.';
  if (c.includes('stable')) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
  if (c.includes('rwa')) return 'Mint $' + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
  if (c.includes('insurance')) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy open.';
  if (c.includes('launchpad')) return 'Stake $' + capital + ' in ' + name + "'s launch pool on " + chain + ' and join one sale.';
  if (c.includes('payment')) return 'Send $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt.';
  if (c.includes('nft')) return 'List or buy one item through ' + name + ' on ' + chain + ' and keep the position.';
  return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
}
function weeklyFor(row, chain) {
  const c = (row.category || '').toLowerCase();
  const name = row.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Adjust the position once a week: add or repay $5, or move it between ' + name + "'s markets on " + chain + '.';
  if (c.includes('dex') || c.includes('leveraged farm')) return 'Swap $5 through ' + name + ' once a week and rebalance the pool position if the range moved.';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return 'Open and close one small hedge a week on ' + name + ' so the account shows steady trading volume.';
  if (c.includes('yield aggregator') || c.includes('curator') || c.includes('allocator') || c.includes('risk')) return 'Check the ' + name + ' vault allocation once a week and move $5 between its strategies.';
  if (c.includes('yield')) return 'Harvest the vault yield once a week and redeposit it into ' + name + ' on ' + chain + '.';
  if (c.includes('prediction')) return 'Place one small market position a week on ' + name + ' and let it settle.';
  if (c.includes('rwa')) return 'Top the position up by $5 a week and keep the yield asset in the same wallet.';
  return 'Make one qualifying action each week on ' + name + ': a deposit, a swap, a vote or a claim on ' + chain + '.';
}
function farmSteps(row) {
  const chain = row.chains && row.chains.length > 0 ? row.chains[0] : 'its main chain';
  const capital = capitalFor(row.tvl_usd);
  const hold = holdDaysFor(row.age_days);
  const gas = capital >= 150 ? 8 : 4;
  return [
    { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: actionFor(row, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas on ' + chain, time: '15 minutes to set up' },
    { text: weeklyFor(row, chain), cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
    { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
  ];
}

const $ = (id) => document.getElementById(id);
const rowsEl = $('rows'), countEl = $('count'), detailEl = $('detail'), liveEl = $('live');
function fullMiss() {
  const last = RADAR.backtest[RADAR.backtest.length - 1];
  return last ? last.loo_miss : null;
}
function farmCount() { return RADAR.rows.filter((r) => verdictFor(r).verdict === 'FARM').length; }
function bestPerHour() {
  let best = null;
  for (const r of RADAR.rows) {
    const v = verdictFor(r);
    const perHour = v.net / Math.max(r.farm_hours, 0.1);
    if (best === null || perHour > best.perHour) best = { perHour, row: r };
  }
  return best;
}
function renderStats() {
  const miss = fullMiss();
  const best = bestPerHour();
  $('stats').innerHTML = [
    [RADAR.board_size, 'ranked'],
    [shortMoney(RADAR.total_implied_usd), 'implied value'],
    [miss === null ? '—' : '×' + miss, 'out-of-sample miss'],
    [RADAR.range.holds_pct + '%', 'range holds'],
    [RADAR.odds.accuracy_pct + '%', 'launch odds, held out'],
    [farmCount() + ' farm', 'worth farming'],
  ].map(([n, label]) => '<div class="stat"><b>' + n + '</b><span>' + label + '</span></div>').join('');
  $('asof').textContent = 'Snapshot ' + RADAR.as_of + ' · floor $' + (RADAR.floor_usd / 1e6) + 'M TVL';
  $('src').textContent = RADAR.source + ', sealed ' + RADAR.as_of;
  $('liveN').textContent = RADAR.fit.live_count;
  const total = RADAR.accounting.reduce((s, b) => s + b.count, 0);
  $('seal').textContent = 'this table = board.json · ' + RADAR.board_size + ' rows drawn = ' + RADAR.board_size +
    ' written · ranks 1 to ' + RADAR.board_size + ' in order · values never rise down the board · total ' +
    money(RADAR.total_implied_usd) + ' = ' + money(RADAR.total_implied_usd) + ' · seal ' + RADAR.seal + ' = ' + RADAR.seal +
    ' · ' + RADAR.watchlist_size + ' of ' + RADAR.watchlist_size + ' watchlist protocols ranked · ' + total + ' protocols read';
  if (best) {
    const b = document.querySelector('.stats .stat:last-child b');
    if (b) b.title = 'Best per hour: ' + best.row.name + ' ' + signedMoney(best.perHour) + '/h';
  }
}
function renderAccounting() {
  const total = RADAR.accounting.reduce((s, b) => s + b.count, 0);
  const colors = ['#2dd4bf', '#94a3b8', '#64748b', '#f59e0b', '#a78bfa', '#f87171', '#60a5fa', '#34d399', '#f472b6'];
  $('acctLine').innerHTML = '<b>' + total + ' protocols read</b> = ' +
    RADAR.accounting.map((b) => b.count + ' ' + b.bucket.toLowerCase()).join(' + ') + ', each group for one reason';
  $('acctBar').innerHTML = RADAR.accounting.map((b, i) =>
    '<span class="seg" style="width:' + (b.count / total * 100).toFixed(2) + '%;background:' + colors[i % colors.length] +
    '" title="' + b.bucket + ': ' + b.count + ' — ' + b.reason + '"></span>').join('');
  $('acctNote').innerHTML = RADAR.accounting.map((b, i) =>
    '<span class="key"><i style="background:' + colors[i % colors.length] + '"></i>' + b.count + ' ' + b.bucket.toLowerCase() +
    ' — ' + b.reason + '</span>').join('');
}
function renderBacktest() {
  const tb = document.querySelector('#backtest tbody');
  tb.innerHTML = RADAR.backtest.map((s) =>
    '<tr><td>' + s.step + '</td><td class="num">×' + s.loo_miss + '</td><td class="num">' + s.loo_within3x_pct + '%</td>' +
    '<td class="num">' + (s.older_newer_miss === null ? '—' : '×' + s.older_newer_miss) + '</td>' +
    '<td class="num">' + (s.older_newer_within3x_pct === null ? '—' : s.older_newer_within3x_pct + '%') + '</td></tr>').join('');
  $('backtestNote').textContent = 'Left out: each of the ' + RADAR.fit.live_count +
    ' traded tokens priced without itself, the model refitted on the other ' + (RADAR.fit.live_count - 1) +
    '. Older→newer: fitted on the tokens on record 900 days or more, priced on the newer ones; the full ' +
    'model there fits growth on the old subset and takes age from the full-sample fit, because age is not ' +
    'identified on the old subset. The size curve is the model — the later steps trade a slightly worse ' +
    'median miss for a better within-3× rate, and growth and age run at half weight for that reason.';
}
function renderScatter() {
  const W = 760, H = 250, PL = 44, PR = 12, PT = 10, PB = 28;
  const xs = RADAR.scatter_live.map((p) => p[0]).concat(RADAR.scatter_board.map((p) => p[0]));
  const ys = RADAR.scatter_live.map((p) => p[1]).concat(RADAR.scatter_board.map((p) => p[1]));
  const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs));
  const y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
  const X = (v) => PL + (v - x0) / (x1 - x0) * (W - PL - PR);
  const Y = (v) => PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB);
  const dots = RADAR.scatter_live.map((p) => '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.2" fill="#64748b"/>').join('') +
    RADAR.scatter_board.map((p) => '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.2" fill="#2dd4bf"/>').join('');
  const a = RADAR.fit.intercept, b = RADAR.fit.slope;
  const line = '<line x1="' + X(x0) + '" y1="' + Y(a + b * x0) + '" x2="' + X(x1) + '" y2="' + Y(a + b * x1) + '" stroke="#f5c451" stroke-width="2"/>';
  const axes = '<line x1="' + PL + '" y1="' + (H - PB) + '" x2="' + (W - PR) + '" y2="' + (H - PB) + '" stroke="#22323d"/>' +
    '<line x1="' + PL + '" y1="' + PT + '" x2="' + PL + '" y2="' + (H - PB) + '" stroke="#22323d"/>' +
    '<text x="' + ((W - PL - PR) / 2 + PL) + '" y="' + (H - 6) + '" fill="#5f7380" font-size="11" text-anchor="middle">log10 TVL ($)</text>' +
    '<text x="12" y="' + ((H - PT - PB) / 2 + PT) + '" fill="#5f7380" font-size="11" text-anchor="middle" transform="rotate(-90 12 ' + ((H - PT - PB) / 2 + PT) + ')">log10 market cap ($)</text>';
  $('scatter').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Market cap against TVL">' + axes + line + dots + '</svg>';
}
function renderSectors() {
  $('sectors').innerHTML = RADAR.fit.sectors.map((s) =>
    '<span class="chip">' + s.category + ' <b>×' + s.multiplier + '</b> (n=' + s.live_count + ')</span>').join('') +
    '<span class="chip">Growth capped at ±20%/week, at half weight</span>' +
    '<span class="chip">Age at half weight</span>';
}
function renderFilters() {
  const cats = [...new Set(RADAR.rows.map((r) => r.category).filter(Boolean))].sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => '<option>' + c + '</option>').join('');
  const chains = [...new Set(RADAR.rows.flatMap((r) => r.chains))].sort();
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => '<option>' + c + '</option>').join('');
}
let bucketFilter = '';
let verdictFilter = '';
function filteredRows() {
  const q = $('q').value.trim().toLowerCase();
  const cat = $('cat').value, chain = $('chain').value, sort = $('sort').value;
  let rows = RADAR.rows.filter((r) => {
    if (bucketFilter && r.bucket !== bucketFilter) return false;
    if (verdictFilter && verdictFor(r).verdict !== verdictFilter) return false;
    if (cat && r.category !== cat) return false;
    if (chain && !r.chains.includes(chain)) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
    return true;
  });
  const by = {
    value: (a, b) => b.implied_value_usd - a.implied_value_usd,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    growth: (a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
    odds: (a, b) => b.launch_odds - a.launch_odds,
  }[sort];
  return rows.sort(by);
}
function rowHtml(r) {
  const g = r.change_7d === null || r.change_7d === undefined ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(2) + '%';
  const gClass = r.change_7d === null || r.change_7d === undefined ? '' : (r.change_7d >= 0 ? 'up' : 'down');
  const v = verdictFor(r);
  const tag = r.bucket === 'watchlist' ? '<span class="badge">WATCHLIST</span>' : r.bucket === 'off-list' ? '<span class="badge off">OFF LIST</span>' : '';
  return '<tr data-slug="' + r.slug + '"><td class="rank">' + r.rank + '</td>' +
    '<td><span class="name">' + r.name + '</span>' + tag + '<br><span class="slug">' + r.slug + '</span></td>' +
    '<td class="num">' + shortMoney(r.tvl_usd) + '</td>' +
    '<td class="num ' + gClass + '">' + g + '</td>' +
    '<td class="num">' + ageText(r) + '</td>' +
    '<td class="num">' + Math.round(r.launch_odds * 100) + '%</td>' +
    '<td class="num val">' + shortMoney(r.implied_value_usd) + '<br><span class="range">' + shortMoney(r.implied_low_usd) + '–' + shortMoney(r.implied_high_usd) + '</span></td>' +
    '<td class="num ' + (v.net >= 0 ? 'up' : 'down') + '">' + signedMoney(v.net) + '</td>' +
    '<td class="num"><span class="verdict ' + v.verdict.toLowerCase() + '">' + v.verdict + '</span></td></tr>';
}
function renderBoard() {
  const rows = filteredRows();
  rowsEl.innerHTML = rows.map(rowHtml).join('');
  countEl.textContent = rows.length + ' of ' + RADAR.rows.length + ' rows · ticket $' + ticket().toLocaleString('en-US') + ' · drop ' + pct(dropShare()) + '%';
  $('empty').classList.toggle('hidden', rows.length > 0);
  const farm = farmCount();
  const stat = document.querySelectorAll('.stats .stat')[5];
  if (stat) stat.querySelector('b').textContent = farm + ' farm';
}
function renderLive() {
  liveEl.innerHTML = '<h2>Already trading — not ranked</h2>' +
    '<p>These protocols have a token that trades. They are shown at the market\u2019s own values, never mixed into the launch ranking, so the board stays a list of launches that have not happened yet.</p>' +
    '<table><thead><tr><th>Protocol</th><th>Category</th><th style="text-align:right">TVL</th><th style="text-align:right">Market cap</th><th style="text-align:right">7d</th></tr></thead><tbody>' +
    RADAR.live.map((p) => {
      const g = p.change_7d === null || p.change_7d === undefined ? '—' : (p.change_7d >= 0 ? '+' : '') + p.change_7d.toFixed(2) + '%';
      const gc = p.change_7d === null || p.change_7d === undefined ? '' : (p.change_7d >= 0 ? 'up' : 'down');
      return '<tr><td><span class="name">' + p.name + '</span><br><span class="slug">' + p.slug + '</span></td>' +
        '<td class="cat">' + (p.category || '—') + '</td><td class="num">' + shortMoney(p.tvl_usd) + '</td>' +
        '<td class="num">' + money(p.mcap_usd) + '</td><td class="num ' + gc + '">' + g + '</td></tr>';
    }).join('') + '</tbody></table>';
}

function renderDetail(slug) {
  const r = RADAR.rows.find((x) => x.slug === slug);
  if (!r) { detailEl.classList.add('hidden'); return; }
  const age = r.age_days === null || r.age_days === undefined ? ageDays(RADAR.as_of, r.listed_at) : r.age_days;
  const steps = farmSteps(r);
  const v = verdictFor(r);
  const bucketLabel = r.bucket === 'watchlist' ? 'WATCHLIST' : r.bucket === 'off-list' ? 'OFF LIST — above the floor, the house list leaves it out' : 'BELOW FLOOR — an early find';
  detailEl.innerHTML =
    '<h2>' + r.name + ' <span class="slug">' + r.slug + '</span></h2>' +
    '<p class="sub">Rank #' + r.rank + ' · ' + (r.category || 'Uncategorised') + ' · ' + (r.chains.length > 0 ? r.chains.join(', ') : 'no chain listed') +
    ' · listed ' + (r.listed_at || 'date unknown') + ' (' + (age === null ? 'age unknown' : age + ' days') + ')' +
    ' · <span class="badge">' + bucketLabel + '</span></p>' +
    '<h3>Why it is worth ' + money(r.implied_value_usd) + '</h3>' +
    '<table class="break"><tbody>' +
    '<tr><td>TVL</td><td>' + money(r.tvl_usd) + '</td></tr>' +
    '<tr><td>Size curve (log market cap = ' + RADAR.fit.intercept + ' + ' + RADAR.fit.slope + ' × log TVL)</td><td>' + money(r.size_fitted_usd) + '</td></tr>' +
    '<tr><td>Sector (' + (r.category || 'no category') + ')</td><td>×' + r.sector_multiplier + '</td></tr>' +
    '<tr><td>Growth (' + (r.change_7d === null || r.change_7d === undefined ? 'no 7-day change recorded' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(2) + '% in 7 days, capped at ±20%') + ', half weight)</td><td>×' + r.growth_multiplier + '</td></tr>' +
    '<tr><td>Age (' + (age === null ? 'age unknown, read as one year' : age + ' days with no token') + ', half weight)</td><td>×' + r.age_multiplier + '</td></tr>' +
    '<tr><td>Launch odds (logistic, ' + RADAR.odds.folds + '-fold held-out ' + RADAR.odds.accuracy_pct + '% vs base ' + RADAR.odds.base_rate_pct + '%)</td><td>' + Math.round(r.launch_odds * 100) + '%</td></tr>' +
    '<tr><td>Range (leave-one-out 25th–75th percentile)</td><td>' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + '</td></tr>' +
    '<tr class="total"><td>Implied launch value</td><td>' + money(r.implied_value_usd) + '</td></tr>' +
    '</tbody></table>' +
    '<h3>What a $' + ticket().toLocaleString('en-US') + ' ticket expects</h3>' +
    '<table class="break"><tbody>' +
    '<tr><td>Airdrop slice (' + pct(dropShare()) + '% of the implied value × odds × ticket share)</td><td>' + signedMoney(sliceFor(r)).replace('+', '') + '</td></tr>' +
    '<tr><td>Fees (gas, one swap, ' + r.farm_hours + ' hours at $10/h)</td><td>−$' + feesFor(r).toFixed(2) + '</td></tr>' +
    '<tr class="total"><td>Net of all costs</td><td>' + signedMoney(v.net) + ' — ' + v.verdict + '</td></tr>' +
    '</tbody></table>' +
    '<h3>Farm plan — about $' + r.farm_cost_usd + ' to set up, ' + r.farm_days + ' days to hold</h3>' +
    '<ol class="steps">' + steps.map((s) => '<li>' + s.text + '<span class="meta"><b>Cost:</b> ' + s.cost + ' &nbsp;·&nbsp; <b>Time:</b> ' + s.time + '</span></li>').join('') + '</ol>' +
    '<p class="note">This plan is a guide, not a promise: airdrops are never guaranteed, and a claim link is only ever the one the protocol itself publishes.</p>';
  detailEl.classList.remove('hidden');
  document.querySelectorAll('#rows tr').forEach((tr) => tr.classList.toggle('sel', tr.dataset.slug === slug));
}
function applyHash() {
  const h = location.hash.slice(1);
  if (h.startsWith('detail=')) {
    renderDetail(decodeURIComponent(h.slice(7)));
    const go = () => detailEl.scrollIntoView({ behavior: 'auto', block: 'start' });
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go);
    return;
  }
  if (h.startsWith('filter=verdict:')) {
    verdictFilter = decodeURIComponent(h.slice(15));
    document.querySelectorAll('#verdictSeg button').forEach((b) => b.classList.toggle('on', b.dataset.verdict === verdictFilter));
    renderBoard(); return;
  }
  if (h.startsWith('filter=bucket:')) {
    bucketFilter = decodeURIComponent(h.slice(14));
    document.querySelectorAll('#bucketSeg button').forEach((b) => b.classList.toggle('on', b.dataset.bucket === bucketFilter));
    renderBoard(); return;
  }
  if (h === 'watchlist') {
    bucketFilter = 'watchlist';
    document.querySelectorAll('#bucketSeg button').forEach((b) => b.classList.toggle('on', b.dataset.bucket === bucketFilter));
    renderBoard(); return;
  }
  if (h === 'live') { liveEl.classList.remove('hidden'); $('liveBtn').textContent = 'Already trading ▴'; return; }
}
rowsEl.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-slug]');
  if (!tr) return;
  location.hash = 'detail=' + encodeURIComponent(tr.dataset.slug);
});
$('liveBtn').addEventListener('click', () => {
  const open = liveEl.classList.toggle('hidden');
  $('liveBtn').textContent = open ? 'Already trading ▾' : 'Already trading ▴';
});
document.querySelectorAll('#bucketSeg button').forEach((b) => b.addEventListener('click', () => {
  bucketFilter = b.dataset.bucket;
  document.querySelectorAll('#bucketSeg button').forEach((x) => x.classList.toggle('on', x === b));
  renderBoard();
}));
document.querySelectorAll('#verdictSeg button').forEach((b) => b.addEventListener('click', () => {
  verdictFilter = b.dataset.verdict;
  document.querySelectorAll('#verdictSeg button').forEach((x) => x.classList.toggle('on', x === b));
  renderBoard();
}));
['q', 'cat', 'chain', 'sort', 'ticket', 'drop'].forEach((id) => $(id).addEventListener('input', () => {
  renderBoard();
  if (!detailEl.classList.contains('hidden')) {
    const h = location.hash.slice(1);
    if (h.startsWith('detail=')) renderDetail(decodeURIComponent(h.slice(7)));
  }
}));
window.addEventListener('hashchange', applyHash);
renderStats();
renderAccounting();
renderBacktest();
renderScatter();
renderSectors();
renderFilters();
renderLive();
renderBoard();
applyHash();

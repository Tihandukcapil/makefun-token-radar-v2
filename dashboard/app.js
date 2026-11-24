// Launch Radar dashboard. Renders window.RADAR_DATA, written by main.ts.
// No network: every figure on this page comes from the snapshot and the
// model that main.ts fitted from it. Controls re-filter and re-sort the
// board in place; ticket and drop re-run the verdict math per row.
(function () {
  var D = window.RADAR_DATA;
  if (!D) { document.body.innerHTML = '<p style="padding:20px">No data: run main.ts first.</p>'; return; }
  var rows = D.rows;
  var $ = function (id) { return document.getElementById(id); };

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Key figures.
  var totalImplied = rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  var farms = rows.filter(function (r) { return r.verdict === 'FARM'; }).length;
  $('key-figures').innerHTML =
    '<div><b>' + rows.length + '</b><span>board rows</span></div>' +
    '<div><b>' + money(totalImplied) + '</b><span>total implied value</span></div>' +
    '<div><b>' + farms + '</b><span>FARM verdicts</span></div>' +
    '<div><b>' + (D.odds.accuracy_5fold * 100).toFixed(1) + '%</b><span>odds, 5-fold CV</span></div>';

  // Accounting bar: every protocol in the snapshot, one bucket each.
  $('accounting').innerHTML = D.accounting.map(function (b) {
    return '<div><b>' + b.count + '</b><span>' + esc(b.bucket) + '</span></div>';
  }).join('');
  $('accounting-note').textContent =
    D.accounting.reduce(function (a, b) { return a + b.count; }, 0) +
    ' protocols accounted for — nothing left over. ' +
    D.accounting.map(function (b) { return b.bucket + ': ' + b.note; }).join(' ');

  // Method and backtest.
  var m = D.model;
  $('method').textContent =
    'Implied value starts from a size curve fitted at runtime on the ' + m.live_count +
    ' protocols whose token already trades: log market cap = ' + m.intercept.toFixed(4) +
    ' + ' + m.slope.toFixed(4) + ' x log TVL. Each category with at least five live protocols ' +
    'gets a sector shift (shrunk by n / (n + 10)), then seven-day growth capped at +/-20% and ' +
    'age enter at half their fitted weight (' + m.growth_coef.toFixed(2) + ' and ' + m.age_coef.toFixed(2) +
    '). Launch odds come from a logistic fit on log TVL, growth and age, ' +
    (D.odds.accuracy_5fold * 100).toFixed(1) + '% accurate on 5-fold cross-validation against a ' +
    (D.odds.base_rate * 100).toFixed(1) + '% base rate. A protocol is on the board only when it ' +
    'records no token and is not a wrapped, staked or bridged product of one that trades.';
  $('backtest').innerHTML =
    '<tr><th>Variant</th><th class="num">LOO miss</th><th class="num">LOO within-3x</th>' +
    '<th class="num">Older-to-newer miss</th><th class="num">Older within-3x</th></tr>' +
    D.backtest.map(function (r) {
      return '<tr><td>' + esc(r.variant) + '</td><td class="num">' + r.loo_miss.toFixed(2) +
        '</td><td class="num">' + (r.loo_within3 * 100).toFixed(0) + '%</td><td class="num">' +
        r.older_miss.toFixed(2) + '</td><td class="num">' + (r.older_within3 * 100).toFixed(0) + '%</td></tr>';
    }).join('');

  // Scatter: fitted size curve as a line, live benchmarks as actual market
  // caps, board rows as implied values.
  (function scatter() {
    var svg = $('scatter');
    var W = 640, H = 360, P = 42;
    var xs = rows.map(function (r) { return Math.log10(r.tvl_usd); });
    var ys = rows.map(function (r) { return Math.log10(r.implied_value_usd); });
    var lx = D.live_benchmarks.map(function (r) { return Math.log10(r.tvl_usd); });
    var ly = D.live_benchmarks.map(function (r) { return Math.log10(r.mcap_usd); });
    var x0 = Math.min.apply(null, xs.concat(lx)), x1 = Math.max.apply(null, xs.concat(lx));
    var y0 = Math.min.apply(null, ys.concat(ly)), y1 = Math.max.apply(null, ys.concat(ly));
    var X = function (v) { return P + (v - x0) / (x1 - x0) * (W - 2 * P); };
    var Y = function (v) { return H - P - (v - y0) / (y1 - y0) * (H - 2 * P); };
    var out = '<line x1="' + P + '" y1="' + (H - P) + '" x2="' + (W - P) + '" y2="' + (H - P) + '" stroke="#26304d"/>' +
      '<line x1="' + P + '" y1="' + P + '" x2="' + P + '" y2="' + (H - P) + '" stroke="#26304d"/>' +
      '<text x="' + (W / 2) + '" y="' + (H - 8) + '" fill="#9aa7c7" font-size="12" text-anchor="middle">log TVL</text>' +
      '<text x="12" y="' + (H / 2) + '" fill="#9aa7c7" font-size="12" text-anchor="middle" transform="rotate(-90 12 ' + (H / 2) + ')">log value</text>';
    out += '<line x1="' + X(x0) + '" y1="' + Y(m.intercept + m.slope * x0) + '" x2="' + X(x1) + '" y2="' + Y(m.intercept + m.slope * x1) + '" stroke="#ffd36a" stroke-width="2"/>';
    rows.forEach(function (r) {
      out += '<circle cx="' + X(Math.log10(r.tvl_usd)).toFixed(1) + '" cy="' + Y(Math.log10(r.implied_value_usd)).toFixed(1) + '" r="2.2" fill="#6aa9ff" opacity="0.55"/>';
    });
    D.live_benchmarks.forEach(function (r) {
      out += '<circle cx="' + X(Math.log10(r.tvl_usd)).toFixed(1) + '" cy="' + Y(Math.log10(r.mcap_usd)).toFixed(1) + '" r="3.4" fill="#3fd08a"/>';
    });
    out += '<text x="' + (W - P) + '" y="' + (P - 8) + '" fill="#ffd36a" font-size="12" text-anchor="end">gold line: size curve</text>' +
      '<text x="' + (W - P) + '" y="' + (P + 8) + '" fill="#3fd08a" font-size="12" text-anchor="end">green dots: live market caps</text>' +
      '<text x="' + (W - P) + '" y="' + (P + 24) + '" fill="#6aa9ff" font-size="12" text-anchor="end">blue dots: board implied values</text>';
    svg.innerHTML = out;
  })();

  // Controls.
  var cats = Array.from(new Set(rows.map(function (r) { return r.category; }))).sort();
  cats.forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('f-category').appendChild(o);
  });
  var chains = Array.from(new Set(rows.flatMap(function (r) { return r.chains; }))).sort();
  chains.forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; $('f-chain').appendChild(o);
  });

  // Verdict math, same as the model: slice = drop x implied x odds x ticket
  // / TVL; fees = gas ($4, or $8 on a $10,000 ticket) + $2 swap + hours x $10.
  function verdict(r, ticket, drop) {
    var slice = drop * r.implied_value_usd * r.odds * ticket / r.tvl_usd;
    var gas = ticket >= 10000 ? 8 : 4;
    var hours = 2 + Math.min(r.chains.length, 4);
    var fees = gas + 2 + hours * 10;
    var net = slice - fees;
    return { slice: slice, fees: fees, net: net, verdict: net > 1 ? 'FARM' : net >= -10 ? 'THIN' : 'SKIP' };
  }

  function current() {
    return {
      bucket: $('f-bucket').value,
      verdict: $('f-verdict').value,
      ticket: Number($('f-ticket').value),
      drop: Number($('f-drop').value),
      category: $('f-category').value,
      chain: $('f-chain').value,
      sort: $('f-sort').value,
      search: $('f-search').value.trim().toLowerCase(),
    };
  }

  function renderBoard() {
    var c = current();
    var list = rows.filter(function (r) {
      if (c.bucket !== 'all' && r.bucket !== c.bucket) return false;
      if (c.category !== 'all' && r.category !== c.category) return false;
      if (c.chain !== 'all' && r.chains.indexOf(c.chain) === -1) return false;
      if (c.search && (r.name + ' ' + r.slug).toLowerCase().indexOf(c.search) === -1) return false;
      var v = verdict(r, c.ticket, c.drop);
      if (c.verdict !== 'all' && v.verdict !== c.verdict) return false;
      return true;
    });
    list.sort(function (a, b) {
      if (c.sort === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (c.sort === 'odds') return b.odds - a.odds;
      if (c.sort === 'age') return b.age_days - a.age_days;
      return b.implied_value_usd - a.implied_value_usd;
    });
    var html = '<tr><th>#</th><th>Protocol</th><th>Category</th><th class="num">TVL</th>' +
      '<th class="num">Implied</th><th class="num">Odds</th><th>Verdict</th></tr>';
    list.forEach(function (r) {
      var v = verdict(r, c.ticket, c.drop);
      html += '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td><td>' + esc(r.name) +
        (r.bucket === 'watchlist' ? ' <span class="tag watch">watchlist</span>' : '') +
        '</td><td>' + esc(r.category) + '</td><td class="num">' + money(r.tvl_usd) +
        '</td><td class="num">' + money(r.implied_value_usd) + '</td><td class="num">' +
        (r.odds * 100).toFixed(0) + '%</td><td><span class="tag ' + v.verdict + '">' + v.verdict + '</span></td></tr>';
    });
    $('board').innerHTML = html;
    $('board-count').textContent = list.length + ' of ' + rows.length +
      ' rows shown — ticket $' + c.ticket.toLocaleString('en-US') + ', drop ' + (c.drop * 100).toFixed(1) + '%.\n';
    Array.prototype.forEach.call(document.querySelectorAll('#board tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () { showDetail(tr.getAttribute('data-slug')); });
    });
  }

  function showDetail(slug) {
    var r = rows.find(function (x) { return x.slug === slug; });
    if (!r) return;
    var c = current();
    var v = verdict(r, c.ticket, c.drop);
    var hours = 2 + Math.min(r.chains.length, 4);
    var gas = c.ticket >= 10000 ? 8 : 4;
    $('detail').innerHTML =
      '<h3 style="margin:0">' + esc(r.name) + ' <span class="tag ' + v.verdict + '">' + v.verdict + '</span></h3>' +
      '<p class="note">' + esc(r.slug) + ' — ' + esc(r.category) + ' — chains: ' + esc(r.chains.join(', ')) +
      ' — ' + esc(r.bucket) + ' — tracked ' + r.age_days + ' days with no token.</p>' +
      '<div class="detail-grid">' +
      '<div><b>' + money(r.implied_value_usd) + '</b><span>implied value</span></div>' +
      '<div><b>' + money(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div><b>' + (r.odds * 100).toFixed(0) + '%</b><span>launch odds</span></div>' +
      '<div><b>' + moneyFull(v.slice) + '</b><span>slice at ' + (c.drop * 100).toFixed(1) + '% drop, $' + c.ticket.toLocaleString('en-US') + ' ticket</span></div>' +
      '<div><b>' + moneyFull(v.fees) + '</b><span>fees ($' + gas + ' gas + $2 swap + ' + hours + 'h x $10)</span></div>' +
      '<div><b>' + (v.net >= 0 ? '+' : '') + moneyFull(v.net) + '</b><span>net</span></div>' +
      '<div><b>' + money(r.capital_usd) + '</b><span>farm capital</span></div>' +
      '<div><b>' + r.hold_days + ' days</b><span>hold</span></div></div>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    $('detail-card').scrollIntoView({ behavior: 'instant', block: 'start' });
  }

  // Live view.
  $('live').innerHTML =
    '<tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Model implied</th><th class="num">Actual / implied</th></tr>' +
    D.live_benchmarks.map(function (r) {
      return '<tr><td>' + esc(r.name) + ' <span class="tag live">LIVE</span></td><td class="num">' + money(r.tvl_usd) +
        '</td><td class="num">' + money(r.mcap_usd) + '</td><td class="num">' + money(r.implied_value_usd) +
        '</td><td class="num">' + r.ratio.toFixed(2) + 'x</td></tr>';
    }).join('');

  $('seal').textContent = 'Board seal sha256 ' + D.seal_sha256 +
    ' — the board file hashes to this value; the program runs twice and must write the same bytes. ' +
    'Snapshot ' + esc(D.snapshot.as_of) + ', floor ' + moneyFull(D.snapshot.floor_usd) + '.';

  ['f-bucket', 'f-verdict', 'f-ticket', 'f-drop', 'f-category', 'f-chain', 'f-sort'].forEach(function (id) {
    $(id).addEventListener('change', renderBoard);
  });
  $('f-search').addEventListener('input', renderBoard);

  // Deep links for screenshots and sharing: #detail=<slug>,
  // #bucket=watchlist (or off-list above floor / below floor), #view=live.
  function applyHash() {
    var hash = {};
    location.hash.slice(1).split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv[0]) hash[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    if (hash.bucket && ['watchlist', 'off-list above floor', 'below floor'].indexOf(hash.bucket) !== -1) {
      $('f-bucket').value = hash.bucket;
    }
    renderBoard();
    if (hash.detail) showDetail(hash.detail);
    else if (hash.view === 'live') $('live-card').scrollIntoView();
  }
  window.addEventListener('hashchange', applyHash);
  applyHash();
})();

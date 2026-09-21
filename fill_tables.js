/**
 * fill_tables.js
 *
 * n8n Code node for the Bolt Plus test-scorecard automation.
 * Same job as experiment-results-automation/fill_tables.js:
 * take a list of { headers, rows } and write them into the tables of
 * a Google Doc via documents.batchUpdate.
 *
 * Expected n8n graph:
 *   Databricks queries  →  Build Bolt Report  →  Get Doc  →  this node  →  Docs batchUpdate
 *
 *   $('Build Bolt Report').item.json.tables  = [{ headers, rows }, ...]
 *   $input.first().json                      = Google Docs document resource
 *
 * If Build Bolt Report is missing, this node will also accept scorecard
 * query results directly (the objects the dynamic notebook returns) and
 * build the tables itself. Table order must match the Doc template.
 *
 * Returns: [{ json: { requests } }]
 */

const FONT = 'Inter';
const FONT_SIZE = 8.5;
const HEADER_RGB = { red: 0.08, green: 0.28, blue: 0.2 };
const BODY_RGB = { red: 0.09, green: 0.17, blue: 0.14 };

function cellText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return String(value);
}

function fmtInt(v) {
  if (v == null || v === '') return '';
  return Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 });
}

function fmtDec(v, d) {
  if (v == null || v === '') return '';
  return Number(v).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtPct(v, d) {
  if (v == null || v === '') return '';
  return fmtDec(v, d) + '%';
}

function fmtEur(v, d) {
  if (v == null || v === '') return '';
  const n = Number(v);
  const abs = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
  return n < 0 ? '-€' + abs : '€' + abs;
}

function fmtSignedPct(v, d) {
  if (v == null || v === '') return '';
  const n = Number(v);
  return (n > 0 ? '+' : '') + fmtDec(n, d) + '%';
}

function table(headers, rows) {
  return { headers, rows: rows.map((row) => headers.map((_, i) => cellText(row[i]))) };
}

function pick(rows, extra) {
  return (rows || []).filter(extra || (() => true));
}

/**
 * Turn the dynamic notebook / Databricks outputs into Doc tables.
 * Order is fixed — keep the Google Doc template in the same order.
 */
function buildTablesFromScorecard(data) {
  const resolution = pick(data.resolution || data.test_resolution);
  const takeRate = pick(data.take_rate);
  const pnl = pick(data.pnl);
  const lift = pick(data.lift);
  const survival = pick(data.survival || data.sub_survival);
  const behavioural = pick(data.behavioural || data.behavioural_retention);
  const who = pick(data.who || data.who_subscribed);
  const period = pick(data.period || data.sub_by_period);
  const price = pick(data.price || data.standard_price);
  const retention = pick(data.retention || data.retention_benchmark);

  const tables = [];

  tables.push(table(
    ['Source', 'Test ID', 'Market', 'Variant', 'Group ID', 'Arm label', 'Users', 'Start', 'End'],
    resolution.map((r) => [
      r.source, r.test_id, r.market, r.variant, r.group_id, r.arm_label,
      fmtInt(r.users), r.test_start, r.test_end,
    ]),
  ));

  tables.push(table(
    ['Market', 'Treatment take-rate', 'T subscribers / cohort', 'Control take-rate', 'C subscribers / cohort'],
    takeRate
      .filter((r, i, arr) => arr.findIndex((x) => x.market === r.market) === i)
      .map((marketRow) => {
        const t = takeRate.find((r) => r.market === marketRow.market && r.variant === 'treatment') || {};
        const c = takeRate.find((r) => r.market === marketRow.market && r.variant === 'control') || {};
        return [
          marketRow.market,
          fmtPct(t.take_rate_pct, 2),
          `${fmtInt(t.subscribers)} / ${fmtInt(t.cohort_users)}`,
          fmtPct(c.take_rate_pct, 2),
          `${fmtInt(c.subscribers)} / ${fmtInt(c.cohort_users)}`,
        ];
      }),
  ));

  tables.push(table(
    ['Market', 'GMV/user T', 'GMV/user C', 'GMV lift', 'Orders/user T', 'Orders/user C', 'Orders lift', 'Net/user T', 'Net/user C', 'Net lift'],
    lift.map((r) => [
      r.market,
      fmtEur(r.gmv_per_user_t, 2), fmtEur(r.gmv_per_user_c, 2), fmtSignedPct(r.gmv_lift_pct, 1),
      fmtDec(r.orders_per_user_t, 3), fmtDec(r.orders_per_user_c, 3), fmtSignedPct(r.orders_lift_pct, 1),
      fmtEur(r.net_income_per_user_t, 2), fmtEur(r.net_income_per_user_c, 2), fmtSignedPct(r.net_income_lift_pct, 1),
    ]),
  ));

  tables.push(table(
    ['Market', 'Incr. GMV (treated)', 'Incr. orders (treated)', 'Incr. net income (treated)', 'Incr. Bolt cost (treated)', 'UC on GMV'],
    lift.map((r) => [
      r.market,
      fmtEur(r.incr_gmv_treated, 0),
      fmtDec(r.incr_orders_treated, 0),
      fmtEur(r.incr_net_income_treated, 0),
      fmtEur(r.incr_bolt_cost_treated, 0),
      r.uc_ratio_gmv_on_bolt_spend == null ? 'cost-negative' : fmtDec(r.uc_ratio_gmv_on_bolt_spend, 2) + '×',
    ]),
  ));

  tables.push(table(
    ['Market', 'Arm', 'Cohort', 'Activated', 'Orders', 'GMV', 'NMV', 'Net income', 'Discount', 'Bolt campaign cost'],
    pnl.map((r) => [
      r.market, r.variant, fmtInt(r.cohort_users),
      `${fmtInt(r.activated_users)} (${fmtPct(r.activation_pct, 2)})`,
      fmtInt(r.orders), fmtEur(r.gmv, 0), fmtEur(r.nmv, 0),
      fmtEur(r.net_income, 0), fmtEur(r.discount, 0), fmtEur(r.bolt_campaign_cost, 0),
    ]),
  ));

  tables.push(table(
    ['Market', 'Arm', 'Bolt · delivery', 'Bolt · menu', 'Provider · delivery', 'Provider · menu', 'Bolt funded', 'Provider funded'],
    pnl.map((r) => [
      r.market, r.variant,
      fmtEur(r.bolt_delivery_cost, 0), fmtEur(r.bolt_menu_cost, 0),
      fmtEur(r.provider_delivery_cost, 0), fmtEur(r.provider_menu_cost, 0),
      fmtEur(r.bolt_campaign_cost, 0), fmtEur(r.provider_campaign_cost, 0),
    ]),
  ));

  tables.push(table(
    ['Market', 'Arm', 'Subscribers', 'Still active', 'Active %'],
    survival.map((r) => [r.market, r.variant, fmtInt(r.subscribers), fmtInt(r.still_active), fmtPct(r.active_pct, 2)]),
  ));

  const weeks = [...new Set(behavioural.map((r) => r.week_no))].sort((a, b) => a - b);
  const behavKeys = [...new Set(behavioural.map((r) => `${r.market}|${r.variant}`))];
  tables.push(table(
    ['Market / arm', ...weeks.map((w) => 'Week ' + w)],
    behavKeys.map((key) => {
      const [market, variant] = key.split('|');
      return [
        `${market} · ${variant}`,
        ...weeks.map((w) => {
          const hit = behavioural.find((x) => x.market === market && x.variant === variant && x.week_no === w);
          return hit ? fmtInt(hit.active_users) : '';
        }),
      ];
    }),
  ));

  tables.push(table(
    ['Market', 'Arm', 'Prior cohort', 'Prior freq', 'Subscribers'],
    who.map((r) => [r.market, r.variant, r.prior_cohort_name || r.prior_stage, r.prior_freq_bucket, fmtInt(r.subscribers)]),
  ));

  tables.push(table(
    ['Market', 'Arm', 'Period', 'Subscribers', 'Started on trial', 'Avg price (local)'],
    period.map((r) => [
      r.market, r.variant, r.subscription_period_type,
      fmtInt(r.subscribers), fmtInt(r.trial_subs), fmtDec(r.avg_price_local, 2),
    ]),
  ));

  tables.push(table(
    ['Market', 'Median monthly price (local)', 'Sample size'],
    price.map((r) => [r.market, fmtDec(r.median_price_local, 2), fmtInt(r.n)]),
  ));

  tables.push(table(
    ['Market', 'Subscribers', 'Avg months active', '≥1 month', '≥3 months', '≥6 months', '≥12 months'],
    retention.map((r) => [
      r.market, fmtInt(r.subs), fmtDec(r.avg_months_active, 2),
      fmtPct(r.pct_ge_1mo, 1), fmtPct(r.pct_ge_3mo, 1),
      fmtPct(r.pct_ge_6mo, 1), fmtPct(r.pct_ge_12mo, 1),
    ]),
  ));

  return tables.filter((t) => t.headers.length && (t.rows.length || t.headers.length));
}

function getSpec() {
  try {
    const fromBuilder = $('Build Bolt Report').item.json;
    if (fromBuilder && fromBuilder.tables && fromBuilder.tables.length) {
      return fromBuilder.tables;
    }
  } catch (err) {
    // Node is not in this workflow — fall through to scorecard-shaped input.
  }

  const incoming = $input.all().map((item) => item.json);
  const first = incoming[0] || {};

  if (first.tables && Array.isArray(first.tables)) return first.tables;

  const looksLikeScorecard = [
    'take_rate', 'pnl', 'lift', 'resolution', 'test_resolution',
    'survival', 'sub_survival', 'who_subscribed', 'who',
  ].some((key) => Array.isArray(first[key]));
  if (looksLikeScorecard) return buildTablesFromScorecard(first);

  throw new Error(
    'No table spec found. Either emit { tables: [{ headers, rows }] } from a "Build Bolt Report" node, ' +
    'or pass the scorecard query results (take_rate, pnl, lift, …) into this node.',
  );
}

function tablesFromDoc(doc) {
  const found = [];
  for (const element of (doc.body && doc.body.content) || []) {
    if (element.table) found.push(element.table);
  }
  return found;
}

const doc = $input.first().json || {};
const spec = getSpec();
if (!spec.length) return [{ json: { requests: [] } }];

const docTables = tablesFromDoc(doc);
if (docTables.length !== spec.length) {
  throw new Error(
    `Expected ${spec.length} tables in the Google Doc template but found ${docTables.length}. ` +
    'The template table count must match the table list this node writes.',
  );
}

const cells = [];
docTables.forEach((tableEl, tableIdx) => {
  const values = [spec[tableIdx].headers, ...(spec[tableIdx].rows || [])];
  const docRows = tableEl.tableRows || [];
  if (docRows.length < values.length) {
    throw new Error(
      `Table ${tableIdx + 1} has ${docRows.length} rows in the Doc but the spec has ${values.length}. ` +
      'Add blank rows to the template (header + one row per data row).',
    );
  }
  docRows.forEach((row, rowIdx) => {
    (row.tableCells || []).forEach((cell, colIdx) => {
      const value = cellText((values[rowIdx] || [])[colIdx]);
      const start = cell.content && cell.content[0] ? cell.content[0].startIndex : null;
      if (start == null || !value) return;
      cells.push({ index: start, text: value, isHeader: rowIdx === 0 });
    });
  });
});

cells.sort((a, b) => a.index - b.index);

let shift = 0;
for (const cell of cells) {
  cell.finalIndex = cell.index + shift;
  shift += cell.text.length;
}

const requests = [];
for (const cell of [...cells].reverse()) {
  requests.push({ insertText: { location: { index: cell.index }, text: cell.text } });
}
for (const cell of cells) {
  requests.push({
    updateTextStyle: {
      range: { startIndex: cell.finalIndex, endIndex: cell.finalIndex + cell.text.length },
      textStyle: {
        weightedFontFamily: { fontFamily: FONT },
        fontSize: { magnitude: FONT_SIZE, unit: 'PT' },
        bold: cell.isHeader,
        foregroundColor: { color: { rgbColor: cell.isHeader ? HEADER_RGB : BODY_RGB } },
      },
      fields: 'weightedFontFamily,fontSize,bold,foregroundColor',
    },
  });
}

return [{ json: { requests } }];

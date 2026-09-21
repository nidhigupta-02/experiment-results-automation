/**
 * build_tables.js
 *
 * n8n Code node — "Build Bolt Report".
 * Turns Databricks / notebook query results into { tables: [{ headers, rows }] }
 * in the order the Google Doc template expects.
 *
 * Drop this upstream of fill_tables.js. fill_tables.js reads:
 *   $('Build Bolt Report').item.json.tables
 *
 * Incoming item.json keys (any subset is fine; missing arrays become empty tables):
 *   resolution / test_resolution
 *   take_rate
 *   lift
 *   pnl
 *   survival / sub_survival
 *   behavioural / behavioural_retention
 *   who / who_subscribed
 *   period / sub_by_period
 *   price / standard_price
 *   retention / retention_benchmark
 */

function cellText(value) {
  if (value == null || value === '') return '';
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

const data = $input.first().json || {};
const resolution = data.resolution || data.test_resolution || [];
const takeRate = data.take_rate || [];
const pnl = data.pnl || [];
const lift = data.lift || [];
const survival = data.survival || data.sub_survival || [];
const behavioural = data.behavioural || data.behavioural_retention || [];
const who = data.who || data.who_subscribed || [];
const period = data.period || data.sub_by_period || [];
const price = data.price || data.standard_price || [];
const retention = data.retention || data.retention_benchmark || [];

const marketsInTake = [...new Set(takeRate.map((r) => r.market))];
const weeks = [...new Set(behavioural.map((r) => r.week_no))].sort((a, b) => a - b);
const behavKeys = [...new Set(behavioural.map((r) => `${r.market}|${r.variant}`))];

const tables = [
  table(
    ['Source', 'Test ID', 'Market', 'Variant', 'Group ID', 'Arm label', 'Users', 'Start', 'End'],
    resolution.map((r) => [
      r.source, r.test_id, r.market, r.variant, r.group_id, r.arm_label,
      fmtInt(r.users), r.test_start, r.test_end,
    ]),
  ),
  table(
    ['Market', 'Treatment take-rate', 'T subscribers / cohort', 'Control take-rate', 'C subscribers / cohort'],
    marketsInTake.map((market) => {
      const t = takeRate.find((r) => r.market === market && r.variant === 'treatment') || {};
      const c = takeRate.find((r) => r.market === market && r.variant === 'control') || {};
      return [
        market,
        fmtPct(t.take_rate_pct, 2),
        `${fmtInt(t.subscribers)} / ${fmtInt(t.cohort_users)}`,
        fmtPct(c.take_rate_pct, 2),
        `${fmtInt(c.subscribers)} / ${fmtInt(c.cohort_users)}`,
      ];
    }),
  ),
  table(
    ['Market', 'GMV/user T', 'GMV/user C', 'GMV lift', 'Orders/user T', 'Orders/user C', 'Orders lift', 'Net/user T', 'Net/user C', 'Net lift'],
    lift.map((r) => [
      r.market,
      fmtEur(r.gmv_per_user_t, 2), fmtEur(r.gmv_per_user_c, 2), fmtSignedPct(r.gmv_lift_pct, 1),
      fmtDec(r.orders_per_user_t, 3), fmtDec(r.orders_per_user_c, 3), fmtSignedPct(r.orders_lift_pct, 1),
      fmtEur(r.net_income_per_user_t, 2), fmtEur(r.net_income_per_user_c, 2), fmtSignedPct(r.net_income_lift_pct, 1),
    ]),
  ),
  table(
    ['Market', 'Incr. GMV (treated)', 'Incr. orders (treated)', 'Incr. net income (treated)', 'Incr. Bolt cost (treated)', 'UC on GMV'],
    lift.map((r) => [
      r.market,
      fmtEur(r.incr_gmv_treated, 0),
      fmtDec(r.incr_orders_treated, 0),
      fmtEur(r.incr_net_income_treated, 0),
      fmtEur(r.incr_bolt_cost_treated, 0),
      r.uc_ratio_gmv_on_bolt_spend == null ? 'cost-negative' : fmtDec(r.uc_ratio_gmv_on_bolt_spend, 2) + '×',
    ]),
  ),
  table(
    ['Market', 'Arm', 'Cohort', 'Activated', 'Orders', 'GMV', 'NMV', 'Net income', 'Discount', 'Bolt campaign cost'],
    pnl.map((r) => [
      r.market, r.variant, fmtInt(r.cohort_users),
      `${fmtInt(r.activated_users)} (${fmtPct(r.activation_pct, 2)})`,
      fmtInt(r.orders), fmtEur(r.gmv, 0), fmtEur(r.nmv, 0),
      fmtEur(r.net_income, 0), fmtEur(r.discount, 0), fmtEur(r.bolt_campaign_cost, 0),
    ]),
  ),
  table(
    ['Market', 'Arm', 'Bolt · delivery', 'Bolt · menu', 'Provider · delivery', 'Provider · menu', 'Bolt funded', 'Provider funded'],
    pnl.map((r) => [
      r.market, r.variant,
      fmtEur(r.bolt_delivery_cost, 0), fmtEur(r.bolt_menu_cost, 0),
      fmtEur(r.provider_delivery_cost, 0), fmtEur(r.provider_menu_cost, 0),
      fmtEur(r.bolt_campaign_cost, 0), fmtEur(r.provider_campaign_cost, 0),
    ]),
  ),
  table(
    ['Market', 'Arm', 'Subscribers', 'Still active', 'Active %'],
    survival.map((r) => [r.market, r.variant, fmtInt(r.subscribers), fmtInt(r.still_active), fmtPct(r.active_pct, 2)]),
  ),
  table(
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
  ),
  table(
    ['Market', 'Arm', 'Prior cohort', 'Prior freq', 'Subscribers'],
    who.map((r) => [r.market, r.variant, r.prior_cohort_name || r.prior_stage, r.prior_freq_bucket, fmtInt(r.subscribers)]),
  ),
  table(
    ['Market', 'Arm', 'Period', 'Subscribers', 'Started on trial', 'Avg price (local)'],
    period.map((r) => [
      r.market, r.variant, r.subscription_period_type,
      fmtInt(r.subscribers), fmtInt(r.trial_subs), fmtDec(r.avg_price_local, 2),
    ]),
  ),
  table(
    ['Market', 'Median monthly price (local)', 'Sample size'],
    price.map((r) => [r.market, fmtDec(r.median_price_local, 2), fmtInt(r.n)]),
  ),
  table(
    ['Market', 'Subscribers', 'Avg months active', '≥1 month', '≥3 months', '≥6 months', '≥12 months'],
    retention.map((r) => [
      r.market, fmtInt(r.subs), fmtDec(r.avg_months_active, 2),
      fmtPct(r.pct_ge_1mo, 1), fmtPct(r.pct_ge_3mo, 1),
      fmtPct(r.pct_ge_6mo, 1), fmtPct(r.pct_ge_12mo, 1),
    ]),
  ),
];

return [{ json: { tables } }];

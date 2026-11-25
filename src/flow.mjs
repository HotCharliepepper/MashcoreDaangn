import { engineVersion, periodBounds } from './config.mjs';

export function last(events, type, predicate = () => true) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === type && predicate(events[i])) return events[i];
  }
  return null;
}
export function total(a, b) {
  return a == null || b == null ? null : a + b;
}
export function byDay(events, day) {
  return events.filter(event => event.day === day);
}
export function daily(events, day) {
  const rows = byDay(events, day);
  const close = last(rows, 'close');
  const c = close?.data;
  const runs = rows.filter(e => e.type === 'run');
  const reports = runs.map(run => last(rows, 'report', e => e.data.runId === run.id));
  const spends = reports.map(e => e?.data.spend);
  const fullDay = reports.length > 0 && reports.every((e,i)=>e && e.data.from===day+'T00:00' && e.data.to===nextMidnight(day) &&
    rows.find(p=>p.id===runs[i].data.planId)?.data.channel===e.data.channel);
  const separateChannels = new Set(reports.map(e=>e?.data.channel)).size === reports.length;
  return { day, rows, close, runs, reports, latestPlan: last(rows, 'plan'),
    teams: total(c?.lunchTeams, c?.dinnerTeams), revenue: total(c?.lunchRevenue, c?.dinnerRevenue),
    minutes: c?.minutes ?? null,
    spend: fullDay && separateChannels && spends.every(n => n != null) ? spends.reduce((a, b) => a + b, 0) : null };
}
export function rangeReport(events, anchor, period) {
  const [start, end] = periodBounds(anchor, period);
  const days = [...new Set(events.map(e => e.day).filter(d => d >= start && d <= end))].sort().reverse();
  const rows = days.map(day => daily(events, day));
  const totals = {};
  for (const field of ['teams', 'revenue', 'spend', 'minutes']) {
    const known = rows.map(row => row[field]).filter(n => n !== null);
    totals[field] = { value: known.length ? known.reduce((a, b) => a + b, 0) : null, days: known.length };
  }
  return { start, end, rows, totals };
}

export const reasons = {
  run: '실제 광고 시간과 집행한 계획 버전을 먼저 기록하세요.',
  report: '선택한 집행 건의 광고 실적이 필요합니다.',
  channel: '집행 계획과 실적 원천의 채널이 다릅니다.',
  period: '일 마감과 비교하려면 운영일 하루 전체의 광고 집계가 필요합니다.',
  multiple: '하루에 여러 집행 건이 있어 방문·매출을 이 광고 하나에 귀속하기 어렵습니다.',
  baseline: '비교일의 점심·저녁 마감 기록이 필요합니다.',
  closing: '운영일의 점심·저녁 마감 기록이 필요합니다.',
  missing: '광고 수치, 방문 팀, 매출 또는 비용에 미측정 항목이 있습니다.',
  conditions: '두 날짜의 영업시간·행사·휴무 조건을 확인하세요.',
  exposure: '노출 0회로 광고 효과를 비교할 근거가 부족합니다.',
  unit: '팀당 매출과 양의 단위 기여액을 확인할 수 없습니다.',
  positive: '가정 기여액이 0원 이상입니다. 현장 상황과 함께 유지 여부를 검토하세요.',
  negative: '가정 기여액이 음수입니다. 시간·소재·예산의 수정을 검토하세요.',
};

// Keep R0.4's CPC, percentage CTR, incremental contribution and ceiling break-even.
// An unknown operand remains null. The reporting window is independent of the ad run.
export function evidence(events, day, selection) {
  const current = daily(events, day);
  const base = daily(events, selection.compareDay);
  const run = current.runs.find(r => r.id === selection.runId);
  const plan = run && current.rows.find(e => e.type === 'plan' && e.id === run.data.planId);
  const report = run && last(current.rows, 'report', e => e.data.runId === run.id);
  const r = report?.data, c = current.close?.data;
  const diff = current.teams != null && base.teams != null ? current.teams - base.teams : null;
  const unit = current.teams > 0 && current.revenue != null && c?.margin != null
    ? current.revenue / current.teams * c.margin / 100 : null;
  const metrics = {
    cpc: r?.clicks > 0 && r.spend != null ? r.spend / r.clicks : null,
    ctr: r?.impressions > 0 && r.clicks != null ? r.clicks / r.impressions * 100 : null,
    difference: diff, contribution: null, breakEven: null,
  };
  let reason;
  if (!run || !plan) reason = 'run';
  else if (!report) reason = 'report';
  else if (r.channel !== plan.data.channel) reason = 'channel';
  else if (r.from !== day + 'T00:00' || r.to !== nextMidnight(day)) reason = 'period';
  else if (current.runs.length !== 1) reason = 'multiple';
  else if (!base.close) reason = 'baseline';
  else if (!current.close) reason = 'closing';
  else if ([r.spend,r.impressions,r.clicks,current.teams,current.revenue,base.teams,base.revenue,c.margin,c.extraCost].some(x => x == null)) reason = 'missing';
  else if (!selection.comparable) reason = 'conditions';
  else if (r.impressions === 0) reason = 'exposure';
  else if (!(unit > 0)) reason = 'unit';
  else {
    metrics.contribution = diff * unit - r.spend - c.extraCost;
    metrics.breakEven = Math.ceil((r.spend + c.extraCost) / unit);
    reason = metrics.contribution >= 0 ? 'positive' : 'negative';
  }
  const suggested = reason === 'positive' ? 'keep' : reason === 'negative' ? 'revise' : 'hold';
  const snapshot = e => e ? { id:e.id, version:e.version, planRevision:e.snapshot?.planRevision ?? null, at:e.updatedAt, data:{...e.data} } : null;
  return { engineVersion, suggested, reason, description: reasons[reason], metrics, day,
    compareDay: selection.compareDay, comparable: selection.comparable,
    plan: snapshot(plan), run: snapshot(run), report: snapshot(report),
    close: snapshot(current.close), baseline: snapshot(base.close) };
}
export function nextMidnight(day) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10) + 'T00:00';
}

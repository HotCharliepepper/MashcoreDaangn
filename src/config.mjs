export const site = { name: '마장동 사천본점', pilot: 'majang-sacheon', demo: 'demo-majang' };
export const channels = { daangn: '당근', naver: '네이버', google: 'Google' };
export const roles = { owner: '대표', mashcore: 'Mashcore' };
export const choices = { keep: '유지 검토', revise: '수정 검토', hold: '판단 유보' };
export const types = { plan: '계획', run: '집행 기록', report: '광고 실적', close: '영업 마감', opinion: '의견', decision: '공동 판단', approval: '대표 검토' };
export const engineVersion = 'majang.flow/0.5.0';
export const closeFields = ['lunchTeams', 'lunchRevenue', 'dinnerTeams', 'dinnerRevenue', 'minutes', 'margin', 'extraCost'];

export function seoulDay(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export function shiftDay(day, offset) {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function periodBounds(day, period) {
  if (period === 'week') {
    const index = (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7;
    return [shiftDay(day, -index), shiftDay(day, 6 - index)];
  }
  if (period === 'month') {
    const start = day.slice(0, 7) + '-01';
    const end = new Date(start + 'T00:00:00Z');
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    return [start, end.toISOString().slice(0, 10)];
  }
  return [day, day];
}

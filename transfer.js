'use strict';
// Direction-specific fast-transfer positions. Never reuse a reverse-direction record.
(function (root) {
  function guide(arrival, departure, records = []) {
    if (!arrival || !departure || arrival.to !== departure.from || arrival.lineId === departure.lineId) return null;
    const station = arrival.to, arriveFrom = arrival.stations?.at(-2), departTo = departure.stations?.[1];
    const matches = records.filter(r => r && r.station === station && r.fromLine === arrival.lineId && r.toLine === departure.lineId && r.arriveFrom === arriveFrom && r.departTo === departTo);
    const r = matches.length === 1 ? matches[0] : null;
    const verified = arriveFrom && departTo && r && /^https:\/\//.test(r.source?.url || '') && r.source?.name && /^\d{4}-\d{2}-\d{2}$/.test(r.checkedAt || '') && Array.isArray(r.positions) && r.positions.length > 0 && r.positions.every(p => Number.isInteger(p.car) && p.car >= 1 && p.car <= 20 && Number.isInteger(p.door) && p.door >= 1 && p.door <= 6);
    return {
      station, fromLine: arrival.line, toLine: departure.line, arriveFrom, departTo,
      title: `${station}역 · ${arrival.line} → ${departure.line}`,
      direction: `${departTo}역 방면 승강장으로 이동`,
      position: verified ? r.positions.map(p => `${p.car}-${p.door}`).join(' / ') : null,
      explanation: verified ? `${arrival.line}에서 내릴 때 환승 통로에 가까운 차량·출입문입니다.` : '빠른 환승 차량·출입문 번호는 아직 확인되지 않았습니다. 역내 환승 표지판을 따라가세요.',
      source: verified ? r.source : null,
      checkedAt: verified ? r.checkedAt : null,
    };
  }
  const api = { guide };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BarotaTransfer = api;
})(this);

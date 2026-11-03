'use strict';
// 지하철 경로 계산 (브라우저·Node 공용). 데이터: data/subway.json (© OpenStreetMap contributors, ODbL)
(function (root) {
  const STOP_OVERHEAD_MIN = 0.7;          // 역마다 정차·감속 시간
  const DEFAULT_SPEED_KMH = 45;
  const LINE_SPEED_KMH = { 1: 55, arex: 70, 'gtx-a': 120, shinbundang: 70, gyeongui: 55, gyeongchun: 60, suin: 50, seohae: 60, gyeonggang: 60 };
  const TRANSFER_MIN = 7;                 // 환승 이동 + 평균 대기

  function distanceKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function createNetwork(data) {
    const stations = new Map(data.stations.map((s) => [s.name, s]));
    const lines = new Map(data.lines.map((l) => [l.id, l]));
    const adjacency = new Map();
    const link = (a, b, line) => {
      if (!adjacency.has(a)) adjacency.set(a, []);
      adjacency.get(a).push({ to: b, line });
    };
    for (const [a, b, line] of data.edges) { link(a, b, line); link(b, a, line); }
    const hopMinutes = (a, b, line) => STOP_OVERHEAD_MIN + distanceKm(stations.get(a), stations.get(b)) / (LINE_SPEED_KMH[line] || DEFAULT_SPEED_KMH) * 60;

    // 입력 이름을 역 이름으로: "서울역" → "서울", 공백 제거
    function resolve(input) {
      const raw = String(input || '').replace(/\s+/g, '');
      if (stations.has(raw)) return raw;
      const trimmed = raw.replace(/역$/, '');
      return stations.has(trimmed) ? trimmed : null;
    }

    // 상태 = (역, 타고 있는 노선). 환승 시 TRANSFER_MIN 가산.
    function findRoute(from, to) {
      if (!stations.has(from) || !stations.has(to) || from === to) return null;
      const key = (st, line) => st + '\u0000' + line;
      const dist = new Map([[key(from, ''), 0]]);
      const prev = new Map();
      const queue = [[0, from, '']];
      let goal = null;
      while (queue.length) {
        let bi = 0;
        for (let i = 1; i < queue.length; i++) if (queue[i][0] < queue[bi][0]) bi = i;
        const [d, st, line] = queue.splice(bi, 1)[0];
        const k = key(st, line);
        if (d > (dist.get(k) ?? Infinity)) continue;
        if (st === to) { goal = k; break; }
        for (const e of adjacency.get(st) || []) {
          const cost = hopMinutes(st, e.to, e.line) + (line && line !== e.line ? TRANSFER_MIN : 0);
          const nk = key(e.to, e.line);
          if (d + cost < (dist.get(nk) ?? Infinity)) {
            dist.set(nk, d + cost);
            prev.set(nk, k);
            queue.push([d + cost, e.to, e.line]);
          }
        }
      }
      if (!goal) return null;
      const path = [];
      for (let k = goal; k; k = prev.get(k)) {
        const [st, line] = k.split('\u0000');
        path.unshift({ st, line });
      }
      // 같은 노선 구간을 하나의 leg로 묶기
      const legs = [];
      for (let i = 1; i < path.length; i++) {
        const { st, line } = path[i];
        const last = legs[legs.length - 1];
        if (last && last.lineId === line) { last.stations.push(st); continue; }
        const info = lines.get(line) || {};
        legs.push({ lineId: line, line: info.name || line, apiId: info.apiId || null, colour: info.colour, stations: [path[i - 1].st, st] });
      }
      for (const leg of legs) {
        leg.from = leg.stations[0];
        leg.to = leg.stations[leg.stations.length - 1];
        leg.next = leg.stations[1];
        leg.stops = leg.stations.length - 1;
        leg.minutes = leg.stations.slice(1).reduce((sum, st, i) => sum + hopMinutes(leg.stations[i], st, leg.lineId), 0);
      }
      const minutes = legs.reduce((s, l) => s + l.minutes, 0) + TRANSFER_MIN * (legs.length - 1);
      return { from, to, legs, minutes: Math.round(minutes), transfers: legs.length - 1 };
    }

    return { stations, lines, resolve, findRoute, names: [...stations.keys()] };
  }

  const api = { createNetwork };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BarotaRoute = api;
})(this);

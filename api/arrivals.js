// Vercel Node.js serverless function. Keys are read only from environment variables.
// 서울시 실시간 도착정보 subwayId → 노선명
const LINE_NAMES = {
  1001: '1호선', 1002: '2호선', 1003: '3호선', 1004: '4호선', 1005: '5호선', 1006: '6호선', 1007: '7호선', 1008: '8호선', 1009: '9호선',
  1032: 'GTX-A', 1061: '중앙선', 1063: '경의중앙선', 1065: '공항철도', 1067: '경춘선', 1075: '수인분당선', 1077: '신분당선', 1081: '경강선',
  1092: '우이신설선', 1093: '서해선', 1094: '신림선',
};
const STATION_RE = /^[가-힣A-Za-z0-9·.()]{1,20}$/;
const cache = new Map();
const ttl = 15000;

async function cached(url) {
  const old = cache.get(url);
  if (old && Date.now() - old.at < ttl) return old.data;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw Error('상위 API HTTP ' + response.status);
    const data = await response.json();
    cache.set(url, { at: Date.now(), data });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// 방향 판별: trainLineNm "성수행 - 잠실방면"의 'OO방면'은 다음 정차역. 경로의 다음 역과 비교한다.
const cleanName = (x) => String(x || '').replace(/\(.*?\)/g, '').replace(/역$/, '').trim();
function headingOf(row) {
  const m = /-\s*(.+?)\s*방면/.exec(String(row.trainLineNm || ''));
  return m ? cleanName(m[1]) : '';
}

// recptnDt는 KST("YYYY-MM-DD HH:mm:ss"). 수신 후 경과 시간만큼 도착 예정 시간을 보정한다.
function receivedAgeSeconds(recptnDt, now) {
  const at = Date.parse(String(recptnDt || '').replace(' ', 'T') + '+09:00');
  if (!Number.isFinite(at)) return 0;
  return Math.min(Math.max(0, (now - at) / 1000), 180);
}

function secondsFromMessage(msg) {
  const m = /(?:(\d+)분)?\s*(?:(\d+)초)?\s*후/.exec(msg);
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] || 0) * 60 + Number(m[2] || 0);
}

// 남은 초가 없을 때 위치 정보로 대략 추정(역 간 약 2분).
function estimateSeconds(code, msg) {
  const n = /\[(\d+)\]번째 전역/.exec(msg);
  if (n) return Number(n[1]) * 120;
  if (code === 3) return 90;      // 전역 출발
  if (code === 4) return 75;      // 전역 진입
  if (code === 5) return 105;     // 전역 도착
  return null;
}

const ARRIVAL_CODES = { 0: '진입 중', 1: '도착', 2: '출발', 3: '전역 출발', 4: '전역 진입', 5: '전역 도착', 99: '운행 중' };

function parseSubway(data, station, lineId, next, now = Date.now()) {
  let rows = data.realtimeArrivalList || [];
  if (!Array.isArray(rows)) return { trains: [], warning: '' };
  let warning = '';
  if (lineId) rows = rows.filter((r) => String(r.subwayId) === lineId);
  if (next) {
    const want = cleanName(next);
    const matched = rows.filter((r) => headingOf(r) === want);
    // 방면 표기가 아예 없는 노선이면 방향 구분 없이 보여준다
    if (matched.length || rows.some((r) => headingOf(r))) rows = matched;
    else if (rows.length) warning = '이 노선은 방향 구분 정보가 없어 양방향을 함께 표시합니다';
  }
  const trains = rows
    .filter((r) => Number(r.arvlCd) !== 2) // 이미 이 역을 출발한 열차 제외
    .map((r) => {
      const message = String(r.arvlMsg2 || '도착정보 확인 필요');
      const code = Number(r.arvlCd);
      let seconds = Number(r.barvlDt);
      let estimated = false;
      if (!Number.isFinite(seconds) || seconds <= 0) seconds = secondsFromMessage(message);
      if (seconds == null) { seconds = estimateSeconds(code, message); estimated = seconds != null; }
      if (seconds != null) seconds = Math.max(0, Math.round(seconds - receivedAgeSeconds(r.recptnDt, now)));
      if (code === 0 || code === 1) seconds = 0;
      const terminal = String(r.bstatnNm || '').replace(/\s*\(.*$/, '');
      const lineName = LINE_NAMES[r.subwayId] || '지하철';
      const updn = String(r.updnLine || '');
      const via = headingOf(r);
      const heading = via ? via + ' 방면' : updn;
      return {
        type: 'subway',
        name: lineName + ' ' + station + '역',
        line: lineName,
        updn,
        heading,
        group: lineName + '|' + updn,
        destination: terminal ? terminal + '행' : '',
        trainLine: String(r.trainLineNm || ''),
        seconds,
        estimated,
        minutes: seconds == null ? null : seconds / 60,
        message,
        location: String(r.arvlMsg3 || ''),
        status: ARRIVAL_CODES[code] || '',
        express: String(r.btrainSttus || '') === '급행',
        lastTrain: String(r.lstcarAt || '') === '1',
        receivedAt: r.recptnDt || null,
      };
    })
    .sort((a, b) => (a.seconds ?? Infinity) - (b.seconds ?? Infinity))
    .slice(0, next ? 5 : 40);
  return { trains, warning };
}

function parseBus(data) {
  const body = data.response?.body;
  const raw = body?.items?.item || [];
  return (Array.isArray(raw) ? raw : [raw]).filter(Boolean).map((x) => {
    const seconds = Number(x.arrtime);
    return {
      type: 'bus',
      name: '버스 ' + String(x.routeno || x.routeNo || ''),
      destination: String(x.nodenm || x.nodeNm || ''),
      seconds: Number.isFinite(seconds) ? seconds : null,
      minutes: Number.isFinite(seconds) ? seconds / 60 : null,
      message: '정류소 도착 예정',
    };
  }).slice(0, 8);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const items = [], warnings = [];
  // "서울역" → "서울" (API는 '역' 없이 역명을 받는다)
  const station = String(req.query.station || '').trim().replace(/역$/, '');
  if (station) {
    const lineId = String(req.query.lineId || ''), next = String(req.query.next || '');
    if (!STATION_RE.test(station) || (lineId && !LINE_NAMES[lineId]) || (next && !STATION_RE.test(next))) return res.status(400).json({ error: 'Unsupported station/line' });
    const key = process.env.SEOUL_SUBWAY_KEY;
    if (key) {
      try {
        const url = `http://swopenapi.seoul.go.kr/api/subway/${encodeURIComponent(key)}/json/realtimeStationArrival/0/50/${encodeURIComponent(station)}`;
        const data = await cached(url);
        const err = data.errorMessage || (data.code ? data : null);
        if (err && err.code === 'INFO-200') throw Error('"' + station + '"역 도착 정보가 없습니다. 역 이름을 확인하세요');
        if (err && err.status !== 200 && err.code !== 'INFO-000') throw Error(err.message || 'API 오류');
        const { trains, warning } = parseSubway(data, station, lineId, next);
        items.push(...trains);
        if (warning) warnings.push(warning);
        if (!trains.length) warnings.push('해당 방향 열차 정보 없음');
      } catch (e) {
        warnings.push('지하철 조회 실패: ' + e.message);
      }
    } else warnings.push('SEOUL_SUBWAY_KEY 미설정');
  }

  const city = String(req.query.cityCode || ''), node = String(req.query.nodeId || '');
  if (city && node) {
    if (!/^\d{1,5}$/.test(city) || !/^[-_a-zA-Z0-9]{1,40}$/.test(node)) return res.status(400).json({ error: 'Invalid bus stop' });
    if (process.env.TAGO_SERVICE_KEY) {
      try {
        const url = new URL('https://apis.data.go.kr/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList');
        url.searchParams.set('serviceKey', process.env.TAGO_SERVICE_KEY);
        url.searchParams.set('cityCode', city);
        url.searchParams.set('nodeId', node);
        url.searchParams.set('_type', 'json');
        url.searchParams.set('numOfRows', '20');
        const data = await cached(url.toString());
        items.push(...parseBus(data));
      } catch (e) {
        warnings.push('버스 조회 실패: ' + e.message);
      }
    } else warnings.push('TAGO_SERVICE_KEY 미설정');
  }

  return res.status(200).json({ items, warnings, updatedAt: new Date().toISOString(), source: '서울시 실시간 지하철 / 국토교통부 TAGO' });
};

module.exports.parseSubway = parseSubway;

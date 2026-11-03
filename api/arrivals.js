// Vercel Node.js serverless function. Keys are read only from environment variables.
const ALLOWED_STATIONS = new Set(['잠실나루', '강남', '판교']);
const ALLOWED_LINES = new Set(['2호선', '신분당선']);
const LINE_IDS = { '2호선': ['1002'], '신분당선': ['1077'] };
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

// 방향 판별: updnLine(상행/하행/내선/외선)을 우선 사용하고, trainLineNm의 "OO방면"으로 보조 판별.
// 2호선 외선순환 = 시계방향(잠실나루 → 잠실 → 강남), 내선순환 = 반시계방향(강남 → 역삼 → 잠실).
// 신분당선 상행 = 신사 방면, 하행 = 광교 방면.
const DIRECTION_RULES = {
  '잠실나루|2호선': { updn: '외선', via: /잠실방면/ },
  '강남|2호선': { updn: '내선', via: /역삼방면/ },
  '강남|신분당선|광교': { updn: '하행', via: /양재방면/ },
  '강남|신분당선|신사': { updn: '상행', via: /신논현방면/ },
  '판교|신분당선|신사': { updn: '상행', via: /청계산입구방면/ },
  '판교|신분당선|광교': { updn: '하행', via: /정자방면/ },
};

function directionRule(station, line, direction) {
  if (line === '신분당선') return DIRECTION_RULES[station + '|' + line + '|' + (direction.includes('광교') ? '광교' : '신사')];
  return DIRECTION_RULES[station + '|' + line];
}

function matchesDirection(row, station, line, direction) {
  const subwayId = String(row.subwayId || '');
  if (subwayId && !LINE_IDS[line].includes(subwayId)) return false;
  const rule = directionRule(station, line, direction);
  if (!rule) return true;
  const updn = String(row.updnLine || '');
  if (updn) return updn === rule.updn;
  return rule.via.test(String(row.trainLineNm || ''));
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

const ARRIVAL_CODES = { 0: '진입 중', 1: '도착', 2: '출발', 3: '전역 출발', 4: '전역 진입', 5: '전역 도착', 99: '운행 중' };

function parseSubway(data, station, line, direction, now = Date.now()) {
  const rows = data.realtimeArrivalList || [];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => matchesDirection(r, station, line, direction))
    .map((r) => {
      const message = String(r.arvlMsg2 || '도착정보 확인 필요');
      const code = Number(r.arvlCd);
      let seconds = Number(r.barvlDt);
      if (!Number.isFinite(seconds) || seconds <= 0) seconds = secondsFromMessage(message);
      if (seconds != null) seconds = Math.max(0, Math.round(seconds - receivedAgeSeconds(r.recptnDt, now)));
      if (code === 0 || code === 1) seconds = 0;
      const terminal = String(r.bstatnNm || '').replace(/\s*\(.*$/, '');
      return {
        type: 'subway',
        name: line + ' ' + station + '역',
        destination: terminal ? terminal + '행' : direction,
        trainLine: String(r.trainLineNm || ''),
        seconds,
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
    .slice(0, 5);
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
  const station = req.query.station ? String(req.query.station) : '';
  if (station) {
    const line = String(req.query.line || '2호선'), direction = String(req.query.direction || '');
    if (!ALLOWED_STATIONS.has(station) || !ALLOWED_LINES.has(line)) return res.status(400).json({ error: 'Unsupported station/line' });
    const key = process.env.SEOUL_SUBWAY_KEY;
    if (key) {
      try {
        const url = `http://swopenapi.seoul.go.kr/api/subway/${encodeURIComponent(key)}/json/realtimeStationArrival/0/50/${encodeURIComponent(station)}`;
        const data = await cached(url);
        const err = data.errorMessage;
        if (err && err.status !== 200 && err.code !== 'INFO-000') throw Error(err.message || 'API 오류');
        const trains = parseSubway(data, station, line, direction);
        items.push(...trains);
        if (!trains.length) warnings.push('해당 방향 지하철 정보 없음');
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

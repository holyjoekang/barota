'use strict';
const $ = (id) => document.getElementById(id);

const DEFAULT_API = location.protocol.startsWith('http') ? '/api' : '';
let apiBase = localStorage.getItem('barotaApiBase') || '';
let position = null, steps = [], stepIndex = 0, commuteMode = null;
let liveItems = [], fetchedAt = 0, requestSeq = 0;

const STATIONS = {
  work: [{ station: '잠실나루', line: '2호선', direction: '강남 방면' }, { station: '강남', line: '신분당선', direction: '광교 방면' }],
  home: [{ station: '판교', line: '신분당선', direction: '신사 방면' }, { station: '강남', line: '2호선', direction: '잠실 방면' }],
};
const COMMUTES = {
  work: { destination: '판교역', label: '출근', steps: [
    { title: '잠실나루역', detail: '2호선 강남·교대 방면 승차' },
    { title: '강남역 하차', detail: '신분당선으로 환승하세요' },
    { title: '신분당선 승차', detail: '광교 방면 열차를 타세요' },
    { title: '판교역 하차', detail: '목적지 판교역에 도착합니다' },
  ] },
  home: { destination: '잠실나루역', label: '퇴근', steps: [
    { title: '판교역', detail: '신분당선 신사 방면 승차' },
    { title: '강남역 하차', detail: '2호선 잠실·종합운동장 방면으로 환승하세요' },
    { title: '2호선 승차', detail: '잠실 방면 열차를 타세요' },
    { title: '잠실나루역 하차', detail: '목적지 잠실나루역에 도착합니다' },
  ] },
};

// 1단계: 출발역 열차 / 2·3단계: 환승역에서 갈아탈 열차 / 마지막 단계: 표시 안 함
function stationForStep() {
  if (!commuteMode || stepIndex >= 3) return null;
  return STATIONS[commuteMode][stepIndex === 0 ? 0 : 1];
}

function preferredMode(now = new Date()) {
  const hour = now.getHours();
  if (now.getDay() === 0 || now.getDay() === 6 || hour < 5) return localStorage.getItem('barotaCommuteMode') || 'work';
  return hour < 12 ? 'work' : 'home';
}

function renderSteps() {
  $('steps').replaceChildren();
  steps.forEach((s) => {
    const li = document.createElement('li');
    li.textContent = s.title + ' — ' + s.detail;
    $('steps').append(li);
  });
  $('stepsPanel').classList.remove('hidden');
}

function startCommute(mode) {
  commuteMode = mode;
  localStorage.setItem('barotaCommuteMode', mode);
  const route = COMMUTES[mode];
  $('destination').value = '';
  steps = route.steps.map((s) => ({ ...s }));
  stepIndex = 0;
  renderSteps();
  $('toWorkBtn').className = mode === 'work' ? 'primary' : 'secondary';
  $('toHomeBtn').className = mode === 'home' ? 'primary' : 'secondary';
  showStep();
}

function showStep() {
  const s = steps[stepIndex];
  const label = commuteMode ? COMMUTES[commuteMode].label + ' · ' : '단계 ';
  setHero(s.title, s.detail, label + (stepIndex + 1) + ' / ' + steps.length);
  document.querySelectorAll('#steps li').forEach((el, i) => el.classList.toggle('active', i === stepIndex));
  $('prevBtn').disabled = stepIndex === 0;
  $('nextBtn').textContent = stepIndex === steps.length - 1 ? '처음으로' : '다음 단계';
  liveItems = [];
  renderLive();
  refresh();
}

function updateClock() {
  const now = new Date();
  const time = now.toLocaleString('ko-KR', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
  $('clockStatus').textContent = commuteMode
    ? time + ' · ' + (commuteMode === preferredMode(now) ? '시간대 자동 선택' : '수동 선택') + ' · 현재 ' + COMMUTES[commuteMode].label + ' 경로'
    : time + ' · 목적지 안내 중';
}

function setHero(title, detail, mode) {
  $('mode').textContent = mode;
  $('headline').textContent = title;
  $('detail').textContent = detail;
}

function locate() {
  if (!navigator.geolocation) { $('gpsStatus').textContent = '위치 기능을 지원하지 않는 브라우저입니다.'; return; }
  $('gpsStatus').textContent = '📍 위치 확인 중…';
  navigator.geolocation.getCurrentPosition(
    (p) => { position = { lat: p.coords.latitude, lon: p.coords.longitude }; $('gpsStatus').textContent = '📍 현재 위치 확인 완료 (오차 약 ' + Math.round(p.coords.accuracy) + 'm)'; },
    (e) => { $('gpsStatus').textContent = '위치 확인 실패: ' + e.message; },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
}

function start() {
  const destination = $('destination').value.trim();
  if (!destination) { $('destination').focus(); return; }
  commuteMode = null;
  $('toWorkBtn').className = $('toHomeBtn').className = 'secondary';
  const query = encodeURIComponent(destination);
  // No fabricated routes: route selection occurs in a map provider until a routing API is connected.
  steps = [
    { title: '목적지 확인', detail: destination + '까지의 경로를 지도 서비스에서 확인하세요.' },
    { title: '경로 선택', detail: '아래 경로 링크에서 버스와 지하철 경로 및 환승 정보를 확인하세요.' },
    { title: '이동 중 확인', detail: '승강장과 정류장 표시를 확인하고 다음 단계 버튼으로 안내를 진행하세요.' },
  ];
  stepIndex = 0;
  renderSteps();
  const links = document.createElement('li');
  links.innerHTML = '<a href="https://map.kakao.com/?q=' + query + '" target="_blank" rel="noopener noreferrer">카카오맵에서 경로 확인 ↗</a> · <a href="https://map.naver.com/p/search/' + query + '" target="_blank" rel="noopener noreferrer">네이버지도에서 검색 ↗</a>';
  $('steps').append(links);
  updateClock();
  showStep();
}

// ---- 실시간 도착 정보 ----
function remainingSeconds(item) {
  const s = Number(item.seconds ?? (item.minutes != null ? item.minutes * 60 : NaN));
  if (!Number.isFinite(s)) return null;
  return Math.max(0, Math.round(s - (Date.now() - fetchedAt) / 1000));
}

function formatRemaining(item) {
  const left = remainingSeconds(item);
  if (left == null) return item.message || '도착정보 없음';
  if (item.status === '도착' || item.status === '진입 중') return '지금 도착';
  if (left <= 30) return '곧 도착';
  return (item.estimated ? '약 ' : '') + Math.ceil(left / 60) + '분 후 도착';
}

// 남은 시간을 카운트다운으로 보여줄 때는 API 원문 메시지 대신 현재 위치만 덧붙인다.
function trainWhere(item) {
  const loc = item.location ? '현재 ' + item.location + '역' : '';
  return loc || (remainingSeconds(item) == null ? '' : item.message);
}

function trainLabel(item) {
  return [item.destination, item.express ? '급행' : '', item.lastTrain ? '막차' : ''].filter(Boolean).join(' · ');
}

function renderLive() {
  const st = stationForStep();
  const subway = liveItems.filter((x) => x.type === 'subway');
  $('liveHero').classList.toggle('hidden', !st);
  if (st) {
    $('liveHeroStation').textContent = st.station + '역 · ' + st.line + ' ' + st.direction;
    if (subway.length) {
      const first = subway[0];
      $('eta').textContent = formatRemaining(first);
      $('etaInfo').textContent = [trainLabel(first), trainWhere(first)].filter(Boolean).join(' · ');
      const second = subway[1];
      $('etaNext').textContent = second ? formatRemaining(second) : '정보 없음';
      $('etaNextInfo').textContent = second ? [trainLabel(second), trainWhere(second)].filter(Boolean).join(' · ') : '';
    } else {
      $('eta').textContent = fetchedAt ? '도착 정보 없음' : '불러오는 중…';
      $('etaInfo').textContent = '';
      $('etaNext').textContent = '';
      $('etaNextInfo').textContent = '';
    }
  }

  const rows = liveItems.slice(0, 12).map((item) => {
    const el = document.createElement('div');
    el.className = 'arrival';
    const head = document.createElement('div');
    head.className = 'arrival-head';
    const name = document.createElement('strong');
    name.textContent = item.type === 'subway' ? trainLabel(item) : String(item.name || '대중교통');
    const time = document.createElement('span');
    time.className = 'arrival-time';
    time.textContent = formatRemaining(item);
    head.append(name, time);
    const info = document.createElement('div');
    info.className = 'arrival-info';
    info.textContent = item.type === 'subway'
      ? trainWhere(item)
      : String(item.destination || '');
    el.append(head, info);
    return el;
  });
  $('liveResults').replaceChildren(...rows);
}

async function refresh() {
  const st = stationForStep();
  const city = localStorage.getItem('barotaBusCity'), node = localStorage.getItem('barotaBusNode');
  const base = apiBase || DEFAULT_API;
  if (!base) { $('liveStatus').textContent = '실시간 API 주소가 없습니다. 설정에서 프록시 주소를 입력하세요.'; return; }
  if (!st && !(city && node)) {
    liveItems = []; fetchedAt = 0; renderLive();
    $('liveStatus').textContent = commuteMode ? '목적지에 도착하는 단계입니다. 실시간 열차 정보는 승차 단계에서 표시됩니다.' : '실시간 지하철 정보는 출퇴근 경로에서 표시됩니다.';
    return;
  }
  const seq = ++requestSeq;
  if (!liveItems.length) $('liveStatus').textContent = '실시간 정보 조회 중…';
  try {
    const url = new URL(base.replace(/\/$/, '') + '/arrivals', location.href);
    if (st) { url.searchParams.set('station', st.station); url.searchParams.set('line', st.line); url.searchParams.set('direction', st.direction); }
    if (city && node) { url.searchParams.set('cityCode', city); url.searchParams.set('nodeId', node); }
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10000);
    let res;
    try { res = await fetch(url, { signal: ctrl.signal }); } finally { clearTimeout(timeout); }
    if (!res.ok) throw Error('HTTP ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data.items)) throw Error('잘못된 API 응답');
    if (seq !== requestSeq) return; // 단계가 바뀐 뒤 도착한 이전 응답은 무시
    liveItems = data.items; fetchedAt = Date.now();
    $('liveStatus').textContent = (st ? st.station + '역 ' + st.line + ' ' + st.direction + ' · ' : '')
      + new Date().toLocaleTimeString('ko-KR') + ' 기준'
      + (data.warnings?.length ? ' · ' + data.warnings.join(' / ') : '')
      + (data.items.length ? '' : ' · 조회 결과 없음');
    renderLive();
  } catch (err) {
    if (seq !== requestSeq) return;
    $('liveStatus').textContent = '실시간 정보 조회 실패: ' + (err.name === 'AbortError' ? '응답 시간 초과' : err.message) + (liveItems.length ? ' (이전 정보 표시 중)' : '');
  }
}

// ---- 이벤트 ----
$('apiBase').value = apiBase;
$('busCity').value = localStorage.getItem('barotaBusCity') || '';
$('busNode').value = localStorage.getItem('barotaBusNode') || '';
$('saveBus').onclick = () => { localStorage.setItem('barotaBusCity', $('busCity').value.trim()); localStorage.setItem('barotaBusNode', $('busNode').value.trim()); refresh(); };
$('saveSettings').onclick = () => {
  const value = $('apiBase').value.trim();
  if (value && !/^(https:\/\/|\/)/i.test(value)) { alert('HTTPS 주소 또는 /api 같은 경로를 입력하세요.'); return; }
  apiBase = value;
  localStorage.setItem('barotaApiBase', value);
  $('settings').classList.add('hidden');
  refresh();
};
$('settingsBtn').onclick = () => $('settings').classList.toggle('hidden');
$('gpsBtn').onclick = locate;
$('searchBtn').onclick = start;
$('refreshBtn').onclick = refresh;
$('prevBtn').onclick = () => { if (stepIndex > 0) { stepIndex--; showStep(); } };
$('nextBtn').onclick = () => { stepIndex = (stepIndex + 1) % steps.length; showStep(); };
document.querySelectorAll('[data-dest]').forEach((b) => { b.onclick = () => { $('destination').value = b.dataset.dest; }; });
$('destination').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
$('toWorkBtn').onclick = () => { startCommute('work'); updateClock(); };
$('toHomeBtn').onclick = () => { startCommute('home'); updateClock(); };

startCommute(preferredMode());
updateClock();
setInterval(updateClock, 60000);
setInterval(() => { if (!document.hidden) refresh(); }, 15000);
setInterval(() => { if (!document.hidden && liveItems.length) renderLive(); }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

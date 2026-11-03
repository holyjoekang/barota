'use strict';
const $ = (id) => document.getElementById(id);

const DEFAULT_API = location.protocol.startsWith('http') ? '/api' : '';
let apiBase = localStorage.getItem('barotaApiBase') || '';

// view: null(시작 메뉴) | { kind: 'commute', mode } | { kind: 'station', station }
let view = null, steps = [], stepIndex = 0;
let liveItems = [], fetchedAt = 0, requestSeq = 0, selectedGroup = null;

const STATIONS = {
  work: [{ station: '잠실나루', line: '2호선', direction: '강남 방면' }, { station: '강남', line: '신분당선', direction: '광교 방면' }],
  home: [{ station: '판교', line: '신분당선', direction: '신사 방면' }, { station: '강남', line: '2호선', direction: '잠실 방면' }],
};
const COMMUTES = {
  work: { label: '출근', route: '잠실나루 → 판교', steps: [
    { title: '잠실나루역', detail: '2호선 강남·교대 방면 승차' },
    { title: '강남역 하차', detail: '신분당선으로 환승하세요' },
    { title: '신분당선 승차', detail: '광교 방면 열차를 타세요' },
    { title: '판교역 하차', detail: '목적지 판교역에 도착합니다' },
  ] },
  home: { label: '퇴근', route: '판교 → 잠실나루', steps: [
    { title: '판교역', detail: '신분당선 신사 방면 승차' },
    { title: '강남역 하차', detail: '2호선 잠실·종합운동장 방면으로 환승하세요' },
    { title: '2호선 승차', detail: '잠실 방면 열차를 타세요' },
    { title: '잠실나루역 하차', detail: '목적지 잠실나루역에 도착합니다' },
  ] },
};
const DEFAULT_QUICK = ['강남', '잠실', '서울', '홍대입구', '판교', '시청'];

// ---- 시작 메뉴 ----
function preferredMode(now = new Date()) {
  const hour = now.getHours();
  if (now.getDay() === 0 || now.getDay() === 6 || hour < 5) return null;
  return hour < 12 ? 'work' : 'home';
}

function recentStations() {
  try { return JSON.parse(localStorage.getItem('barotaRecentStations') || '[]'); } catch { return []; }
}

function renderMenu() {
  const now = new Date();
  const pref = preferredMode(now);
  $('clockStatus').textContent = now.toLocaleString('ko-KR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })
    + (pref ? ' · 지금은 ' + COMMUTES[pref].label + ' 시간입니다' : '');
  $('toWorkBtn').classList.toggle('recommended', pref === 'work');
  $('toHomeBtn').classList.toggle('recommended', pref === 'home');
  const names = [...new Set([...recentStations(), ...DEFAULT_QUICK])].slice(0, 8);
  $('quickStations').replaceChildren(...names.map((name) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name + '역';
    b.onclick = () => openStation(name);
    return b;
  }));
}

function showMenu() {
  view = null;
  requestSeq++;
  liveItems = []; fetchedAt = 0;
  renderMenu();
  for (const id of ['choiceBar', 'hero', 'stepsPanel', 'livePanel']) $(id).classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('stationInput').value = '';
  window.scrollTo(0, 0);
}

function showChoice(label) {
  $('menu').classList.add('hidden');
  $('choiceBar').classList.remove('hidden');
  $('choiceLabel').textContent = label;
  $('hero').classList.remove('hidden');
  $('livePanel').classList.remove('hidden');
  window.scrollTo(0, 0);
}

// ---- 출퇴근 ----
function startCommute(mode) {
  view = { kind: 'commute', mode };
  const route = COMMUTES[mode];
  showChoice(route.label + ' · ' + route.route);
  steps = route.steps;
  stepIndex = 0;
  $('steps').replaceChildren(...steps.map((s) => {
    const li = document.createElement('li');
    li.textContent = s.title + ' — ' + s.detail;
    return li;
  }));
  $('stepsPanel').classList.remove('hidden');
  showStep();
}

// 1단계: 출발역 열차 / 2·3단계: 환승역에서 갈아탈 열차 / 마지막 단계: 표시 안 함
function commuteStation() {
  if (view?.kind !== 'commute' || stepIndex >= 3) return null;
  return STATIONS[view.mode][stepIndex === 0 ? 0 : 1];
}

function showStep() {
  const s = steps[stepIndex];
  setHero(s.title, s.detail, COMMUTES[view.mode].label + ' · ' + (stepIndex + 1) + ' / ' + steps.length);
  document.querySelectorAll('#steps li').forEach((el, i) => el.classList.toggle('active', i === stepIndex));
  $('prevBtn').disabled = stepIndex === 0;
  $('nextBtn').textContent = stepIndex === steps.length - 1 ? '처음으로' : '다음 단계';
  liveItems = []; fetchedAt = 0;
  renderLive();
  refresh();
}

// ---- 다른 역 ----
function openStation(raw) {
  const station = String(raw || '').trim().replace(/\s+/g, '').replace(/역$/, '');
  if (!station) { $('stationInput').focus(); return; }
  view = { kind: 'station', station };
  selectedGroup = localStorage.getItem('barotaGroup:' + station);
  showChoice(station + '역');
  $('stepsPanel').classList.add('hidden');
  setHero(station + '역', '타실 방향을 아래에서 고르세요', '실시간 도착 안내');
  liveItems = []; fetchedAt = 0;
  renderLive();
  refresh();
}

function setHero(title, detail, mode) {
  $('mode').textContent = mode;
  $('headline').textContent = title;
  $('detail').textContent = detail;
}

// ---- 실시간 표시 ----
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

// 남은 시간을 표시할 때는 API 원문 메시지 대신 현재 위치만 덧붙인다.
function trainWhere(item) {
  const loc = item.location ? '현재 ' + item.location + '역' : '';
  return loc || (remainingSeconds(item) == null ? '' : item.message);
}

function trainLabel(item) {
  return [item.destination, item.express ? '급행' : '', item.lastTrain ? '막차' : ''].filter(Boolean).join(' · ');
}

function trainSummary(item) {
  return [trainLabel(item), trainWhere(item)].filter(Boolean).join(' · ');
}

// 역 선택 화면: 노선+방향별로 묶기
function groupTrains(items) {
  const groups = new Map();
  for (const item of items.filter((x) => x.type === 'subway')) {
    const key = item.group || item.line;
    if (!groups.has(key)) groups.set(key, { key, line: item.line, heading: item.heading, updn: item.updn, trains: [] });
    groups.get(key).trains.push(item);
  }
  return [...groups.values()].sort((a, b) => a.line.localeCompare(b.line, 'ko') || a.updn.localeCompare(b.updn, 'ko'));
}

function groupTitle(g) {
  return g.line + ' · ' + g.heading + (g.updn && !g.heading.includes(g.updn) ? ' (' + g.updn + ')' : '');
}

function renderHeroTrains(title, trains) {
  $('liveHero').classList.remove('hidden');
  $('liveHeroStation').textContent = title;
  const [first, second] = trains;
  $('eta').textContent = first ? formatRemaining(first) : (fetchedAt ? '도착 정보 없음' : '불러오는 중…');
  $('etaInfo').textContent = first ? trainSummary(first) : '';
  $('etaNext').textContent = second ? formatRemaining(second) : (fetchedAt ? '정보 없음' : '');
  $('etaNextInfo').textContent = second ? trainSummary(second) : '';
}

function arrivalRow(name, timeText, infoText, onClick, active) {
  const el = document.createElement(onClick ? 'button' : 'div');
  el.className = 'arrival' + (onClick ? ' pick' : '') + (active ? ' active' : '');
  if (onClick) { el.type = 'button'; el.onclick = onClick; }
  const head = document.createElement('div');
  head.className = 'arrival-head';
  const strong = document.createElement('strong');
  strong.textContent = name;
  const time = document.createElement('span');
  time.className = 'arrival-time';
  time.textContent = timeText;
  head.append(strong, time);
  const info = document.createElement('div');
  info.className = 'arrival-info';
  info.textContent = infoText;
  el.append(head, info);
  return el;
}

function renderLive() {
  if (!view) return;
  if (view.kind === 'commute') {
    const st = commuteStation();
    if (st) renderHeroTrains(st.station + '역 · ' + st.line + ' ' + st.direction, liveItems.filter((x) => x.type === 'subway'));
    else $('liveHero').classList.add('hidden');
    $('liveTitle').textContent = '실시간 도착 정보';
    $('liveResults').replaceChildren(...liveItems.slice(0, 12).map((item) => arrivalRow(
      item.type === 'subway' ? trainLabel(item) : String(item.name || '대중교통'),
      formatRemaining(item),
      item.type === 'subway' ? trainWhere(item) : String(item.destination || ''),
    )));
    return;
  }

  // 역 선택: 방향별 카드, 고른 방향은 큰 화면에 표시
  const groups = groupTrains(liveItems);
  if (groups.length && !groups.some((g) => g.key === selectedGroup)) selectedGroup = groups[0].key;
  const current = groups.find((g) => g.key === selectedGroup);
  if (current) {
    setHero(view.station + '역', groups.length > 1 ? '아래에서 방향을 바꿀 수 있어요' : '', '실시간 도착 안내');
    renderHeroTrains(groupTitle(current), current.trains);
  } else if (fetchedAt) {
    $('liveHero').classList.add('hidden');
    $('detail').textContent = '지금 도착 예정인 열차 정보가 없습니다.';
  } else {
    renderHeroTrains('방향 확인 중', []);
  }
  $('liveTitle').textContent = groups.length > 1 ? '타실 방향을 고르세요' : '실시간 도착 정보';
  $('liveResults').replaceChildren(...groups.map((g) => arrivalRow(
    groupTitle(g),
    formatRemaining(g.trains[0]),
    '그다음 ' + (g.trains[1] ? formatRemaining(g.trains[1]) : '정보 없음') + ' · ' + trainLabel(g.trains[0]),
    () => { selectedGroup = g.key; localStorage.setItem('barotaGroup:' + view.station, g.key); renderLive(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    g.key === selectedGroup,
  )));
}

async function refresh() {
  if (!view) return;
  const base = apiBase || DEFAULT_API;
  if (!base) { $('liveStatus').textContent = '실시간 API 주소가 없습니다. 설정에서 프록시 주소를 입력하세요.'; return; }
  const st = view.kind === 'commute' ? commuteStation() : { station: view.station };
  const city = localStorage.getItem('barotaBusCity'), node = localStorage.getItem('barotaBusNode');
  const withBus = view.kind === 'commute' && city && node;
  if (!st && !withBus) {
    liveItems = []; fetchedAt = 0; renderLive();
    $('liveResults').replaceChildren();
    $('liveStatus').textContent = '목적지에 도착하는 단계입니다. 실시간 열차 정보는 승차 단계에서 표시됩니다.';
    return;
  }
  const seq = ++requestSeq;
  if (!liveItems.length) $('liveStatus').textContent = '실시간 정보 조회 중…';
  try {
    const url = new URL(base.replace(/\/$/, '') + '/arrivals', location.href);
    if (st) {
      url.searchParams.set('station', st.station);
      if (st.line) { url.searchParams.set('line', st.line); url.searchParams.set('direction', st.direction); }
    }
    if (withBus) { url.searchParams.set('cityCode', city); url.searchParams.set('nodeId', node); }
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10000);
    let res;
    try { res = await fetch(url, { signal: ctrl.signal }); } finally { clearTimeout(timeout); }
    if (!res.ok) throw Error(res.status === 400 ? '지원하지 않는 역 이름입니다' : 'HTTP ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data.items)) throw Error('잘못된 API 응답');
    if (seq !== requestSeq) return; // 화면이 바뀐 뒤 도착한 이전 응답은 무시
    liveItems = data.items; fetchedAt = Date.now();
    if (view.kind === 'station' && data.items.length) {
      const recent = [view.station, ...recentStations().filter((x) => x !== view.station)].slice(0, 5);
      localStorage.setItem('barotaRecentStations', JSON.stringify(recent));
    }
    $('liveStatus').textContent = (st ? st.station + '역' + (st.line ? ' ' + st.line + ' ' + st.direction : '') + ' · ' : '')
      + new Date().toLocaleTimeString('ko-KR') + ' 기준'
      + (data.warnings?.length ? ' · ' + data.warnings.join(' / ') : '');
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
$('toWorkBtn').onclick = () => startCommute('work');
$('toHomeBtn').onclick = () => startCommute('home');
$('stationForm').onsubmit = (e) => { e.preventDefault(); openStation($('stationInput').value); };
$('changeBtn').onclick = showMenu;
$('refreshBtn').onclick = refresh;
$('prevBtn').onclick = () => { if (stepIndex > 0) { stepIndex--; showStep(); } };
$('nextBtn').onclick = () => { stepIndex = (stepIndex + 1) % steps.length; showStep(); };

showMenu();
setInterval(() => { if (!view) renderMenu(); }, 60000);
setInterval(() => { if (!document.hidden) refresh(); }, 15000);
setInterval(() => { if (!document.hidden && liveItems.length) renderLive(); }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

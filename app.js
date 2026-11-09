'use strict';
const $ = (id) => document.getElementById(id);

const DEFAULT_API = location.protocol.startsWith('http') ? '/api' : '';
let apiBase = localStorage.getItem('barotaApiBase') || '';

let network = null;                 // route.js 네트워크 (data/subway.json 로드 후)
let view = null;                    // null = 시작 메뉴, 아니면 { label, route }
let steps = [], stepIndex = 0;
let liveItems = [], liveWarnings = [], fetchedAt = 0, requestSeq = 0;

// 출퇴근 역은 이 기기(localStorage)에만 저장한다. 서버로 보내지 않는다.
const STORE_KEYS = ['barotaCommute', 'barotaRecentRoutes', 'barotaApiBase', 'barotaCommuteMode', 'barotaBusCity', 'barotaBusNode'];
const LABELS = { work: '출근', home: '퇴근' };

function loadCommute() {
  try {
    const c = JSON.parse(localStorage.getItem('barotaCommute') || 'null');
    return c && c.home && c.work ? c : null;
  } catch { return null; }
}

function commuteRoute(mode) {
  const c = loadCommute();
  if (!c) return null;
  return mode === 'work' ? { from: c.home, to: c.work } : { from: c.work, to: c.home };
}

// ---- 데이터 로드 ----
async function loadNetwork() {
  try {
    const res = await fetch('data/subway.json');
    if (!res.ok) throw Error('HTTP ' + res.status);
    network = BarotaRoute.createNetwork(await res.json());
    $('stationList').replaceChildren(...network.names.sort((a, b) => a.localeCompare(b, 'ko')).map((n) => {
      const o = document.createElement('option');
      o.value = n + '역';
      return o;
    }));
  } catch (err) {
    showError('역 정보를 불러오지 못했습니다: ' + err.message);
  }
}

// ---- 시작 메뉴 ----
function preferredMode(now = new Date()) {
  const hour = now.getHours();
  if (now.getDay() === 0 || now.getDay() === 6 || hour < 5) return null;
  return hour < 12 ? 'work' : 'home';
}

function recentRoutes() {
  try { return JSON.parse(localStorage.getItem('barotaRecentRoutes') || '[]'); } catch { return []; }
}

function renderMenu() {
  const now = new Date();
  const pref = preferredMode(now);
  $('clockStatus').textContent = now.toLocaleString('ko-KR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })
    + (pref ? ' · 지금은 ' + LABELS[pref] + ' 시간입니다' : '');
  for (const mode of ['work', 'home']) {
    const r = commuteRoute(mode);
    $(mode + 'Sub').textContent = r ? r.from + ' → ' + r.to : '⚙️ 역을 설정하세요';
  }
  $('toWorkBtn').classList.toggle('recommended', pref === 'work');
  $('toHomeBtn').classList.toggle('recommended', pref === 'home');
  $('recentRoutes').replaceChildren(...recentRoutes().map(([from, to]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = from + ' → ' + to;
    b.onclick = () => startRoute(from, to);
    return b;
  }));
}

function showMenu() {
  view = null;
  requestSeq++;
  liveItems = []; fetchedAt = 0;
  renderMenu();
  for (const id of ['choiceBar', 'hero', 'stepNav', 'stepsPanel', 'livePanel']) $(id).classList.add('hidden');
  $('menu').classList.remove('hidden');
  window.scrollTo(0, 0);
}

function showError(msg) {
  $('routeError').textContent = msg;
  $('routeError').classList.toggle('hidden', !msg);
}

// ---- 경로 → 단계 ----
function buildSteps(route) {
  const out = [];
  route.legs.forEach((leg, i) => {
    const toward = leg.to + ' 방면';
    const ride = leg.stops + '개 역 · 약 ' + Math.max(1, Math.round(leg.minutes)) + '분';
    if (i === 0) {
      out.push({ title: leg.from + '역', detail: leg.line + ' ' + toward + ' 승차', note: '다음 역 ' + leg.next + ' · ' + ride, leg });
    } else {
      out.push({ title: leg.from + '역 하차', detail: leg.line + '으로 환승하세요', leg });
      out.push({ title: leg.line + ' 승차', detail: toward + ' 열차를 타세요', note: '다음 역 ' + leg.next + ' · ' + ride, leg });
    }
  });
  out.push({ title: route.to + '역 하차', detail: '목적지 ' + route.to + '역에 도착합니다', leg: null });
  return out;
}

function startRoute(fromInput, toInput, label) {
  if (!network) { showError('역 정보를 불러오는 중입니다. 잠시 후 다시 시도하세요.'); return; }
  const from = network.resolve(fromInput), to = network.resolve(toInput);
  if (!from) { showError('"' + (fromInput || '') + '" 역을 찾을 수 없습니다. 목록에서 골라 주세요.'); $('fromInput').focus(); return; }
  if (!to) { showError('"' + (toInput || '') + '" 역을 찾을 수 없습니다. 목록에서 골라 주세요.'); $('toInput').focus(); return; }
  if (from === to) { showError('타는 역과 내리는 역이 같습니다.'); return; }
  const route = network.findRoute(from, to);
  if (!route) { showError(from + '역에서 ' + to + '역까지 가는 지하철 경로를 찾지 못했습니다.'); return; }
  showError('');

  if (!label) {
    const recent = [[from, to], ...recentRoutes().filter(([a, b]) => !(a === from && b === to))].slice(0, 4);
    localStorage.setItem('barotaRecentRoutes', JSON.stringify(recent));
  }
  view = { label: label || '경로 안내', route };
  steps = buildSteps(route);
  stepIndex = 0;

  $('menu').classList.add('hidden');
  $('choiceBar').classList.remove('hidden');
  $('choiceLabel').textContent = (label ? label + ' · ' : '') + from + ' → ' + to;
  $('choiceSub').textContent = '약 ' + route.minutes + '분 · ' + (route.transfers ? '환승 ' + route.transfers + '회' : '환승 없음');
  for (const id of ['hero', 'stepNav', 'stepsPanel', 'livePanel']) $(id).classList.remove('hidden');
  $('steps').replaceChildren(...steps.map((s) => {
    const li = document.createElement('li');
    li.textContent = s.title + ' — ' + s.detail + (s.note ? ' (' + s.note + ')' : '');
    return li;
  }));
  window.scrollTo(0, 0);
  showStep();
}

function showStep() {
  const s = steps[stepIndex];
  $('mode').textContent = view.label + ' · ' + (stepIndex + 1) + ' / ' + steps.length;
  $('headline').textContent = s.title;
  $('detail').textContent = s.detail;
  $('detailNote').textContent = s.note || '';
  document.querySelectorAll('#steps li').forEach((el, i) => el.classList.toggle('active', i === stepIndex));
  $('prevBtn').disabled = stepIndex === 0;
  $('nextBtn').textContent = stepIndex === steps.length - 1 ? '처음으로' : '다음 단계 →';
  liveItems = []; liveWarnings = []; fetchedAt = 0;
  renderLive();
  refresh();
}

const currentLeg = () => (view ? steps[stepIndex].leg : null);

// ---- 실시간 표시 ----
// 여유 시간: 실제 도착 예정보다 30초 앞당겨 보여 준다 (예: 2분 후 → 1분 30초 후)
const SAFETY_SECONDS = 30;

function remainingSeconds(item) {
  const s = Number(item.seconds ?? (item.minutes != null ? item.minutes * 60 : NaN));
  if (!Number.isFinite(s)) return null;
  return Math.max(0, Math.round(s - SAFETY_SECONDS - (Date.now() - fetchedAt) / 1000));
}

function formatRemaining(item) {
  const left = remainingSeconds(item);
  if (left == null) return item.message || '도착정보 없음';
  if (item.status === '도착' || item.status === '진입 중') return '지금 도착';
  if (left <= 0) return '곧 도착';
  if (item.estimated) return '약 ' + Math.max(1, Math.round(left / 60)) + '분 후 도착';
  const m = Math.floor(left / 60), sec = left % 60;
  return (m ? m + '분 ' : '') + (sec || !m ? sec + '초 ' : '') + '후 도착';
}

function trainWhere(item) {
  const loc = item.location ? '현재 ' + item.location + '역' : '';
  return loc || (remainingSeconds(item) == null ? '' : item.message);
}

function trainLabel(item) {
  return [item.destination, item.express ? '급행' : '', item.lastTrain ? '막차' : ''].filter(Boolean).join(' · ');
}

const trainSummary = (item) => [trainLabel(item), trainWhere(item)].filter(Boolean).join(' · ');

function renderLive() {
  if (!view) return;
  const leg = currentLeg();
  $('liveHero').classList.toggle('hidden', !leg);
  if (leg) {
    $('liveHeroStation').textContent = leg.from + '역 · ' + leg.line + ' ' + leg.to + ' 방면';
    const [first, second] = liveItems;
    const noData = !leg.apiId ? '실시간 정보 미제공' : (fetchedAt ? '도착 정보 없음' : '불러오는 중…');
    $('eta').textContent = first ? formatRemaining(first) : noData;
    $('etaInfo').textContent = first ? trainSummary(first) : '';
    $('etaNext').textContent = second ? formatRemaining(second) : (fetchedAt ? '정보 없음' : '');
    $('etaNextInfo').textContent = second ? trainSummary(second) : '';
  }
  $('liveResults').replaceChildren(...liveItems.slice(0, 6).map((item) => {
    const el = document.createElement('div');
    el.className = 'arrival';
    const head = document.createElement('div');
    head.className = 'arrival-head';
    const name = document.createElement('strong');
    name.textContent = trainLabel(item);
    const time = document.createElement('span');
    time.className = 'arrival-time';
    time.textContent = formatRemaining(item);
    head.append(name, time);
    const info = document.createElement('div');
    info.className = 'arrival-info';
    info.textContent = trainWhere(item);
    el.append(head, info);
    return el;
  }));
}

async function refresh() {
  if (!view) return;
  const leg = currentLeg();
  if (!leg) {
    liveItems = []; fetchedAt = 0; renderLive();
    $('liveStatus').textContent = '목적지에 도착하는 단계입니다. 실시간 열차 정보는 승차 단계에서 표시됩니다.';
    return;
  }
  if (!leg.apiId) {
    liveItems = []; fetchedAt = 0; renderLive();
    $('liveStatus').textContent = leg.line + '은 서울시 실시간 도착정보를 제공하지 않습니다.';
    return;
  }
  const base = apiBase || DEFAULT_API;
  if (!base) { $('liveStatus').textContent = '실시간 API 주소가 없습니다. 설정에서 프록시 주소를 입력하세요.'; return; }
  const seq = ++requestSeq;
  if (!liveItems.length) $('liveStatus').textContent = '실시간 정보 조회 중…';
  try {
    const url = new URL(base.replace(/\/$/, '') + '/arrivals', location.href);
    url.searchParams.set('station', leg.from);
    url.searchParams.set('lineId', leg.apiId);
    url.searchParams.set('next', leg.next);
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10000);
    let res;
    try { res = await fetch(url, { signal: ctrl.signal }); } finally { clearTimeout(timeout); }
    if (!res.ok) throw Error('HTTP ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data.items)) throw Error('잘못된 API 응답');
    if (seq !== requestSeq) return; // 단계가 바뀐 뒤 도착한 이전 응답은 무시
    liveItems = data.items.filter((x) => x.type === 'subway');
    liveWarnings = data.warnings || [];
    fetchedAt = Date.now();
    $('liveStatus').textContent = leg.from + '역 ' + leg.line + ' ' + leg.to + ' 방면 · '
      + new Date().toLocaleTimeString('ko-KR') + ' 기준'
      + (liveWarnings.length ? ' · ' + liveWarnings.join(' / ') : '');
    renderLive();
  } catch (err) {
    if (seq !== requestSeq) return;
    $('liveStatus').textContent = '실시간 정보 조회 실패: ' + (err.name === 'AbortError' ? '응답 시간 초과' : err.message) + (liveItems.length ? ' (이전 정보 표시 중)' : '');
  }
}

// ---- 이벤트 ----
// ---- 출퇴근 설정 ----
function openSettings(show = $('settings').classList.contains('hidden')) {
  $('settings').classList.toggle('hidden', !show);
  $('settingsBtn').setAttribute('aria-expanded', String(show));
  if (!show) return;
  const c = loadCommute();
  $('homeStationInput').value = c ? c.home + '역' : '';
  $('workStationInput').value = c ? c.work + '역' : '';
  $('apiBase').value = apiBase;
  $('settingsError').classList.add('hidden');
  $('settings').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function settingsError(msg) {
  $('settingsError').textContent = msg;
  $('settingsError').classList.toggle('hidden', !msg);
}

$('commuteForm').onsubmit = (e) => {
  e.preventDefault();
  if (!network) { settingsError('역 정보를 불러오는 중입니다. 잠시 후 다시 시도하세요.'); return; }
  const home = network.resolve($('homeStationInput').value), work = network.resolve($('workStationInput').value);
  if (!home) { settingsError('집 근처 역을 찾을 수 없습니다. 목록에서 골라 주세요.'); $('homeStationInput').focus(); return; }
  if (!work) { settingsError('회사 근처 역을 찾을 수 없습니다. 목록에서 골라 주세요.'); $('workStationInput').focus(); return; }
  if (home === work) { settingsError('집 근처 역과 회사 근처 역이 같습니다.'); return; }
  if (!network.findRoute(home, work)) { settingsError(home + '역과 ' + work + '역 사이 지하철 경로를 찾지 못했습니다.'); return; }
  localStorage.setItem('barotaCommute', JSON.stringify({ home, work }));
  openSettings(false);
  showMenu();
};

$('clearDataBtn').onclick = () => {
  if (!confirm('이 기기에 저장된 출퇴근 역, 최근 경로, 설정을 모두 지울까요?')) return;
  for (const k of STORE_KEYS) localStorage.removeItem(k);
  for (const k of Object.keys(localStorage)) if (k.startsWith('barota')) localStorage.removeItem(k);
  apiBase = '';
  openSettings(false);
  showMenu();
};

$('saveSettings').onclick = () => {
  const value = $('apiBase').value.trim();
  if (value && !/^(https:\/\/|\/)/i.test(value)) { alert('HTTPS 주소 또는 /api 같은 경로를 입력하세요.'); return; }
  apiBase = value;
  localStorage.setItem('barotaApiBase', value);
  openSettings(false);
  refresh();
};

$('settingsBtn').onclick = () => openSettings();

function startCommute(mode) {
  const r = commuteRoute(mode);
  if (!r) { openSettings(true); settingsError('먼저 집 근처 역과 회사 근처 역을 설정해 주세요.'); return; }
  startRoute(r.from, r.to, LABELS[mode]);
}
$('toWorkBtn').onclick = () => startCommute('work');
$('toHomeBtn').onclick = () => startCommute('home');
$('routeForm').onsubmit = (e) => { e.preventDefault(); startRoute($('fromInput').value, $('toInput').value); };
$('fromInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('toInput').focus(); } });
$('swapBtn').onclick = () => { const a = $('fromInput').value; $('fromInput').value = $('toInput').value; $('toInput').value = a; };
$('changeBtn').onclick = showMenu;
$('refreshBtn').onclick = refresh;
$('prevBtn').onclick = () => { if (stepIndex > 0) { stepIndex--; showStep(); } };
$('nextBtn').onclick = () => { stepIndex = (stepIndex + 1) % steps.length; showStep(); };

showMenu();
loadNetwork();
setInterval(() => { if (!view) renderMenu(); }, 60000);
setInterval(() => { if (!document.hidden) refresh(); }, 15000);
setInterval(() => { if (!document.hidden && liveItems.length) renderLive(); }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

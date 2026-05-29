import { supabase } from '../admin/common/adminApi.js';
import { initMap } from '../campus/map_core.js';
import { loadGraph } from '../campus/graph_manager.js';
import { drawPath, clearPath } from '../campus/renderer.js';

// 1. 초기화 및 상태 관리
const map = initMap('map');

const state = {
  graph: null,
  start: { type: null, id: null },
  end: { type: null, id: null },
  routes: [],
  activeRoute: 0,
  markers: [],
  lines: [],
  indoorNodes: [],
  buildings: []
};

const COST_ORDER = ['optimal', 'fastest', 'stairs_avoid'];

// DOM 요소 참조
const startToggle = document.getElementById('startToggle');
const endToggle = document.getElementById('endToggle');
const startBuildingSel = document.getElementById('startBuilding');
const endBuildingSel = document.getElementById('endBuilding');
const startIndoorSel = document.getElementById('startIndoorNode');
const endIndoorSel = document.getElementById('endIndoorNode');
const startIndoorBox = document.getElementById('startIndoorBox');
const endIndoorBox = document.getElementById('endIndoorBox');
const runBtn = document.getElementById('runRoute');
const resetBtn = document.getElementById('reset');
const indoorBtn = document.getElementById('viewIndoor');
const stepsBody = document.getElementById('stepsBody');
const statusEl = document.getElementById('status');

function setStatus(t) {
  if (statusEl) statusEl.innerText = t;
}

// 2. 앱 시작 및 초기화
init();

async function init() {
  try {
    const [graph, indoorRes, buildingRes] = await Promise.all([
      loadGraph(),
      supabase.from('indoor_nodes').select('id,name,building_id,floor_id'),
      supabase.from('buildings').select('*')
    ]);

    state.graph = graph;
    state.indoorNodes = indoorRes.data || [];
    state.buildings = buildingRes.data || [];

    bindUI();
    fillBuildingSelect();
    subscribeRealtime();

    setStatus('출발/도착 유형을 선택하세요');
  } catch (e) {
    console.error('Initialization Error:', e);
    setStatus('초기화 실패');
  }
}

// 3. UI 이벤트 바인딩
function bindUI() {
  if (indoorBtn) indoorBtn.onclick = openIndoorRoute;

  // 토글 버튼 (카드형 디자인 대응)
  startToggle.querySelectorAll('.toggle').forEach(el => {
    el.onclick = () => {
      startToggle.querySelectorAll('.toggle').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      state.start.type = el.dataset.type;
      state.start.id = null;
      toggleIndoorUI();
      renderOutdoor();
    };
  });

  endToggle.querySelectorAll('.toggle').forEach(el => {
    el.onclick = () => {
      endToggle.querySelectorAll('.toggle').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      state.end.type = el.dataset.type;
      state.end.id = null;
      toggleIndoorUI();
      renderOutdoor();
    };
  });

  startBuildingSel.onchange = e => fillIndoorNodes(e.target.value, startIndoorSel);
  endBuildingSel.onchange = e => fillIndoorNodes(e.target.value, endIndoorSel);

  startIndoorSel.onchange = e => { state.start.id = e.target.value || null; };
  endIndoorSel.onchange = e => { state.end.id = e.target.value || null; };

  runBtn.onclick = runRoute;
  resetBtn.onclick = resetAll;
}

// 4. 핵심 기능: 경로 계산 및 가이드 생성


/**
 * [최종 완성본] 거점 중심의 경로 가이드 생성 함수
 * 1. 첫 번째 노드는 무조건 '출발지'로 표시
 * 2. 마지막 노드는 무조건 '도착지'로 표시
 * 3. 중간 노드들은 '연결된 엣지가 8개 이상인 거점'이면서 '이름이 있는 경우'에만 표시
 */
function generateGuideText(path, nodeMap, nodeDegreeMap) {
  if (!path || path.length === 0) return '경로 정보가 없습니다.';

  // 1. 경로상의 모든 노드를 순회하며 필터링된 이름 배열 생성
  const meaningfulNodes = path.map((id, index) => {
    let targetId = id;
    const strId = String(id);

    // 'in_' 접두어 처리
    if (strId.startsWith('in_')) {
      targetId = strId.replace('in_', '');
    }

    // nodeMap에서 노드 검색
    const node = nodeMap.get(Number(targetId)) || nodeMap.get(targetId) || nodeMap.get(strId);
    if (!node) return null;

    // --- [핵심 로직: 시작/끝/거점 구분] ---
    const isStart = (index === 0);
    const isEnd = (index === path.length - 1);
    
    // 시작과 끝은 이름이 무엇이든 무조건 고유 명칭 부여
    if (isStart) return '출발지';
    if (isEnd) return '도착지';

    // 중간 노드들은 거점(Degree >= 8)이면서 이름이 있는 경우만 반환
    const degree = (nodeDegreeMap && nodeDegreeMap.get(strId)) || 0;
    const isHub = degree >= 8;
    const name = node.name ? node.name.trim() : null;

    if (isHub && name) {
      return name;
    }

    return null; // 거점이 아니거나 이름이 없으면 제외
  }).filter(name => name !== null); // null(필터링된 노드) 제거

  // 2. 결과가 없는 경우 예외 처리
  if (meaningfulNodes.length === 0) return '📍 경로를 계산 중입니다...';
  
  // 3. 중복 제거 (연속된 노드가 같은 이름을 가질 경우 대비)
  const uniqueNodes = meaningfulNodes.filter((name, idx) => name !== meaningfulNodes[idx - 1]);

  // 4. 최종 HTML 조립
  // [출발지] → [거점A] → [거점B] → [도착지]
  let result = `<span class="guide-node">${uniqueNodes[0]}</span>`;
  
  for (let i = 1; i < uniqueNodes.length; i++) {
    result += ` <span class="guide-arrow">→</span> <span class="guide-node">${uniqueNodes[i]}</span>`;
  }

  return result;
}


/**
 * 경로 유형 라벨링
 */
function label(t) {
  const labels = { 'optimal': '최적 경로', 'fastest': '최단 시간', 'stairs_avoid': '계단 회피' };
  return labels[t] || t;
}

async function runRoute() {
  if (!state.start.type || !state.end.type || !state.start.id || !state.end.id) {
    setStatus('출발지와 도착지를 모두 설정해주세요.');
    return;
  }

  setStatus('경로 계산 중...');
  clearPath(map, state.lines);
  state.lines = [];
  state.routes = [];

  // Worker를 이용한 비동기 경로 계산 (기존 로직 유지)
  const worker = new Worker('/js/campus/pathWorker.js', { type: 'module' });
  const routeMap = new Map();
  let finishedCount = 0;

  worker.onmessage = (e) => {
    const { path, mode, error } = e.data;
    if (error || !path) {
      routeMap.set(mode, { type: mode, disabled: true });
    } else {
      routeMap.set(mode, {
        type: mode,
        path,
        time: calcTime(path),
        disabled: false
      });
    }

    finishedCount++;
    if (finishedCount === COST_ORDER.length) {
      state.routes = COST_ORDER.map(t => routeMap.get(t) || { type: t, disabled: true });
      state.activeRoute = 0;
      
      // 첫 번째 경로(최적) 기본 활성화
      if (state.routes[0] && !state.routes[0].disabled) {
        setActive(0);
        // 실내 경로 데이터 저장
        const indoorSegs = splitPathByType(state.routes[0].path, state.graph.nodeMap).filter(s => s.type === 'indoor');
        if (indoorSegs.length) localStorage.setItem('indoorRoute', JSON.stringify(indoorSegs));
        if (indoorBtn) indoorBtn.disabled = false;
      }
      
      renderRoutes(); // 카드 UI 렌더링
      setStatus('경로 탐색 완료');
      worker.terminate();
    }
  };

  COST_ORDER.forEach(type => {
    worker.postMessage({
      graphObj: state.graph,
      start: state.start.id,
      end: state.end.id,
      mode: type
    });
  });
}

/**
 * 경로 카드 렌더링 (개선된 UI 대응)
 */
// map_outdoor.js 내부 renderRoutes 함수

function renderRoutes() {
  if (!stepsBody) return;
  stepsBody.innerHTML = '';
  
  state.routes.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = `route-card ${r.disabled ? 'disabled' : ''} ${i === state.activeRoute ? 'active' : ''}`;
    
    const header = document.createElement('div');
    header.innerHTML = r.disabled
      ? '<span style="color:#94a3b8;">❌ 이용 불가</span>'
      : `<b>${label(r.type)}</b> <span style="float:right; font-size:12px;">⏱ ${r.time}분</span>`;
    card.appendChild(header);

    if (i === state.activeRoute && !r.disabled) {
      const guide = document.createElement('div');
      guide.className = 'guide-text';
      
      // ✅ 수정된 호출 방식: nodeDegreeMap을 함께 전달
      // 만약 state.graph.nodeDegreeMap이 없다면 빈 Map을 전달하여 에러 방지
      const degreeMap = (state.graph && state.graph.nodeDegreeMap) ? state.graph.nodeDegreeMap : new Map();
      guide.innerHTML = generateGuideText(r.path, state.graph.nodeMap, degreeMap);
      
      card.appendChild(guide);
    }
    
    if (!r.disabled) {
      card.onclick = () => setActive(i);
    }
    stepsBody.appendChild(card);
  });
}


/**
 * 경로 선택 시 지도 및 UI 업데이트
 */
function setActive(i) {
  state.activeRoute = i;
  clearPath(map, state.lines);
  state.lines = [];

  const r = state.routes[i];
  if (r && !r.disabled) {
    const pathSet = new Set(r.path);
    renderOutdoor(pathSet);

    const outdoorSegs = splitPathByType(r.path, state.graph.nodeMap).filter(s => s.type === 'outdoor');
    for (const seg of outdoorSegs) {
      state.lines.push(...drawPath(map, seg.nodes, state.graph));
    }
    setStatus(`${label(r.type)} (${r.time}분)`);
  }
  renderRoutes();
}

// 5. 유틸리티 함수 (기존 로직 유지)

function calcTime(path) {
  if (!state.graph) return 0;
  let totalSec = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const e = state.graph.edgeMap.get(path[i] + '-' + path[i + 1]) || 
              state.graph.edgeMap.get(path[i + 1] + '-' + path[i]);
    if (!e) continue;
    const d = e.distance || 1;
    totalSec += d / 1.4; // 단순 계산 (실제 로직은 이전과 동일하게 구현 가능)
  }
  return Math.ceil(totalSec / 60);
}

function splitPathByType(path, nodeMap) {
  const segs = [];
  if (!path || path.length < 2) return segs;
  let current = [];
  let currentType = null;

  for (let i = 0; i < path.length - 1; i++) {
    const a = nodeMap.get(path[i]);
    const b = nodeMap.get(path[i + 1]);
    if (!a || !b) continue;

    const isOutdoor = a.type === 'outdoor' && b.type === 'outdoor';
    const segType = isOutdoor ? 'outdoor' : 'indoor';

    if (currentType !== segType) {
      if (current.length >= 2) segs.push({ type: currentType, nodes: current });
      currentType = segType;
      current = [path[i], path[i + 1]];
    } else {
      current.push(path[i + 1]);
    }
  }
  if (current.length >= 2) segs.push({ type: currentType, nodes: current });
  return segs;
}

function renderOutdoor(pathSet = null) {
  clearMarkers();
  if (!state.graph) return;
  state.graph.nodeMap.forEach(n => {
    if (n.type !== 'outdoor') return;
    const isStart = state.start.id === n.id;
    const isEnd = state.end.id === n.id;

    if (pathSet && !pathSet.has(n.id) && !isStart && !isEnd) return;

    const m = L.circleMarker([n.lat, n.lng], {
      radius: isStart || isEnd ? 9 : 6,
      color: isStart ? '#10b981' : isEnd ? '#f59e0b' : '#2563eb',
      weight: isStart || isEnd ? 3 : 2
    }).addTo(map);

    m.on('click', () => {
      if (state.start.type === 'outdoor' && !state.start.id) {
        state.start.id = n.id;
        setStatus('출발지 선택 완료');
      } else if (state.end.type === 'outdoor' && !state.end.id) {
        state.end.id = n.id;
        setStatus('도착지 선택 완료');
      }
      renderOutdoor(pathSet);
    });
    state.markers.push(m);
  });
}

function clearMarkers() {
  state.markers.forEach(m => map.removeLayer(m));
  state.markers = [];
}

/*
function clearPath(m, lines) {
  lines.forEach(l => m.removeLayer(l));
}
*/

function fillBuildingSelect() {
  [startBuildingSel, endBuildingSel].forEach(sel => {
    sel.innerHTML = '<option value="">건물 선택</option>';
    state.buildings.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.name;
      sel.appendChild(opt);
    });
  });
}

function fillIndoorNodes(buildingId, targetSel) {
  targetSel.innerHTML = '<option value="">노드 선택</option>';
  state.indoorNodes
    .filter(n => String(n.building_id) === String(buildingId) && n.name?.trim())
    .forEach(n => {
      const opt = document.createElement('option');
      opt.value = 'in_' + n.id;
      opt.textContent = n.name;
      targetSel.appendChild(opt);
    });
}

function openIndoorRoute() {
  if (localStorage.getItem('indoorRoute')) {
    location.href = '/html/campus/map_indoor.html';
  } else {
    setStatus('실내 경로 데이터가 없습니다.');
  }
}

function toggleIndoorUI() {
  startIndoorBox.style.display = state.start.type === 'indoor' ? 'block' : 'none';
  endIndoorBox.style.display = state.end.type === 'indoor' ? 'block' : 'none';
}

function resetAll() {
  state.start = { type: null, id: null };
  state.end = { type: null, id: null };
  state.routes = [];
  state.activeRoute = 0;
  clearPath(map, state.lines);
  state.lines = [];
  clearMarkers();
  if (stepsBody) stepsBody.innerHTML = '';
  startToggle.querySelectorAll('.toggle').forEach(x => x.classList.remove('active'));
  endToggle.querySelectorAll('.toggle').forEach(x => x.classList.remove('active'));
  if (indoorBtn) indoorBtn.disabled = true;
  toggleIndoorUI();
  setStatus('초기화 완료');
}

function subscribeRealtime() {
  supabase.channel('edges-update')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'outdoor_edges' }, () => {
      loadGraph().then(g => { state.graph = g; if(state.start.id && state.end.id) runRoute(); });
    })
    .subscribe();
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') resetAll(); });

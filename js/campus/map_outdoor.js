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
 * [핵심 요구사항] 공백 노드를 제외한 경로 상세 텍스트 생성
 */
/**
 * [사용자 제안 반영]
 * ID가 'in_'으로 시작하면 'in_'을 제거한 ID로, 
 * 아니면 원본 ID로 nodeMap에서 직접 찾아 이름을 가져옵니다.
 */
function generateGuideText(path, nodeMap) {
  if (!path || path.length === 0) return '경로 정보가 없습니다.';

  const validNodes = path
    .map(id => {
      let targetId = id;
      const strId = String(id);

      // 1. 'in_'이 붙어있다면 'in_'을 제거한 순수 ID만 추출
      if (strId.startsWith('in_')) {
        targetId = strId.replace('in_', '');
      }

      // 2. nodeMap에서 검색 (숫자형 ID와 문자열 ID 모두 대응)
      // 먼저 숫자형으로 시도해보고, 안되면 문자열로 시도
      let node = nodeMap.get(Number(targetId)) || nodeMap.get(targetId) || nodeMap.get(strId);

      // 3. 만약 위 방법으로도 못 찾았다면, 'in_'이 붙은 형태 그대로 다시 시도
      if (!node) {
        node = nodeMap.get(strId);
      }

      // 4. 노드가 있고 name이 있으면 반환, 아니면 null
      const name = (node && node.name) ? node.name.trim() : null;
      return name || null;
    })
    .filter(name => name !== null); // 이름이 없는 노드는 경로에서 제외

  if (validNodes.length === 0) return '이동 가능한 지점 명칭이 없습니다.';
  if (validNodes.length === 1) return `📍 ${validNodes[0]}`;

  // 5. 출발지 > 경유지 > 도착지 형식으로 조립
  // 출발지와 도착지는 이름이 없어도 '출발지', '도착지'로 표시하여 흐름 유지
  const startName = validNodes[0] || '출발지';
  const endName = validNodes[validNodes.length - 1] || '도착지';
  
  // 중간 경유지들 (이름이 있는 것들만)
  const middleNodes = validNodes.slice(1, -1);

  let result = `<span class="guide-node">${startName}</span>`;
  
  middleNodes.forEach(name => {
    result += ` <span class="guide-arrow">→</span> <span class="guide-node">${name}</span>`;
  });

  // 경로가 2개 이상의 노드로 구성되어 있다면 마지막에 도착지 연결
  if (path.length > 1) {
    result += ` <span class="guide-arrow">→</span> <span class="guide-node">${endName}</span>`;
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
function renderRoutes() {
  if (!stepsBody) return;
  stepsBody.innerHTML = '';

  state.routes.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = `route-card ${r.disabled ? 'disabled' : ''} ${i === state.activeRoute ? 'active' : ''}`;
    
    // 카드 상단: 타입 및 시간
    const header = document.createElement('div');
    header.innerHTML = r.disabled 
      ? '<span style="color:#94a3b8;">❌ 이용 불가</span>' 
      : `<b>${label(r.type)}</b> <span style="float:right; font-size:12px;">⏱ ${r.time}분</span>`;
    card.appendChild(header);

    // 카드 하단: 선택된 경우에만 상세 가이드(공백 제외 로직 적용) 표시
    if (i === state.activeRoute && !r.disabled) {
      const guide = document.createElement('div');
      guide.className = 'guide-text';
      guide.innerHTML = generateGuideText(r.path, state.graph.nodeMap);
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

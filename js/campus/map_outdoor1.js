import { supabase } from '../admin/common/adminApi.js';
import { initMap } from '../campus/map_core.js';
import { loadGraph } from '../campus/graph_manager.js';
import { drawPath, clearPath } from '../campus/renderer.js';

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

const stepsBody = document.getElementById('stepsBody');
const statusEl = document.getElementById('status');

const indoorBtn = document.getElementById('viewIndoor');
function setStatus(t) {
  if (statusEl) statusEl.innerText = t;
}

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

    setStatus('출발/도착 유형 선택');
  } catch (e) {
    console.error(e);
    setStatus('초기화 실패');
  }
}

function bindUI() {
  if (indoorBtn) {
    indoorBtn.onclick = openIndoorRoute;
  }

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

  startIndoorSel.onchange = e => {
    state.start.id = e.target.value || null;
  };

  endIndoorSel.onchange = e => {
    state.end.id = e.target.value || null;
  };

  runBtn.onclick = runRoute;
  resetBtn.onclick = resetAll;
}

function openIndoorRoute() {

  const indoorRaw =
    localStorage.getItem('indoorRoute');

  if (!indoorRaw) {
    setStatus('실내 경로 없음');
    return;
  }

  location.href =
    '/html/campus/map_indoor.html';
}

function toggleIndoorUI() {
  if (startIndoorBox) startIndoorBox.style.display = state.start.type === 'indoor' ? 'block' : 'none';
  if (endIndoorBox) endIndoorBox.style.display = state.end.type === 'indoor' ? 'block' : 'none';
}

function fillBuildingSelect() {
  [startBuildingSel, endBuildingSel].forEach(sel => {
    if (!sel) return;
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
  if (!targetSel) return;
  targetSel.innerHTML = '<option value="">노드 선택</option>';
  state.indoorNodes
    .filter(n =>
      String(n.building_id) === String(buildingId) &&
      n.name &&
      n.name.trim() !== ''
    )
    .forEach(n => {
      const opt = document.createElement('option');
      opt.value = 'in_' + n.id;
      opt.textContent = n.name || ('노드 ' + n.id);
      targetSel.appendChild(opt);
    });
}

/**
 * pathSet이 주어지면 해당 노드만 표시(경로 외 마커 제거)
 */
function renderOutdoor(pathSet = null) {
  clearMarkers();
  if (!state.graph) return;
  if (state.start.type !== 'outdoor' && state.end.type !== 'outdoor') return;

  state.graph.nodeMap.forEach(n => {
    if (n.type !== 'outdoor') return;

    const isStart = state.start.id === n.id;
    const isEnd = state.end.id === n.id;

    // 경로 안내 시 경로 외 노드는 표시하지 않음
    if (
      pathSet &&
      !pathSet.has(n.id) &&
      !isStart &&
      !isEnd
    ) {

      // outdoor path에 연결된 노드만 유지
      const connected = [...pathSet].some(pid => {

        const e1 = state.graph.edgeMap.get(pid + '-' + n.id);
        const e2 = state.graph.edgeMap.get(n.id + '-' + pid);

        const e = e1 || e2;

        return e && e.type === 'outdoor';
      });

      if (!connected) return;
    }

    const m = L.circleMarker([n.lat, n.lng], {
      radius: isStart || isEnd ? 9 : 6,
      color: isStart ? '#10b981' : isEnd ? '#f59e0b' : '#2563eb',
      weight: isStart || isEnd ? 3 : 2
    }).addTo(map);

    m.on('click', () => {
      if (state.start.type === 'outdoor' && !state.start.id) {
        state.start.id = n.id;
        setStatus('출발지 선택');
      } else if (state.end.type === 'outdoor' && !state.end.id) {
        state.end.id = n.id;
        setStatus('도착지 선택');
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

function splitPathByType(path, nodeMap) {

  const segs = [];

  if (!path || path.length < 2) {
    return segs;
  }

  let current = [];
  let currentType = null;

  for (let i = 0; i < path.length - 1; i++) {

    const a = nodeMap.get(path[i]);
    const b = nodeMap.get(path[i + 1]);

    if (!a || !b) continue;

    // outdoor ↔ outdoor 만 outdoor segment
    const isOutdoor =
      a.type === 'outdoor' &&
      b.type === 'outdoor';

    const segType = isOutdoor ? 'outdoor' : 'indoor';

    if (currentType !== segType) {

      if (current.length >= 2) {
        segs.push({
          type: currentType,
          nodes: current.slice()
        });
      }

      currentType = segType;
      current = [path[i], path[i + 1]];
    } else {

      current.push(path[i + 1]);
    }
  }

  if (current.length >= 2) {
    segs.push({
      type: currentType,
      nodes: current
    });
  }

  return segs;
}


let worker = null;
let isRouting = false;

function runRoute() {
  if (isRouting) return;

  if (!state.start.type || !state.end.type) {
    setStatus('유형 선택 필요');
    return;
  }

  if (!state.start.id || !state.end.id) {
    setStatus('지점 선택 필요');
    return;
  }

  isRouting = true;
  setStatus('경로 계산 중...');

  clearPath(map, state.lines);
  state.lines = [];
  state.routes = [];

  if (worker) {
    try { worker.terminate(); } catch (_) {}
    worker = null;
  }

  const TIMEOUT_MS = 8000;
  const routeMap = new Map();
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timerId);

    state.routes = COST_ORDER.map(t => routeMap.get(t) || ({ type: t, disabled: true }));
    state.activeRoute = 0;

    clearPath(map, state.lines);
    state.lines = [];

    const first = state.routes[0];

    if (first && !first.disabled) {
      const path = first.path;

      // 경로 노드만 표시
      const pathSet = new Set(path);
      renderOutdoor(pathSet);

      // outdoor 경로 그리기 (혼잡도/경사 색상 반영)
      const outdoorSegs =
        splitPathByType(path, state.graph.nodeMap)
          .filter(s => s.type === 'outdoor');

      for (const seg of outdoorSegs) {
        state.lines.push(
          ...drawPath(map, seg.nodes, state.graph)
  );
}

      // indoor 경로 전달
      const indoorSegs = splitPathByType(path, state.graph.nodeMap).filter(s => s.type === 'indoor');
      if (indoorSegs.length) {
        localStorage.setItem('indoorRoute', JSON.stringify(indoorSegs));
      }
      if (indoorBtn) {
        indoorBtn.disabled =
          indoorSegs.length === 0;
      }
      setStatus('경로 계산 완료');
    }

    renderRoutes();

    if (worker) {
      try { worker.terminate(); } catch (_) {}
      worker = null;
    }
    isRouting = false;
    
  };

  const fail = (msg) => {
    console.error(msg);
    setStatus(msg);
    clearTimeout(timerId);

    if (worker) {
      try { worker.terminate(); } catch (_) {}
      worker = null;
    }
    isRouting = false;
  };

  const timerId = setTimeout(() => {
    fail('경로 계산 시간 초과(Worker)');
  }, TIMEOUT_MS);

  try {
    worker = new Worker('/js/campus/pathWorker.js', { type: 'module' });
  } catch (e) {
    fail('Worker 생성 실패');
    return;
  }

  worker.onerror = (err) => {
    console.error('worker error:', err);
    fail('경로 계산 오류(Worker)');
  };

  worker.onmessage = (e) => {
    const { path, mode, error } = e.data || {};
    if (!mode) return;

    if (error || !path || !path.length) {
      routeMap.set(mode, { type: mode, disabled: true });
    } else {
      routeMap.set(mode, {
        type: mode,
        path,
        time: calcTime(path),
        disabled: false
      });
    }

    if (routeMap.size === COST_ORDER.length) finish();
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

function calcTime(path) {
  if (!state.graph || !state.graph.edgeMap) return 0;

  const edgeTime = (e) => {
    // subway는 거리/경사/혼잡 무시, 엣지당 6분
    if (e.edgeType === 'subway') return 6 * 60;

    const d = e.distance || 1;
    const slope = d ? (e.elevation_diff ?? 0) / d : 0;

    let speed = 1.4; // m/s 기준
    if (slope > 0) speed *= (1 - slope * 0.7);
    else if (slope < 0) speed *= (1 - slope * 0.3);
    if (speed < 0.5) speed = 0.5;

    let t = d / speed; // seconds
    if (e.edgeType === 'stairs') t *= 1.8;
    if (e.congestion != null) t *= (1 + e.congestion * 1.5);
    return t;
  };

  let totalSec = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const e = state.graph.edgeMap.get(path[i] + '-' + path[i + 1]) ||
              state.graph.edgeMap.get(path[i + 1] + '-' + path[i]);
    if (!e) continue;
    totalSec += edgeTime(e);
  }
  return Math.ceil(totalSec / 60); // minutes
}

function renderRoutes() {
  if (!stepsBody) return;
  stepsBody.innerHTML = '';

  state.routes.forEach((r, i) => {
    const div = document.createElement('div');
    div.className = 'routeBox' + (i === state.activeRoute ? ' active' : '');
    div.innerHTML = r.disabled ? '❌ 불가능' : '<b>' + label(r.type) + '</b><br>⏱ ' + r.time + '분';
    div.onclick = () => setActive(i);
    stepsBody.appendChild(div);
  });
}

function setActive(i) {
  state.activeRoute = i;
  clearPath(map, state.lines);
  state.lines = [];

  const r = state.routes[i];
  if (r && !r.disabled) {
    const path = r.path;
    const pathSet = new Set(path);
    renderOutdoor(pathSet);
    const outdoorSegs =
      splitPathByType(path, state.graph.nodeMap)
        .filter(s => s.type === 'outdoor');

    for (const seg of outdoorSegs) {
      state.lines.push(
        ...drawPath(map, seg.nodes, state.graph)
      );
    }
    setStatus(label(r.type) + ' (' + r.time + '분)');
  }

  renderRoutes();
}

function label(t) {
  if (t === 'optimal') return '최적';
  if (t === 'fastest') return '최단시간';
  if (t === 'stairs_avoid') return '계단회피';
  return t;
}

function subscribeRealtime() {
  supabase
    .channel('edges-update')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'outdoor_edges' }, () => reloadGraph())
    .subscribe();
}

async function reloadGraph() {
  try {
    state.graph = await loadGraph();
    if (state.start.id && state.end.id) runRoute();
  } catch (e) {
    console.error(e);
  }
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
  
  if (indoorBtn) {
    indoorBtn.disabled = true;
  }

  toggleIndoorUI();
  setStatus('초기화 완료');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') resetAll();
});

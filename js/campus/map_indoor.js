/* =========================================================
   IMPORT
========================================================= */
import { supabase } from '../admin/common/adminApi.js';
import { findPath } from './pathfinder.js';

/* =========================================================
   MAP
========================================================= */
const map = L.map('map', {
  crs: L.CRS.Simple,
  zoomControl: true,
  fadeAnimation: true
});

let imageLayer = null;

/* =========================================================
   GLOBAL STATE
========================================================= */
let mode = 'guide';
let buildings = [];
let floors = [];
let indoorEdges = [];
let nodes = [];
let allNodes = [];
let currentBuilding = null;
let currentFloorId = null;
let selectedMode = 'optimal';
let nodeStatusMap = new Map();
const edgeMap = new Map();
let routeLines = [];
let routeNodeMarkers = [];
let floorRouteSteps = [];
let currentFloorStepIndex = 0;

/* =========================================================
   UI ELEMENTS
========================================================= */
const heroSection = document.getElementById('hero-section');
const mainContent = document.getElementById('main-content');
const btnStart = document.getElementById('btn-start');
const btnMap = document.getElementById('btn-map');

const guidePanel = document.getElementById('guidePanel');
const routePanel = document.getElementById('routePanel'); // HTML 구조상 sidebar 내부에 포함되거나 별도 관리
const buildingSel = document.getElementById('buildingSel');
const floorSel = document.getElementById('floorSel');
const enterMap = document.getElementById('enterMap');
const buildingMini = document.getElementById('buildingMini');
const floorMini = document.getElementById('floorMini');
const closeRoutePanel = document.getElementById('closeRoutePanel');
const startFloor = document.getElementById('startFloor');
const endFloor = document.getElementById('endFloor');
const startNode = document.getElementById('startNode');
const endNode = document.getElementById('endNode');
const runRouteBtn = document.getElementById('runRoute');
const nextFloorBtn = document.getElementById('nextFloorBtn');
const floorOverlay = document.getElementById('floorOverlay');

/* =========================================================
   INIT & TRANSITION
========================================================= */
init();

async function init() {
  await loadBuildingsAndFloors();
  await loadAllNodes();
  await loadAllIndoorEdges();
  await loadNodeStatus();
  bindEvents();
  showGuide();
}

/**
 * Hero Section에서 메인 대시보드로의 고급 전환
 */
async function startService() {
  if (heroSection) heroSection.classList.add('fade-out');
  
  setTimeout(async () => {
    if (mainContent) mainContent.classList.add('fade-in');
    
    // 지도가 나타난 직후 크기 재조정
    setTimeout(() => {
      if (map) map.invalidateSize();
    }, 600);
  }, 1000);
}

/* =========================================================
   VIEW CONTROL
========================================================= */
function showGuide() {
  guidePanel.classList.remove('hidden');
  routePanel.classList.add('hidden');
}

function showMapUI() {
  guidePanel.classList.add('hidden');
  // 사이드바(routePanel)는 이미 화면에 있으므로 hidden만 해제하거나 표시
  routePanel.classList.remove('hidden'); 
}

/* =========================================================
   LOAD (기존 로직 완벽 보존)
========================================================= */
async function loadBuildingsAndFloors() {
  const [bRes, fRes] = await Promise.all([
    supabase.from('buildings').select('*').order('name'),
    supabase.from('floors').select('*').order('floor_number')
  ]);
  buildings = bRes.data || [];
  floors = fRes.data || [];
  fillSelect(buildingSel, buildings);
  fillSelect(buildingMini, buildings);
  fillFloorSelectByBuilding(buildingSel.value, floorSel);
}

async function loadAllNodes() {
  const { data } = await supabase.from('indoor_nodes').select('*');
  allNodes = data || [];
}

async function loadAllIndoorEdges() {
  const { data } = await supabase.from('indoor_edges').select('*');
  indoorEdges = data || [];
  buildEdgeMap();
}

async function loadNodeStatus() {
  const { data } = await supabase
    .from('node_status')
    .select('node_id, node_scope, last_congestion_level')
    .eq('node_scope', 'indoor');
  const m = new Map();
  (data || []).forEach(r => {
    m.set(Number(r.node_id), String(r.last_congestion_level || '').toUpperCase());
  });
  nodeStatusMap = m;
}

/* =========================================================
   SELECT HELPERS
========================================================= */
function fillSelect(sel, list) {
  if(!sel) return;
  sel.innerHTML = '<option value="">선택</option>';
  list.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.name;
    sel.appendChild(opt);
  });
}

function fillFloorSelectByBuilding(buildingId, sel) {
  if(!sel) return;
  sel.innerHTML = '<option value="">층 선택</option>';
  if (!buildingId) return;
  floors.filter(f => String(f.building_id) === String(buildingId)).forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = `${f.floor_number}층`;
    sel.appendChild(opt);
  });
}

function fillNodeSelectByFloor(floorId, sel) {
  if(!sel) return;
  sel.innerHTML = '<option value="">노드 선택</option>';
  if (!floorId) return;
  allNodes.filter(n => Number(n.floor_id) === Number(floorId)).filter(n => String(n.name || '').trim() !== '').forEach(n => {
    const opt = document.createElement('option');
    opt.value = n.id;
    opt.textContent = n.name;
    sel.appendChild(opt);
  });
}

/* =========================================================
   EVENTS
========================================================= */
function bindEvents() {
  // [추가] Hero 버튼 연동
  if (btnStart) btnStart.onclick = startService;
  if (btnMap) btnMap.onclick = () => { window.location.href = '/html/campus/map_outdoor.html'; };

  // 1. 가이드 패널: 지도 진입
  enterMap.onclick = async () => {
    if (!buildingSel.value || !floorSel.value) {
      alert('건물 및 층을 선택하세요.');
      return;
    }
    currentBuilding = Number(buildingSel.value);
    currentFloorId = Number(floorSel.value);
    showMapUI();
    await loadFloorAnimated();
    fillFloorSelectByBuilding(currentBuilding, startFloor);
    fillFloorSelectByBuilding(currentBuilding, endFloor);
    buildingMini.value = currentBuilding;
    floorMini.value = currentFloorId;
  };

  buildingSel.onchange = () => fillFloorSelectByBuilding(buildingSel.value, floorSel);

  // 3. 우측 패널 내 건물/층 변경 (위치 설정 영역)
  buildingMini.onchange = () => {
    // 건물이 바뀌면 해당 건물의 층 목록을 floorMini에 다시 채움
    fillFloorSelectByBuilding(buildingMini.value, floorMini);
  };

  floorMini.onchange = async () => {
    // [핵점] 위치가 바뀌면 다음 단계 순서로 진행
    
    // STEP 1: 기존 경로 및 시각적 데이터 삭제
    clearAllRouteData(); 

    // STEP 2: 현재 상태 업데이트
    currentBuilding = Number(buildingMini.value); // 건물을 명시적으로 업데이트
    currentFloorId = Number(floorMini.value);

    // STEP 3: [핵심] 바뀐 건물/층에 맞춰 출발/도착지 드롭다운 재생성
    // 1) 출발지/도착지의 '층' 목록을 현재 건물에 맞게 업데이트
    fillFloorSelectByBuilding(currentBuilding, startFloor);
    fillFloorSelectByBuilding(currentBuilding, endFloor);

    // 2) (선택 사항) 만약 현재 층이 출발지/도착지 층과 같다면 노드 목록까지 즉시 업데이트할 수 있음
    // 여기서는 사용자가 직접 층을 선택하도록 유도하기 위해 노드 목록은 비워둡니다.
    fillNodeSelectByFloor(null, startNode); 
    fillNodeSelectByFloor(null, endNode);

    // STEP 4: 새로운 층 평면도 로드
    await loadFloorAnimated();
  };

  closeRoutePanel.onclick = () => routePanel.classList.add('hidden');
  startFloor.onchange = () => fillNodeSelectByFloor(startFloor.value, startNode);
  endFloor.onchange = () => fillNodeSelectByFloor(endFloor.value, endNode);

  document.querySelectorAll('.modeBtn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.modeBtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMode = btn.dataset.mode;
    };
  });

  runRouteBtn.onclick = async () => {
    const startId = Number(startNode.value);
    const endId = Number(endNode.value);

    if (!startId || !endId) {
      alert('출발지/도착지를 선택하세요.');
      return;
    }

    const graphObj = buildGraphObj();
  
    // 1. selectedMode가 'avoid_stairs' 인지 정확히 확인 (pathfinder.js의 COST_MODE 키값과 일치해야 함)
    // pathfinder.js에는 'stairs_avoid'라고 되어 있음! 
    // 만약 UI의 버튼 data-mode가 'avoid_stairs'라면 키값이 불일치함.
    const modeToUse = selectedMode === 'avoid_stairs' ? 'stairs_avoid' : selectedMode;

    const route = findPath(graphObj, startId, endId, modeToUse);  

    // 2. 경로를 못 찾았을 경우 (계단 회피 모드에서 계단만 있는 경우 등)
    if (!route || route.length === 0) {
      alert('해당 모드로는 경로를 찾을 수 없습니다. (계단이 포함되어 있을 수 있습니다.)');
      return;
    }

    // 3. 경로가 있다면 정상 진행
    buildFloorRouteSteps(route);

    if (!floorRouteSteps.length) {
      alert('표시 가능한 경로가 없습니다.');
      return;
    }

    currentFloorStepIndex = 0;
    if (floorRouteSteps.length > 1) {
      nextFloorBtn.classList.remove('hidden');
    } else {
      nextFloorBtn.classList.add('hidden');
    }

    await goNextFloorStep();
  };

  nextFloorBtn.onclick = async () => await goNextFloorStep();

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    clearRoute();
    clearRouteNodeMarkers();
    nextFloorBtn.classList.add('hidden');
    floorOverlay.classList.add('hidden');
    floorRouteSteps = [];
    currentFloorStepIndex = 0;
  });
}

/* =========================================================
   FLOOR LOAD (기존 로직 유지)
========================================================= */
async function loadFloorAnimated() {
  if (imageLayer) imageLayer.setOpacity(0);
  setTimeout(async () => {
    await loadFloor();
    if (imageLayer) imageLayer.setOpacity(1);
  }, 180);
}

async function loadFloor() {
  const floor = floors.find(f => Number(f.id) === Number(currentFloorId));
  if (!floor) return;
  loadImage(floor.map_image_url);
  nodes = allNodes.filter(n => Number(n.floor_id) === Number(currentFloorId));
  renderNodes();
}

function loadImage(url) {
  if (imageLayer) map.removeLayer(imageLayer);
  const bounds = [[0, 0], [1000, 1000]];
  imageLayer = L.imageOverlay(url, bounds, { opacity: 0 }).addTo(map);
  map.fitBounds(bounds);
}

function renderNodes() {
  clearRouteNodeMarkers();
  nodes.forEach(n => {
    const name = String(n.name || '').trim();
    if (!name) return;
    const level = levelOfNode(n.id);
    const color = level === 'HIGH' ? '#ef4444' : '#111827';
    const marker = L.circleMarker([n.y, n.x], { radius: 5, color, fillColor: color, fillOpacity: 0.9 }).addTo(map);
    marker.bindTooltip(name);
    routeNodeMarkers.push(marker);
  });
}

function clearAllRouteData() {
  // 1. 지도 데이터 삭제
  clearRoute();
  clearRouteNodeMarkers();
  
  // 2. 경로 단계 및 인덱스 초기화
  floorRouteSteps = [];
  currentFloorStepIndex = 0;
  
  // 3. UI 초기화
  if (nextFloorBtn) nextFloorBtn.classList.add('hidden');
  if (floorOverlay) floorOverlay.classList.add('hidden');

  // 4. 출발/도착지 입력란 초기화 (이전 데이터 잔상 제거)
  if (startFloor) startFloor.innerHTML = '<option value="">선택</option>';
  if (endFloor) endFloor.innerHTML = '<option value="">선택</option>';
  if (startNode) startNode.innerHTML = '<option value="">선택</option>';
  if (endNode) endNode.innerHTML = '<option value="">선택</option>';
}



/* =========================================================
   GRAPH / ROUTE LOGIC (기존 로직 유지)
========================================================= */
function buildGraphObj() {
  const graph = new Map();
  const nodeMap = new Map();
  allNodes.forEach(n => { nodeMap.set(Number(n.id), { id: Number(n.id), lat: Number(n.y), lng: Number(n.x) }); });
  indoorEdges.forEach(e => {
    const from = Number(e.from_node);
    const to = Number(e.to_node);
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push({ to, edge: normalizeEdge(e) });
    if (e.direction === 'bidirectional' || e.is_bidirectional) {
      if (!graph.has(to)) graph.set(to, []);
      graph.get(to).push({ to: from, edge: normalizeEdge(e) });
    }
  });
  return { graph, nodeMap };
}

function normalizeEdge(e) {
  return { distance: e.distance || 1, elevation_diff: e.elevation_diff || 0, edgeType: e.type || 'walk', congestion: null };
}

function buildEdgeMap() {
  edgeMap.clear();
  indoorEdges.forEach(e => {
    const from = Number(e.from_node);
    const to = Number(e.to_node);
    edgeMap.set(`${from}-${to}`, e);
    edgeMap.set(`${to}-${from}`, e);
  });
}

function edgeByPair(a, b) { return edgeMap.get(`${a}-${b}`) || null; }

function buildFloorRouteSteps(route) {
  floorRouteSteps = [];
  const grouped = new Map();
  route.forEach(id => {
    const node = getNodeById(id);
    if (!node) return;
    const floorId = Number(node.floor_id);
    if (!grouped.has(floorId)) grouped.set(floorId, []);
    grouped.get(floorId).push(Number(id));
  });
  if (!route || route.length === 0) return;
  const startNodeId = route[0];
  const endNodeId = route[route.length - 1];
  const startFloorId = Number(getNodeById(startNodeId)?.floor_id);
  const endFloorId = Number(getNodeById(endNodeId)?.floor_id);
  grouped.forEach((nodeIds, floorId) => {
    const unique = [...new Set(nodeIds)];
    const isStartFloor = floorId === startFloorId;
    const isEndFloor = floorId === endFloorId;
    if (unique.length <= 1 && !isStartFloor && !isEndFloor) return;
    floorRouteSteps.push({ floorId, nodes: unique });
  });
  floorRouteSteps.sort((a, b) => {
    const aFirst = route.find(id => Number(getNodeById(id)?.floor_id) === a.floorId);
    const bFirst = route.find(id => Number(getNodeById(id)?.floor_id) === b.floorId);
    return route.indexOf(aFirst) - route.indexOf(bFirst);
  });
}

async function goNextFloorStep() {
  if (currentFloorStepIndex >= floorRouteSteps.length) {
    nextFloorBtn.classList.add('hidden');
    return;
  }
  const step = floorRouteSteps[currentFloorStepIndex];
  currentFloorId = Number(step.floorId);
  floorMini.value = currentFloorId;
  clearRoute();
  clearRouteNodeMarkers();
  await loadFloorAnimated();
  await drawFloorStepRoute(step.nodes);
  showFloorOverlay(currentFloorId);
  currentFloorStepIndex++;
  if (currentFloorStepIndex >= floorRouteSteps.length) nextFloorBtn.classList.add('hidden');
}

async function drawFloorStepRoute(route) {
  if (!map) return;
  
  // [추가] 계단 회피 모드인지 확인
  const isAvoidStairsMode = (selectedMode === 'avoid_stairs');

  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i+1];
    const edge = edgeByPair(a, b);

    if (!edge) continue;
    const from = getNodeById(a);
    const to = getNodeById(b);
    if (!from || !to || Number(from.floor_id) !== currentFloorId) continue;

    // [체크] 계단 회피 모드인데 계단(stairs) 경로가 포함되어 있는지 확인
    // (만약 findPath가 완벽하다면 이 조건에 걸리지 않아야 정상입니다)
    if (isAvoidStairsMode && edge.type === 'stairs') {
      console.warn("⚠️ 경고: 계단 회피 모드임에도 계단 경로가 포함되어 있습니다. 알고리즘을 확인하세요.");
    }

    const coords = [[from.y, from.x]];

    if (edge.path_points && edge.path_points.length) {
      let pts = [...edge.path_points];
      if (Number(edge.from_node) !== Number(a)) pts.reverse();
      pts.forEach(p => {
        coords.push(Array.isArray(p) ? [p[1], p[0]] : [p.y, p.x]);
      });
    }
    coords.push([to.y, to.x]);

    const type = edge.type || 'walk';
    
    // 색상 로직 유지 (계단은 빨간색, 엘리베이터는 보라색, 나머지는 파란색)
    let color = '#2563eb'; // 기본 walk
    if (type === 'stairs') color = '#ef4444';
    else if (type === 'elevator') color = '#8b5cf6';

    // [UI 개선] 계단 회피 모드일 때 계단 경로가 포함되었다면 점선(dashArray)으로 표시하여 경고 효과 부여
    const lineOptions = {
      color: color,
      weight: 6,
      opacity: 0.96
    };

    if (isAvoidStairsMode && type === 'stairs') {
      lineOptions.dashArray = '10, 10'; // 계단 경로는 점선으로 표시
      lineOptions.opacity = 0.5;       // 좀 더 흐릿하게
    }

    const line = L.polyline(coords, lineOptions).addTo(map);
    routeLines.push(line);
  }
}


function showFloorOverlay(floorId) {
  const floor = floors.find(f => Number(f.id) === Number(floorId));
  const text = floor?.floor_number ?? floorId;
  floorOverlay.innerHTML = `${text}층 이동`;
  floorOverlay.classList.remove('hidden');
  setTimeout(() => floorOverlay.classList.add('hidden'), 1500);
}

function clearRoute() {
  routeLines.forEach(l => map.removeLayer(l));
  routeLines = [];
}

function clearRouteNodeMarkers() {
  routeNodeMarkers.forEach(m => map.removeLayer(m));
  routeNodeMarkers = [];
}

function getNodeById(id) { return allNodes.find(n => Number(n.id) === Number(id)); }
function levelOfNode(nodeId) { return nodeStatusMap.get(Number(nodeId)) || null; }

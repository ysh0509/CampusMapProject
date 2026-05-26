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

// 현재 층에 표시된 노드만 저장
let nodes = [];

// 전체 노드 저장
let allNodes = [];

let currentBuilding = null;
let currentFloorId = null;
let selectedMode = 'optimal';

let nodeStatusMap = new Map();

const edgeMap = new Map();

let routeLines = [];
let routeNodeMarkers = [];

// 층 이동 step
let floorRouteSteps = [];

// 현재 step index
let currentFloorStepIndex = 0;

/* =========================================================
   UI
========================================================= */

const guidePanel =
  document.getElementById(
    'guidePanel'
  );

const controlCard =
  document.getElementById(
    'controlCard'
  );

const routePanel =
  document.getElementById(
    'routePanel'
  );

const buildingSel =
  document.getElementById(
    'buildingSel'
  );

const floorSel =
  document.getElementById(
    'floorSel'
  );

const enterMap =
  document.getElementById(
    'enterMap'
  );

const buildingMini =
  document.getElementById(
    'buildingMini'
  );

const floorMini =
  document.getElementById(
    'floorMini'
  );

const routeModeBtn =
  document.getElementById(
    'routeModeBtn'
  );

const closeRoutePanel =
  document.getElementById(
    'closeRoutePanel'
  );

const startFloor =
  document.getElementById(
    'startFloor'
  );

const endFloor =
  document.getElementById(
    'endFloor'
  );

const startNode =
  document.getElementById(
    'startNode'
  );

const endNode =
  document.getElementById(
    'endNode'
  );

const runRouteBtn =
  document.getElementById(
    'runRoute'
  );

const nextFloorBtn =
  document.getElementById(
    'nextFloorBtn'
  );

const floorOverlay =
  document.getElementById(
    'floorOverlay'
  );

/* =========================================================
   INIT
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

/* =========================================================
   GUIDE
========================================================= */

function showGuide() {

  guidePanel.classList.remove(
    'hidden'
  );

  controlCard.classList.add(
    'hidden'
  );

  routePanel.classList.add(
    'hidden'
  );
}

function showMapUI() {

  guidePanel.classList.add('hidden');

  routePanel.classList.remove('hidden'); 
}

/* =========================================================
   LOAD
========================================================= */

async function loadBuildingsAndFloors() {

  const [bRes, fRes] =
    await Promise.all([

      supabase
        .from('buildings')
        .select('*')
        .order('name'),

      supabase
        .from('floors')
        .select('*')
        .order('floor_number')
    ]);

  buildings = bRes.data || [];
  floors = fRes.data || [];

  fillSelect(
    buildingSel,
    buildings
  );

  fillSelect(
    buildingMini,
    buildings
  );

  fillFloorSelectByBuilding(
    buildingSel.value,
    floorSel
  );
}

async function loadAllNodes() {

  const { data } =
    await supabase
      .from('indoor_nodes')
      .select('*');

  allNodes = data || [];
}

async function loadAllIndoorEdges() {

  const { data } =
    await supabase
      .from('indoor_edges')
      .select('*');

  indoorEdges = data || [];

  buildEdgeMap();
}

async function loadNodeStatus() {

  const { data } =
    await supabase
      .from('node_status')
      .select(`
        node_id,
        node_scope,
        last_congestion_level
      `)
      .eq(
        'node_scope',
        'indoor'
      );

  const m = new Map();

  (data || []).forEach(r => {

    m.set(
      Number(r.node_id),
      String(
        r.last_congestion_level
        || ''
      ).toUpperCase()
    );
  });

  nodeStatusMap = m;
}

/* =========================================================
   SELECT
========================================================= */

function fillSelect(
  sel,
  list
) {

  sel.innerHTML =
    '<option value="">선택</option>';

  list.forEach(v => {

    const opt =
      document.createElement(
        'option'
      );

    opt.value = v.id;

    opt.textContent =
      v.name;

    sel.appendChild(opt);
  });
}

function fillFloorSelectByBuilding(
  buildingId,
  sel
) {

  sel.innerHTML =
    '<option value="">층 선택</option>';

  if (!buildingId) {

    return;
  }

  floors
    .filter(f =>
      String(f.building_id)
      === String(buildingId)
    )
    .forEach(f => {

      const opt =
        document.createElement(
          'option'
        );

      opt.value = f.id;

      opt.textContent =
        `${f.floor_number}층`;

      sel.appendChild(opt);
    });
}

function fillNodeSelectByFloor(
  floorId,
  sel
) {

  sel.innerHTML =
    '<option value="">노드 선택</option>';

  allNodes
    .filter(n =>
      Number(n.floor_id)
      === Number(floorId)
    )

    // 공백 노드 제거
    .filter(n => {

      const name =
        String(
          n.name || ''
        ).trim();

      return name !== '';
    })

    .forEach(n => {

      const opt =
        document.createElement(
          'option'
        );

      opt.value = n.id;

      opt.textContent =
        n.name;

      sel.appendChild(opt);
    });
}

/* =========================================================
   EVENTS (Updated for Integrated Route Panel)
========================================================= */
function bindEvents() {
  // 1. 가이드 패널: 지도 진입 로직
  enterMap.onclick = async () => {
    if (!buildingSel.value || !floorSel.value) {
      alert('건물 및 층을 선택하세요.');
      return;
    }

    // 상태 업데이트
    currentBuilding = Number(buildingSel.value);
    currentFloorId = Number(floorSel.value);

    // UI 전환: 가이드는 숨기고, 오른쪽 경로 패널을 표시
    showMapUI();

    // 지도 로드 및 초기 데이터 세팅
    await loadFloorAnimated();

    // 경로 탐색용 셀렉트 박스 초기화 (시작/도착지용)
    fillFloorSelectByBuilding(currentBuilding, startFloor);
    fillFloorSelectByBuilding(currentBuilding, endFloor);

    // 상단 미니 컨트롤(패널 내 위치 설정) 동기화
    buildingMini.value = currentBuilding;
    floorMini.value = currentFloorId;
  };

  // 2. 가이드 패널 내 건물/층 변경 시 층 목록 갱신
  buildingSel.onchange = () => {
    fillFloorSelectByBuilding(buildingSel.value, floorSel);
  };

  // 3. 우측 패널 내 건물/층 변경 (위치 설정 영역)
  buildingMini.onchange = () => {
    fillFloorSelectByBuilding(buildingMini.value, floorMini);
  };

  floorMini.onchange = async () => {
    currentFloorId = Number(floorMini.value);
    await loadFloorAnimated();
  };

  // 4. 경로 탐색 패널 제어
  /*
  routeModeBtn.onclick = () => {
    routePanel.classList.toggle('hidden');
  };
  */

  closeRoutePanel.onclick = () => {
    routePanel.classList.add('hidden');
  };

  // 5. 경로 탐색: 출발지/도착지 층/노드 연동
  startFloor.onchange = () => {
    fillNodeSelectByFloor(startFloor.value, startNode);
  };

  endFloor.onchange = () => {
    fillNodeSelectByFloor(endFloor.value, endNode);
  };

  // 6. 경로 탐색 모드 (최적 vs 계단회피)
  document.querySelectorAll('.modeBtn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.modeBtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMode = btn.dataset.mode;
    };
  });

  // 7. 경로 탐색 실행
  runRouteBtn.onclick = async () => {
    const startId = Number(startNode.value);
    const endId = Number(endNode.value);

    if (!startId || !endId) {
      alert('출발지/도착지를 선택하세요.');
      return;
    }

    const graphObj = buildGraphObj();
    const route = findPath(graphObj, startId, endId, selectedMode);

    if (!route || !route.length) {
      alert('경로를 찾을 수 없습니다.');
      return;
    }

    buildFloorRouteSteps(route);

    if (!floorRouteSteps.length) {
      alert('표시 가능한 경로가 없습니다.');
      return;
    }

    // 경로 탐색 시작 상태 설정
    currentFloorStepIndex = 0;

    // 다음 층 이동 버튼 노출 여부 결정
    if (floorRouteSteps.length > 1) {
      nextFloorBtn.classList.remove('hidden');
    } else {
      nextFloorBtn.classList.add('hidden');
    }

    await goNextFloorStep();
  };

  // 8. 다음 층 이동 버튼
  nextFloorBtn.onclick = async () => {
    await goNextFloorStep();
  };

  // 9. ESC 키: 경로 초기화
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
   FLOOR LOAD
========================================================= */

async function loadFloorAnimated() {

  if (imageLayer) {

    imageLayer.setOpacity(0);
  }

  setTimeout(async () => {

    await loadFloor();

    if (imageLayer) {

      imageLayer.setOpacity(1);
    }

  }, 180);
}

async function loadFloor() {

  const floor =
    floors.find(
      f =>
        Number(f.id)
        === Number(currentFloorId)
    );

  if (!floor) {

    return;
  }

  loadImage(
    floor.map_image_url
  );

  nodes =
    allNodes.filter(
      n =>
        Number(n.floor_id)
        === Number(currentFloorId)
    );

  renderNodes();
}

function loadImage(url) {

  if (imageLayer) {

    map.removeLayer(
      imageLayer
    );
  }

  const bounds = [
    [0,0],
    [1000,1000]
  ];

  imageLayer =
    L.imageOverlay(
      url,
      bounds,
      {
        opacity: 0
      }
    ).addTo(map);

  map.fitBounds(bounds);
}

/* =========================================================
   RENDER
========================================================= */

function renderNodes() {

  clearRouteNodeMarkers();

  nodes.forEach(n => {

    const name =
      String(
        n.name || ''
      ).trim();

    // 공백 노드 제외
    if (!name) {

      return;
    }

    const level =
      levelOfNode(n.id);

    const color =
      level === 'HIGH'
        ? '#ef4444'
        : '#111827';

    const marker =
      L.circleMarker(
        [n.y, n.x],
        {
          radius: 5,
          color,
          fillColor: color,
          fillOpacity: 0.9
        }
      ).addTo(map);

    marker.bindTooltip(name);

    routeNodeMarkers.push(
      marker
    );
  });
}

/* =========================================================
   GRAPH
========================================================= */

function buildGraphObj() {

  const graph =
    new Map();

  const nodeMap =
    new Map();

  allNodes.forEach(n => {

    nodeMap.set(
      Number(n.id),
      {
        id: Number(n.id),

        lat:
          Number(n.y),

        lng:
          Number(n.x)
      }
    );
  });

  indoorEdges.forEach(e => {

    const from =
      Number(e.from_node);

    const to =
      Number(e.to_node);

    if (
      !graph.has(from)
    ) {

      graph.set(
        from,
        []
      );
    }

    graph
      .get(from)
      .push({

        to,

        edge:
          normalizeEdge(e)
      });

    // 양방향
    if (
      e.direction
      === 'bidirectional'
      ||
      e.is_bidirectional
    ) {

      if (
        !graph.has(to)
      ) {

        graph.set(
          to,
          []
        );
      }

      graph
        .get(to)
        .push({

          to: from,

          edge:
            normalizeEdge(e)
        });
    }
  });

  return {
    graph,
    nodeMap
  };
}

function normalizeEdge(e) {

  return {

    distance:
      e.distance || 1,

    elevation_diff:
      e.elevation_diff || 0,

    edgeType:
      e.type || 'walk',

    congestion: null
  };
}

/* =========================================================
   EDGE MAP
========================================================= */

function buildEdgeMap() {

  edgeMap.clear();

  indoorEdges.forEach(e => {

    const from =
      Number(e.from_node);

    const to =
      Number(e.to_node);

    edgeMap.set(
      `${from}-${to}`,
      e
    );

    edgeMap.set(
      `${to}-${from}`,
      e
    );
  });
}

function edgeByPair(a,b) {

  return (
    edgeMap.get(
      `${a}-${b}`
    ) || null
  );
}

/* =========================================================
   FLOOR STEP
========================================================= */

function buildFloorRouteSteps(route) {

  floorRouteSteps = [];

  const grouped = new Map();

  route.forEach(id => {

    const node = getNodeById(id);
    if (!node) return;

    const floorId = Number(node.floor_id);

    if (!grouped.has(floorId)) {
      grouped.set(floorId, []);
    }

    grouped.get(floorId).push(Number(id));
  });

  if (!route || route.length === 0) return;

  const startNodeId = route[0];
  const endNodeId = route[route.length - 1];

  const startFloorId = Number(getNodeById(startNodeId)?.floor_id);
  const endFloorId = Number(getNodeById(endNodeId)?.floor_id);

  grouped.forEach((nodeIds, floorId) => {

    const unique = [...new Set(nodeIds)];

    // =====================================================
    // 핵심 규칙:
    // - 중간 경유층 단일 노드만 제거
    // - 시작층 / 도착층은 무조건 유지
    // =====================================================

    const isStartFloor = floorId === startFloorId;
    const isEndFloor = floorId === endFloorId;

    if (unique.length <= 1 && !isStartFloor && !isEndFloor) {
      return;
    }

    floorRouteSteps.push({
      floorId,
      nodes: unique
    });
  });

  // 정렬 (층 이동 순서 보장)
  floorRouteSteps.sort((a, b) => {

    const aFirst = route.find(id => Number(getNodeById(id)?.floor_id) === a.floorId);
    const bFirst = route.find(id => Number(getNodeById(id)?.floor_id) === b.floorId);

    return route.indexOf(aFirst) - route.indexOf(bFirst);
  });
}

async function goNextFloorStep() {

  if (
    currentFloorStepIndex
    >= floorRouteSteps.length
  ) {

    nextFloorBtn.classList.add(
      'hidden'
    );

    return;
  }

  const step =
    floorRouteSteps[
      currentFloorStepIndex
    ];

  currentFloorId =
    Number(
      step.floorId
    );

  floorMini.value =
    currentFloorId;

  // 기존 제거
  clearRoute();

  clearRouteNodeMarkers();

  await loadFloorAnimated();

  await drawFloorStepRoute(
    step.nodes
  );

  showFloorOverlay(
    currentFloorId
  );

  currentFloorStepIndex++;

  if (
    currentFloorStepIndex
    >= floorRouteSteps.length
  ) {

    nextFloorBtn.classList.add(
      'hidden'
    );
  }
}

/* =========================================================
   DRAW ROUTE
========================================================= */

async function drawFloorStepRoute(
  route
) {

  for (
    let i = 0;
    i < route.length - 1;
    i++
  ) {

    const a =
      route[i];

    const b =
      route[i+1];

    const edge =
      edgeByPair(a,b);

    if (!edge) {

      continue;
    }

    const from =
      getNodeById(a);

    const to =
      getNodeById(b);

    if (
      !from ||
      !to
    ) {

      continue;
    }

    // 다른 층 skip
    if (
      Number(from.floor_id)
      !== currentFloorId
    ) {

      continue;
    }

    const coords = [];

    coords.push([
      from.y,
      from.x
    ]);

    if (
      edge.path_points &&
      edge.path_points.length
    ) {

      let pts =
        edge.path_points;

      if (
        Number(edge.from_node)
        !== Number(a)
      ) {

        pts =
          pts
            .slice()
            .reverse();
      }

      pts.forEach(p => {

        if (
          Array.isArray(p)
        ) {

          coords.push([
            p[1],
            p[0]
          ]);

        } else {

          coords.push([
            p.y,
            p.x
          ]);
        }
      });
    }

    coords.push([
      to.y,
      to.x
    ]);

    const type =
      edge.type || 'walk';

    const color =
      type === 'stairs'
        ? '#ef4444'
        : type === 'elevator'
        ? '#8b5cf6'
        : '#2563eb';

    const line =
      L.polyline(
        coords,
        {
          color,
          weight: 6,
          opacity: 0.96
        }
      ).addTo(map);

    routeLines.push(
      line
    );
  }
}

/* =========================================================
   OVERLAY
========================================================= */

function showFloorOverlay(
  floorId
) {

  const floor =
    floors.find(
      f =>
        Number(f.id)
        === Number(floorId)
    );

  const text =
    floor?.floor_number
    ?? floorId;

  floorOverlay.innerHTML =
    `${text}층 이동`;

  floorOverlay.classList.remove(
    'hidden'
  );

  setTimeout(() => {

    floorOverlay.classList.add(
      'hidden'
    );

  }, 1500);
}

/* =========================================================
   CLEAR
========================================================= */

function clearRoute() {

  routeLines.forEach(l => {

    map.removeLayer(l);
  });

  routeLines = [];
}

function clearRouteNodeMarkers() {

  routeNodeMarkers.forEach(m => {

    map.removeLayer(m);
  });

  routeNodeMarkers = [];
}

/* =========================================================
   HELPERS
========================================================= */

function getNodeById(id) {

  return allNodes.find(
    n =>
      Number(n.id)
      === Number(id)
  );
}

function levelOfNode(
  nodeId
) {

  return (
    nodeStatusMap.get(
      Number(nodeId)
    ) || null
  );
}
import { protectPage } from '../common/adminRouterGuard.js';
import { initAdminHeader } from '../common/adminHeader.js';
import { supabase } from '../common/adminApi.js';
import { logAction } from '../common/adminLogger.js';


await protectPage();
initAdminHeader('outdoor');

// =========================
// MAP INIT
// =========================
const map = L.map('map').setView([37.5585, 126.9980], 18);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: 'OSM'
}).addTo(map);

// =========================
// STATE
// =========================
let nodes = [];
let edges = [];

let selectedNodes = [];
let waypoints = [];

let nodeMarkers = [];
let edgeLines = [];
let waypointMarkers = [];

let previewLine = null;

// =========================
// STATUS
// =========================
const statusEl = document.getElementById('status');
function setStatus(text) {
  if (statusEl) statusEl.innerText = text;
}

// =========================
// LOAD
// =========================
async function loadAll() {
  clearMap();

  const nodeRes = await supabase.from('outdoor_nodes').select('*');
  const edgeRes = await supabase.from('outdoor_edges').select('*');

  if (nodeRes.error) setStatus('노드 로드 실패');
  if (edgeRes.error) setStatus('엣지 로드 실패');

  nodes = nodeRes.data || [];
  edges = edgeRes.data || [];

  renderNodes();
  renderEdges();

  setStatus(`노드 ${nodes.length} / 엣지 ${edges.length}`);
}

loadAll();

// =========================
// CLEAR MAP
// =========================
function clearMap() {
  nodeMarkers.forEach(m => map.removeLayer(m));
  edgeLines.forEach(l => map.removeLayer(l));
  waypointMarkers.forEach(w => map.removeLayer(w));

  if (previewLine) map.removeLayer(previewLine);

  nodeMarkers = [];
  edgeLines = [];
  waypointMarkers = [];
  previewLine = null;
}

// =========================
// NODE RENDER
// =========================
function renderNodes() {
  nodes.forEach(n => {
    const isSelected = selectedNodes.includes(n.id);

    const marker = L.circleMarker([n.lat, n.lng], {
      radius: isSelected ? 8 : 6,
      color: isSelected ? '#f59e0b' : '#2563eb',
      weight: 2
    }).addTo(map);

    marker.bindTooltip(n.name || '');

    marker.on('mouseover', () => {
      marker.setStyle({ radius: 9 });
    });

    marker.on('mouseout', () => {
      marker.setStyle({
        radius: selectedNodes.includes(n.id) ? 8 : 6
      });
    });

    marker.on('click', () => handleNodeSelect(n));

    nodeMarkers.push(marker);
  });
}

// =========================
// EDGE RENDER
// =========================
function renderEdges() {
  const colorByType = {
    walk: '#10b981',
    stairs: '#ef4444',
    elevator: '#6366f1',
    escalator: '#f59e0b',
    subway: '#0bf5b3'
  };

  edges.forEach(e => {
    const from = nodes.find(n => n.id === e.from_node);
    const to = nodes.find(n => n.id === e.to_node);
    if (!from || !to) return;

    let latlngs = [[from.lat, from.lng]];
    if (Array.isArray(e.path_points)) {
      const pts = (e.direction === 'bidirectional' || e.from_node === from.id)
        ? e.path_points
        : [...e.path_points].reverse();
      latlngs = latlngs.concat(pts);
    }
    latlngs.push([to.lat, to.lng]);

    const line = L.polyline(latlngs, {
      color: colorByType[e.type] || (e.direction === 'one-way' ? 'red' : '#10b981'),
      weight: 4,
      dashArray: e.direction === 'one-way' ? '6,8' : null
    }).addTo(map);

    line.bindTooltip(e.name || '');
    line.on('click', () => openEdgeModal(e));

    edgeLines.push(line);
  });
}

// =========================
// NODE SELECT
// =========================
async function handleNodeSelect(node) {
  if (selectedNodes.includes(node.id)) {
    selectedNodes = selectedNodes.filter(id => id !== node.id);
  } else {
    selectedNodes.push(node.id);
  }

  setStatus(`선택 ${selectedNodes.length}/2`);
  updatePreview();

  if (selectedNodes.length === 2) {
    const ok = await createEdge();
    if (ok) {
      selectedNodes = [];
      waypoints = [];
      updatePreview();
      await loadAll();
    }
  }
}

// =========================
// PREVIEW LINE
// =========================
function updatePreview() {
  if (previewLine) {
    map.removeLayer(previewLine);
    previewLine = null;
  }

  const pts = selectedNodes
    .map(id => nodes.find(n => n.id === id))
    .filter(Boolean)
    .map(n => [n.lat, n.lng]);

  if (!pts.length) return;

  previewLine = L.polyline(pts, {
    color: '#f59e0b',
    dashArray: '6,10',
    weight: 3
  }).addTo(map);
}

// =========================
// WAYPOINT (CTRL CLICK)
// =========================
map.on('click', (e) => {
  if (!e.originalEvent.ctrlKey) return;

  const wp = [e.latlng.lat, e.latlng.lng];
  waypoints.push(wp);

  const marker = L.circleMarker(wp, {
    radius: 4,
    color: '#f59e0b'
  }).addTo(map);

  waypointMarkers.push(marker);

  setStatus(`waypoint ${waypoints.length}개`);
});

// =========================
// NODE CREATE (DOUBLE CLICK)
// =========================
map.on('dblclick', async (e) => {
  const name = prompt('노드 이름');
  if (!name) return;

  const elevation = prompt('고도 (m) - optional', '');

  const { error } = await supabase.from('outdoor_nodes').insert({
    name,
    lat: e.latlng.lat,
    lng: e.latlng.lng,
    elevation: elevation ? parseFloat(elevation) : null
  });

  if (error) {
    setStatus('노드 생성 실패');
    return;
  }

  await loadAll();
});


// =========================
// EDGE CREATE
// =========================
async function createEdge() {
  const from = nodes.find(n => n.id === selectedNodes[0]);
  const to = nodes.find(n => n.id === selectedNodes[1]);
  if (!from || !to) return false;

  const distance = calcEdgeDistance(from, to, waypoints);
  const elevation_diff = (from.elevation ?? 0) - (to.elevation ?? 0);
  const name = `${from.name} → ${to.name}`;

  const edgePayload = {
    from_node: from.id,
    to_node: to.id,
    name,
    distance,
    direction: 'bidirectional',
    path_points: waypoints?.length ? waypoints : null,
    elevation_diff
  };

  const { error } = await supabase.from('outdoor_edges').insert(edgePayload);

  if (error) {
    console.error('EDGE INSERT ERROR:', error);
    setStatus('엣지 생성 실패');
    return false;
  }

  // ✅ 생성 로그 기록
  await logAction({
    action: 'create',
    target_type: 'outdoor_edge',
    target_id: edgePayload.from_node, // 생성된 데이터의 식별자로 활용
    description: `신규 엣지 생성: ${name}`,
    after: edgePayload
  });

  setStatus('엣지 생성 완료');
  return true;
}

// =========================
// EDGE MODAL
// =========================
async function openEdgeModal(edge) {
  const action = prompt(
    `EDGE: ${edge.name}\r\r${edge.id}\n1: 수정\r\n2: 삭제\r\n3: 타입 변경 (walk / stairs / elevator / escalator / subway)`
  );

  if (action === '2') { // 삭제
    const { error } = await supabase.from('outdoor_edges')
      .delete()
      .eq('id', edge.id);

    if (!error) {
      // ✅ 삭제 로그 기록
      await logAction({
        action: 'delete',
        target_type: 'outdoor_edge',
        target_id: edge.id,
        description: `엣지 삭제: ${edge.name}`,
        before: edge
      });
    } else {
      setStatus('삭제 실패');
      return;
    }
    await loadAll();
    return;
  }

  if (action === '1') { // 수정
    const oldData = { ...edge }; // ✅ 변경 전 데이터 보관
    const name = prompt('이름', edge.name);
    const distance = parseFloat(prompt('거리', edge.distance));
    const direction = prompt('direction (bidirectional/one-way)', edge.direction);

    const { error } = await supabase.from('outdoor_edges')
      .update({ name, distance, direction })
      .eq('id', edge.id);

    if (!error) {
      // ✅ 수정 로그 기록
      await logAction({
        action: 'update',
        target_type: 'outdoor_edge',
        target_id: edge.id,
        description: `엣지 정보 수정: ${name}`,
        before: oldData,
        after: { name, distance, direction }
      });
    } else {
      setStatus('수정 실패');
      return;
    }
    await loadAll();
    return;
  }

  if (action === '3') { // 타입 변경
    const type = prompt(
      'type 입력 (walk / stairs / elevator / escalator / subway)',
      edge.type || 'walk'
    );
    const valid = ['walk', 'stairs', 'elevator', 'escalator', 'subway'];

    if (!valid.includes(type)) {
      setStatus('잘못된 type');
      return;
    }

    const { error } = await supabase
      .from('outdoor_edges')
      .update({ type })
      .eq('id', edge.id);

    if (!error) {
      // ✅ 타입 변경 로그 기록
      await logAction({
        action: 'update_type',
        target_type: 'outdoor_edge',
        target_id: edge.id,
        description: `엣지 타입 변경: ${edge.type} -> ${type}`,
        before: { type: edge.type },
        after: { type: type }
      });
    } else {
      console.error(error);
      setStatus('type 변경 실패');
      return;
    }

    setStatus('type 변경 완료');
    await loadAll();
  }
}



// =========================
// ESC RESET
// =========================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    selectedNodes = [];
    waypoints = [];

    if (previewLine) {
      map.removeLayer(previewLine);
      previewLine = null;
    }

    setStatus('초기화');
    loadAll();
  }
});

// =========================
// DISTANCE (단순 구면)
// =========================
function calcDistance(a, b) {
  const R = 6371000;
  const φ1 = a.lat * Math.PI / 180;
  const φ2 = b.lat * Math.PI / 180;
  const Δφ = (b.lat - a.lat) * Math.PI / 180;
  const Δλ = (b.lng - a.lng) * Math.PI / 180;

  const x =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// path_points 포함 누적 거리
function calcEdgeDistance(from, to, pathPoints = []) {
  const seq = [
    [from.lat, from.lng],
    ...pathPoints.map(p => Array.isArray(p) ? p : [p.lat, p.lng]),
    [to.lat, to.lng]
  ];
  let d = 0;
  for (let i = 0; i < seq.length - 1; i++) {
    d += calcDistance(
      { lat: seq[i][0], lng: seq[i][1] },
      { lat: seq[i + 1][0], lng: seq[i + 1][1] }
    );
  }
  return d;
}

import { protectPage } from '../../js/admin/common/adminRouterGuard.js';
import { initAdminHeader } from '../../js/admin/common/adminHeader.js';
import { supabase } from '../../js/admin/common/adminApi.js';

await protectPage();
initAdminHeader('vision2NE');

const $ = (id) => document.getElementById(id);

const el = {
  cameraId: $('camera_id'),
  targetType: $('target_type'),
  nodeScope: $('node_scope'),
  selectedTarget: $('selected_target'),
  buildingId: $('building_id'),
  floorId: $('floor_id'),
  roiJson: $('roi_json'),
  btnNew: $('btn_new'),
  btnSave: $('btn_save'),
  btnDelete: $('btn_delete'),
  status: $('status'),
  mapList: $('map_list'),
  floorImg: $('floor-img'),
  floorSvg: $('floor-svg')
};
const outdoorPanel = document.getElementById('outdoor-map')?.closest('.panel');
const indoorPanel = document.getElementById('floor-img')?.closest('.panel');


let editId = null;
let selectedNodeId = null;
let selectedEdgeId = null;

let buildings = [];
let floors = [];
let indoorNodes = [];
let indoorEdges = [];
let outdoorNodes = [];
let outdoorEdges = [];
let mappings = [];

let map;
let outdoorNodeLayer;
let outdoorEdgeLayer;

function setStatus(msg, ok = true) {
  el.status.textContent = msg;
  el.status.style.color = ok ? '#16a34a' : '#dc2626';
}

function toggleScopePanels() {
  const indoor = el.nodeScope.value === 'indoor';

  if (indoor) {
    outdoorPanel.style.display = 'none';
    indoorPanel.style.display = '';
    indoorPanel.classList.add('full');
    outdoorPanel.classList.remove('full');
  } else {
    indoorPanel.style.display = 'none';
    outdoorPanel.style.display = '';
    outdoorPanel.classList.add('full');
    indoorPanel.classList.remove('full');
    setTimeout(() => { if (map) map.invalidateSize(); }, 80);
  }
}


function clearForm() {
  editId = null;
  selectedNodeId = null;
  selectedEdgeId = null;
  el.targetType.value = 'node';
  el.nodeScope.value = 'outdoor';
  el.selectedTarget.value = '';
  el.buildingId.value = '';
  el.floorId.innerHTML = '<option value="">층 선택</option>';
  el.roiJson.value = '';
  setStatus('ready');
  refreshMapVisibility();
  renderIndoorOverlay();
}

function parseRoiOrNull(text) {
  const t = (text || '').trim();
  if (!t) return null;
  return JSON.parse(t);
}

function currentSelectedId() {
  return el.targetType.value === 'node' ? selectedNodeId : selectedEdgeId;
}

function syncSelectedTargetInput() {
  el.selectedTarget.value = currentSelectedId() ?? '';
}

function isIndoor() {
  return el.nodeScope.value === 'indoor';
}

function refreshMapVisibility() {
  toggleScopePanels();
}


function getLineFromNodes(edge, nodesById) {
  const a = nodesById[edge.from_node];
  const b = nodesById[edge.to_node];
  if (!a || !b) return null;
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

function distancePointToSegment(px, py, x1, y1, x2, y2) {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let t = lenSq ? dot / lenSq : -1;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const xx = x1 + t * C;
  const yy = y1 + t * D;
  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

async function loadCameras() {
  const { data, error } = await supabase.from('camera_profiles').select('camera_id,name').order('camera_id');
  if (error) return setStatus(`camera_profiles 로드 실패: ${error.message}`, false);
  el.cameraId.innerHTML = (data || []).map(c => `<option value="${c.camera_id}">${c.camera_id}${c.name ? ` (${c.name})` : ''}</option>`).join('');
}

async function loadBuildingsFloors() {
  const [bRes, fRes] = await Promise.all([
    supabase.from('buildings').select('id,name').order('id'),
    supabase.from('floors').select('id,building_id,floor_number,map_image_url').order('id')
  ]);
  if (bRes.error) return setStatus(`buildings 로드 실패: ${bRes.error.message}`, false);
  if (fRes.error) return setStatus(`floors 로드 실패: ${fRes.error.message}`, false);

  buildings = bRes.data || [];
  floors = fRes.data || [];

  el.buildingId.innerHTML = '<option value="">건물 선택</option>' + buildings.map(b => `<option value="${b.id}">${b.id} - ${b.name}</option>`).join('');
}

function renderFloorOptions(buildingId) {
  const list = floors.filter(f => String(f.building_id) === String(buildingId));
  el.floorId.innerHTML = '<option value="">층 선택</option>' + list.map(f => `<option value="${f.id}">${f.floor_number}층 (id:${f.id})</option>`).join('');
}

async function loadOutdoorData() {
  const [nRes, eRes] = await Promise.all([
    supabase.from('outdoor_nodes').select('*'),
    supabase.from('outdoor_edges').select('*')
  ]);
  if (nRes.error) return setStatus(`outdoor_nodes 로드 실패: ${nRes.error.message}`, false);
  if (eRes.error) return setStatus(`outdoor_edges 로드 실패: ${eRes.error.message}`, false);

  outdoorNodes = nRes.data || [];
  outdoorEdges = eRes.data || [];
  drawOutdoorLayers();
}

function initOutdoorMap() {
  map = L.map('outdoor-map').setView([37.5665, 126.9780], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20 }).addTo(map);
  outdoorNodeLayer = L.layerGroup().addTo(map);
  outdoorEdgeLayer = L.layerGroup().addTo(map);
}

function drawOutdoorLayers() {
  outdoorNodeLayer.clearLayers();
  outdoorEdgeLayer.clearLayers();

  const nodeMap = {};
  outdoorNodes.forEach(n => { nodeMap[n.id] = n; });

  outdoorNodes.forEach(n => {
    const marker = L.circleMarker([n.lat, n.lng], {
      radius: 6,
      color: '#2563eb',
      fillColor: '#2563eb',
      fillOpacity: 0.9
    }).addTo(outdoorNodeLayer);

    marker.bindTooltip(`node ${n.id} ${n.name || ''}`);

    marker.on('click', () => {
      if (el.nodeScope.value !== 'outdoor' || el.targetType.value !== 'node') return;
      selectedNodeId = n.id;
      selectedEdgeId = null;
      syncSelectedTargetInput();
      setStatus(`outdoor node 선택: ${n.id}`);
    });
  });

  outdoorEdges.forEach(e => {
    const a = nodeMap[e.from_node];
    const b = nodeMap[e.to_node];
    if (!a || !b) return;

    const line = L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
      color: '#f59e0b',
      weight: 4
    }).addTo(outdoorEdgeLayer);

    line.bindTooltip(`edge ${e.id}`);

    line.on('click', () => {
      if (el.nodeScope.value !== 'outdoor' || el.targetType.value !== 'edge') return;
      selectedEdgeId = e.id;
      selectedNodeId = null;
      syncSelectedTargetInput();
      setStatus(`outdoor edge 선택: ${e.id}`);
    });
  });

  if (outdoorNodes.length) {
    const bounds = L.latLngBounds(outdoorNodes.map(n => [n.lat, n.lng]));
    map.fitBounds(bounds.pad(0.2));
  }
}

async function loadIndoorData() {
  const floorId = el.floorId.value;
  if (!floorId) {
    indoorNodes = [];
    indoorEdges = [];
    renderIndoorOverlay();
    return;
  }

  const floor = floors.find(f => String(f.id) === String(floorId));
  el.floorImg.src = floor?.map_image_url || '';

  const [nRes, eRes] = await Promise.all([
    supabase.from('indoor_nodes').select('*').eq('floor_id', floorId),
    supabase.from('indoor_edges').select('*')
  ]);
  if (nRes.error) return setStatus(`indoor_nodes 로드 실패: ${nRes.error.message}`, false);
  if (eRes.error) return setStatus(`indoor_edges 로드 실패: ${eRes.error.message}`, false);

  indoorNodes = nRes.data || [];
  const nodeIdSet = new Set(indoorNodes.map(n => n.id));
  indoorEdges = (eRes.data || []).filter(e => nodeIdSet.has(e.from_node) && nodeIdSet.has(e.to_node));

  renderIndoorOverlay();
}

function renderIndoorOverlay() {
  const svg = el.floorSvg;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const img = el.floorImg;
  const w = img.clientWidth || 1000;
  const h = img.clientHeight || 600;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  if (!indoorNodes.length) return;

  const xs = indoorNodes.map(n => n.x);
  const ys = indoorNodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 30;

  const tx = (x) => {
    if (maxX === minX) return w / 2;
    return pad + ((x - minX) / (maxX - minX)) * (w - pad * 2);
  };
  const ty = (y) => {
    if (maxY === minY) return h / 2;
    return pad + ((y - minY) / (maxY - minY)) * (h - pad * 2);
  };

  const nodeMap = {};
  indoorNodes.forEach(n => { nodeMap[n.id] = n; });

  indoorEdges.forEach(e => {
    const g = getLineFromNodes(e, nodeMap);
    if (!g) return;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', tx(g.x1));
    line.setAttribute('y1', ty(g.y1));
    line.setAttribute('x2', tx(g.x2));
    line.setAttribute('y2', ty(g.y2));
    line.setAttribute('stroke', '#ef4444');
    line.setAttribute('stroke-width', '4');
    line.style.cursor = 'pointer';
    line.addEventListener('click', () => {
      if (!isIndoor() || el.targetType.value !== 'edge') return;
      selectedEdgeId = e.id;
      selectedNodeId = null;
      syncSelectedTargetInput();
      setStatus(`indoor edge 선택: ${e.id}`);
    });
    svg.appendChild(line);
  });

  indoorNodes.forEach(n => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', tx(n.x));
    c.setAttribute('cy', ty(n.y));
    c.setAttribute('r', '7');
    c.setAttribute('fill', '#22c55e');
    c.style.cursor = 'pointer';
    c.addEventListener('click', () => {
      if (!isIndoor() || el.targetType.value !== 'node') return;
      selectedNodeId = n.id;
      selectedEdgeId = null;
      syncSelectedTargetInput();
      setStatus(`indoor node 선택: ${n.id}`);
    });
    svg.appendChild(c);
  });

  if (isIndoor() && el.targetType.value === 'edge') {
    svg.addEventListener('click', (ev) => {
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX;
      pt.y = ev.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());

      let best = null;
      let bestDist = Infinity;
      indoorEdges.forEach(e => {
        const g = getLineFromNodes(e, nodeMap);
        if (!g) return;
        const d = distancePointToSegment(
          p.x, p.y,
          tx(g.x1), ty(g.y1),
          tx(g.x2), ty(g.y2)
        );
        if (d < bestDist) {
          bestDist = d;
          best = e;
        }
      });

      if (best && bestDist < 18) {
        selectedEdgeId = best.id;
        selectedNodeId = null;
        syncSelectedTargetInput();
        setStatus(`indoor edge 근접선택: ${best.id}`);
      }
    }, { once: true });
  }
}

async function loadMappings() {
  const { data, error } = await supabase
    .from('camera_node_map')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) return setStatus(`camera_node_map 로드 실패: ${error.message}`, false);
  mappings = data || [];

  el.mapList.innerHTML = mappings.map(m => {
    const target = m.target_type === 'node' ? `node:${m.node_id ?? '-'}` : `edge:${m.edge_id ?? '-'}`;
    return `<div class="item ${editId === m.id ? 'active' : ''}" data-id="${m.id}">
      <b>${m.camera_id}</b> | ${m.node_scope} | ${m.target_type} | ${target}<br/>
      <span class="muted">building:${m.building_id ?? '-'} floor:${m.floor_id ?? '-'}</span>
    </div>`;
  }).join('');

  el.mapList.querySelectorAll('.item').forEach(node => {
    node.onclick = async () => {
      const id = Number(node.dataset.id);
      const m = mappings.find(x => x.id === id);
      if (!m) return;

      editId = m.id;
      el.cameraId.value = m.camera_id;
      el.targetType.value = m.target_type;
      el.nodeScope.value = m.node_scope;
      selectedNodeId = m.node_id ?? null;
      selectedEdgeId = m.edge_id ?? null;
      syncSelectedTargetInput();

      if (m.building_id) {
        el.buildingId.value = String(m.building_id);
        renderFloorOptions(m.building_id);
      }
      if (m.floor_id) {
        el.floorId.value = String(m.floor_id);
        await loadIndoorData();
      }

      el.roiJson.value = m.roi_json ? JSON.stringify(m.roi_json, null, 2) : '';
      setStatus(`매핑 선택: ${m.id}`);
      refreshMapVisibility();
    };
  });
}

async function saveMapping() {
  const camera_id = el.cameraId.value;
  const target_type = el.targetType.value;
  const node_scope = el.nodeScope.value;
  const selected = currentSelectedId();

  if (!camera_id) return setStatus('카메라 선택 필요', false);
  if (!selected) return setStatus('노드/엣지를 먼저 선택하세요', false);

  let roi_json = null;
  try {
    roi_json = parseRoiOrNull(el.roiJson.value);
  } catch {
    return setStatus('roi_json JSON 형식 오류', false);
  }

  const payload = {
    camera_id,
    target_type,
    node_scope,
    node_id: target_type === 'node' ? Number(selected) : null,
    edge_id: target_type === 'edge' ? Number(selected) : null,
    building_id: node_scope === 'indoor' && el.buildingId.value ? Number(el.buildingId.value) : null,
    floor_id: node_scope === 'indoor' && el.floorId.value ? Number(el.floorId.value) : null,
    roi_json,
    updated_at: new Date().toISOString()
  };

  if (editId) {
    const { error } = await supabase.from('camera_node_map').update(payload).eq('id', editId);
    if (error) return setStatus(`수정 실패: ${error.message}`, false);
    setStatus('수정 완료');
  } else {
    const { error } = await supabase.from('camera_node_map').insert(payload);
    if (error) return setStatus(`저장 실패: ${error.message}`, false);
    setStatus('저장 완료');
  }

  await loadMappings();
}

async function deleteMapping() {
  if (!editId) return setStatus('삭제할 매핑 선택 필요', false);
  if (!confirm(`삭제할까요? id=${editId}`)) return;

  const { error } = await supabase.from('camera_node_map').delete().eq('id', editId);
  if (error) return setStatus(`삭제 실패: ${error.message}`, false);

  setStatus('삭제 완료');
  clearForm();
  await loadMappings();
}

function bindEvents() {
  el.btnNew.onclick = clearForm;
  el.btnSave.onclick = saveMapping;
  el.btnDelete.onclick = deleteMapping;

  el.nodeScope.onchange = () => {
    selectedNodeId = null;
    selectedEdgeId = null;
    syncSelectedTargetInput();
    refreshMapVisibility();
    renderIndoorOverlay();
  };

  el.targetType.onchange = () => {
    selectedNodeId = null;
    selectedEdgeId = null;
    syncSelectedTargetInput();
  };

  el.buildingId.onchange = () => {
    renderFloorOptions(el.buildingId.value);
    el.floorId.value = '';
    indoorNodes = [];
    indoorEdges = [];
    renderIndoorOverlay();
  };

  el.floorId.onchange = async () => {
    await loadIndoorData();
  };

  el.floorImg.onload = () => {
    renderIndoorOverlay();
  };
}

async function init() {
  bindEvents();
  initOutdoorMap();

  await Promise.all([
    loadCameras(),
    loadBuildingsFloors(),
    loadOutdoorData(),
    loadMappings()
  ]);

  clearForm();
  setStatus('초기화 완료');
  setStatus('초기화 완료');
}

init();

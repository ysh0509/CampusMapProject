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
  btnNew: $('btn_new'),
  btnSave: $('btn_save'),
  btnDelete: $('btn_delete'),
  status: $('status'),
  mapList: $('map_list'),
  mappingCount: $('mapping_count'),
  outdoorContainer: $('outdoor-container'),
  indoorContainer: $('indoor-container'),
  outdoorMap: $('outdoor-map'),
  indoorMap: $('indoor-map')
};

// --- State Management ---
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

let outdoorMap, indoorMap;
let outdoorNodeLayer, outdoorEdgeLayer;
let indoorNodeLayer, indoorEdgeLayer, indoorImageLayer;

// --- Utilities ---
function setStatus(msg, ok = true) {
  el.status.textContent = msg;
  el.status.style.color = ok ? '#10b981' : '#ef4444';
  el.status.style.background = ok ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';
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

// --- Map Initialization ---


// --- Indoor Map 초기화 (안정성 강화) ---
function initIndoorMap() {
  if (indoorMap) return;

  try {
    indoorMap = L.map('indoor-map', {
      crs: L.CRS.Simple,
      zoomControl: true,
      attributionControl: false
    });
    
    // 에러 방지를 위한 초기 뷰 설정
    indoorMap.setView([0, 0], 1);

    // 레이어 그룹 생성
    indoorNodeLayer = L.layerGroup().addTo(indoorMap);
    indoorEdgeLayer = L.layerGroup().addTo(indoorMap);
    
    // 빈 이미지 레이어 (좌표계 기준 설정)
    indoorImageLayer = L.imageOverlay('', [[0, 0], [1000, 1000]]).addTo(indoorMap); 
    
    console.log("✅ Indoor map initialized with stable view.");
  } catch (e) {
    console.error("❌ Failed to initialize indoor map:", e);
    indoorMap = null;
  }
}


function initOutdoorMap() {
  if (outdoorMap) return;
  outdoorMap = L.map('outdoor-map').setView([37.5665, 126.9780], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap'
  }).addTo(outdoorMap);
  outdoorNodeLayer = L.layerGroup().addTo(outdoorMap);
  outdoorEdgeLayer = L.layerGroup().addTo(outdoorMap);
}

function toggleScopePanels() {
  const indoor = isIndoor();
  if (indoor) {
    el.outdoorContainer.style.display = 'none';
    el.indoorContainer.style.display = 'block';
    setTimeout(() => {
      if (!indoorMap) initIndoorMap();
      if (indoorMap) {
        indoorMap.invalidateSize();
        if (el.floorId.value) loadIndoorData();
      }
    }, 250);
  } else {
    el.indoorContainer.style.display = 'none';
    el.outdoorContainer.style.display = 'block';
    setTimeout(() => { if (outdoorMap) outdoorMap.invalidateSize(); }, 250);
  }
}

// --- Data Loading ---
async function loadCameras() {
  const { data, error } = await supabase.from('camera_profiles').select('camera_id,name').order('camera_id');
  if (error) return setStatus(`Camera load failed: ${error.message}`, false);
  el.cameraId.innerHTML = (data || []).map(c => `<option value="${c.camera_id}">${c.camera_id}${c.name ? ` (${c.name})` : ''}</option>`).join('');
}

async function loadBuildingsFloors() {
  const [bRes, fRes] = await Promise.all([
    supabase.from('buildings').select('id,name').order('id'),
    supabase.from('floors').select('id,building_id,floor_number,map_image_url').order('id')
  ]);
  if (bRes.error || fRes.error) return setStatus('Building/Floor load failed', false);
  buildings = bRes.data || [];
  floors = fRes.data || [];
  el.buildingId.innerHTML = '<option value="">건물 선택</option>' + buildings.map(b => `<option value="${b.id}">${b.id} - ${b.name}</option>`).join('');
}

function renderFloorOptions(buildingId) {
  const list = floors.filter(f => String(f.building_id) === String(buildingId));
  el.floorId.innerHTML = '<option value="">층 선택</option>' + list.map(f => `<option value="${f.id}">${f.floor_number}층</option>`).join('');
}

async function loadIndoorData() {
  const floorId = Number(el.floorId.value);
  
  if (!indoorMap || !indoorNodeLayer || !indoorEdgeLayer) return;

  // 1. 층 선택이 없으면 초기화 후 종료
  if (!floorId) {
    indoorNodes = [];
    indoorEdges = [];
    if (indoorImageLayer) indoorImageLayer.setUrl('');
    indoorNodeLayer.clearLayers();
    indoorEdgeLayer.clearLayers();
    return;
  }

  const floor = floors.find(f => Number(f.id) === floorId);
  
  if (floor && floor.map_image_url) {
    // [핵심 수정] 이미지가 로드될 때까지 기다리는 로직 강화
    console.log("Setting image URL:", floor.map_image_url);
    
    // 기존 로드 이벤트가 중복될 수 있으므로 제거 후 재등록
    indoorImageLayer.off('load'); 
    
    indoorImageLayer.setUrl(floor.map_image_url);

    // 이미지 로드 완료 이벤트 핸들러
    indoorImageLayer.on('load', () => {
      console.log("✅ Image Load Success. Fitting bounds...");
      
      // 1. 지도 컨테이너 크기 재계산 (회색 화면 방지의 핵심)
      indoorMap.invalidateSize();
      
      // 2. 이미지의 경계에 지도를 맞춤
      // CRS.Simple를 사용하므로 [0,0]에서 [1000,1000] 혹은 이미지 실제 크기에 맞춰야 함
      // floor 스키마의 scale 값을 활용하거나 기본 범위를 지정
      indoorMap.fitBounds([[0, 0], [1000, 1000]]);
    });

    // 만약 이미 캐시되어 있어 load 이벤트가 바로 안 뜨는 경우를 대비한 fallback
    // (이미지가 이미 로드된 상태라면 호출될 수 있도록)
    setTimeout(() => {
        if (indoorImageLayer._url && indoorMap.getBounds().equals([[0,0],[0,0]])) {
             indoorMap.invalidateSize();
             indoorMap.fitBounds([[0, 0], [1000, 1000]]);
        }
    }, 500);

  } else {
    console.warn("No map image URL found for this floor.");
  }

  // 3. 노드 및 엣지 데이터 로드 (기존 로직 유지)
  const [nRes, eRes] = await Promise.all([
    supabase.from('indoor_nodes').select('*').eq('floor_id', floorId),
    supabase.from('indoor_edges').select('*')
  ]);

  if (nRes.error || eRes.error) {
    setStatus('Indoor data load failed', false);
    return;
  }

  indoorNodes = nRes.data || [];
  const nodeIdSet = new Set(indoorNodes.map(n => n.id));
  indoorEdges = (eRes.data || []).filter(e => nodeIdSet.has(e.from_node) && nodeIdSet.has(e.to_node));

  renderIndoorLayers();
}



// --- Indoor 레이어 렌더링 (엣지 복원 및 마커 축소) ---
function renderIndoorLayers() {
  if (!indoorNodeLayer || !indoorEdgeLayer) return;

  // 기존 레이어 전체 삭제 (잔상 제거)
  indoorNodeLayer.clearLayers();
  indoorEdgeLayer.clearLayers();

  // 1. 엣지(Edge) 렌더링: 경로 복원
  if (indoorEdges.length > 0) {
    const nodeMap = {};
    indoorNodes.forEach(n => { nodeMap[n.id] = n; });

    indoorEdges.forEach(e => {
      const startNode = nodeMap[e.from_node];
      const endNode = nodeMap[e.to_node];

      if (startNode && endNode) {
        // 엣지 선 그리기
        const edgeLine = L.polyline([[startNode.y, startNode.x], [endNode.y, endNode.x]], {
          color: '#ef4444', // Red
          weight: 3,        // 선 굵기 조절
          opacity: 0.7,
          lineJoin: 'round'
        }).addTo(indoorEdgeLayer);

        // 엣지 클릭 이벤트 (매핑 대상 선택용)
        edgeLine.on('click', (ev) => {
          ev.stopPropagation();
          if (!isIndoor() || el.targetType.value !== 'edge') return;
          selectedEdgeId = e.id;
          selectedNodeId = null;
          syncSelectedTargetInput();
          setStatus(`Indoor Edge 선택됨: ${e.id}`);
        });
      }
    });
    console.log(`✅ Rendered ${indoorEdges.length} indoor edges.`);
  }

  // 2. 노드(Node) 렌더링: 마커 크기 축소
  indoorNodes.forEach(n => {
    const marker = L.circleMarker([n.y, n.x], {
      radius: 5,           // [수정] 크기를 8에서 5로 축소
      color: '#10b981',    // Green
      fillColor: '#10b981',
      fillOpacity: 0.9,
      weight: 1            // 테두리 두께 최적화
    }).addTo(indoorNodeLayer);

    marker.bindTooltip(`Node ${n.id}`, { direction: 'top', offset: [0, -5] });
    
    marker.on('click', (ev) => {
      ev.stopPropagation();
      if (!isIndoor() || el.targetType.value !== 'node') return;
      selectedNodeId = n.id;
      selectedEdgeId = null;
      syncSelectedTargetInput();
      setStatus(`Indoor Node 선택됨: ${n.id}`);
    });
  });
  console.log(`✅ Rendered ${indoorNodes.length} indoor nodes.`);
}


async function loadOutdoorData() {
  const [nRes, eRes] = await Promise.all([
    supabase.from('outdoor_nodes').select('*'),
    supabase.from('outdoor_edges').select('*')
  ]);
  outdoorNodes = nRes.data || [];
  outdoorEdges = eRes.data || [];
  drawOutdoorLayers();
}

function drawOutdoorLayers() {
  outdoorNodeLayer.clearLayers();
  outdoorEdgeLayer.clearLayers();
  const nodeMap = {};
  outdoorNodes.forEach(n => { nodeMap[n.id] = n; });

  outdoorNodes.forEach(n => {
    L.circleMarker([n.lat, n.lng], { radius: 6, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.9 })
     .addTo(outdoorNodeLayer)
     .on('click', () => {
       if (el.nodeScope.value !== 'outdoor' || el.targetType.value !== 'node') return;
       selectedNodeId = n.id; selectedEdgeId = null; syncSelectedTargetInput();
       setStatus(`Node ${n.id} selected`);
     });
  });

  outdoorEdges.forEach(e => {
    const a = nodeMap[e.from_node], b = nodeMap[e.to_node];
    if (!a || !b) return;
    L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: '#f59e0b', weight: 4 })
     .addTo(outdoorEdgeLayer)
     .on('click', () => {
       if (el.nodeScope.value !== 'outdoor' || el.targetType.value !== 'edge') return;
       selectedEdgeId = e.id; selectedNodeId = null; syncSelectedTargetInput();
       setStatus(`Edge ${e.id} selected`);
     });
  });

  if (outdoorNodes.length) outdoorMap.fitBounds(L.latLngBounds(outdoorNodes.map(n => [n.lat, n.lng])).pad(0.2));
}

// --- CRUD Operations ---
async function loadMappings() {
  const { data, error } = await supabase
    .from('camera_node_map')
    .select('*, floors(floor_number)')
    .order('updated_at', { ascending: false });

  if (error) return setStatus('Load failed', false);
  mappings = data || [];
  el.mappingCount.textContent = mappings.length;

  const collator = new Intl.Collator('ko', { numeric: true });
  mappings.sort((a, b) => collator.compare(a.floors?.floor_number ?? 0, b.floors?.floor_number ?? 0));

  el.mapList.innerHTML = mappings.map(m => {
    const target = m.target_type === 'node' ? `node:${m.node_id ?? '-'}` : `edge:${m.edge_id ?? '-'}`;
    const floorLabel = m.floors?.floor_number ? `${m.floors.floor_number}F` : '-';
    return `<div class="item ${editId === m.id ? 'active' : ''}" data-id="${m.id}">
      <div class="item-main"><span class="item-id">${m.camera_id}</span><span>${m.target_type.toUpperCase()}</span></div>
      <div class="item-meta"><span>${target}</span><span>|</span><span>${floorLabel}</span></div>
    </div>`;
  }).join('');

  el.mapList.querySelectorAll('.item').forEach(node => {
    node.onclick = async () => {
      const m = mappings.find(x => x.id === Number(node.dataset.id));
      if (!m) return;
      editId = m.id;
      el.cameraId.value = m.camera_id;
      el.targetType.value = m.target_type;
      el.nodeScope.value = m.node_scope;
      selectedNodeId = m.node_id ?? null;
      selectedEdgeId = m.edge_id ?? null;
      syncSelectedTargetInput();
      if (m.building_id) { el.buildingId.value = String(m.building_id); renderFloorOptions(m.building_id); }
      if (m.floor_id) { el.floorId.value = String(m.floor_id); await loadIndoorData(); }
      toggleScopePanels();
    };
  });
}

async function saveMapping() {
  const camera_id = el.cameraId.value;
  const target_type = el.targetType.value;
  const node_scope = el.nodeScope.value;
  const selected = currentSelectedId();
  if (!camera_id || !selected) return setStatus('Missing required fields', false);

  const payload = {
    camera_id, target_type, node_scope,
    node_id: target_type === 'node' ? Number(selected) : null,
    edge_id: target_type === 'edge' ? Number(selected) : null,
    building_id: node_scope === 'indoor' && el.buildingId.value ? Number(el.buildingId.value) : null,
    floor_id: node_scope === 'indoor' && el.floorId.value ? Number(el.floorId.value) : null,
    updated_at: new Date().toISOString()
  };

  const { error } = editId 
    ? await supabase.from('camera_node_map').update(payload).eq('id', editId)
    : await supabase.from('camera_node_map').insert(payload);

  if (error) return setStatus('Save failed', false);
  setStatus('Saved successfully');
  await loadMappings();
}

async function deleteMapping() {
  if (!editId || !confirm('Delete this mapping?')) return;
  const { error } = await supabase.from('camera_node_map').delete().eq('id', editId);
  if (error) return setStatus('Delete failed', false);
  setStatus('Deleted successfully');
  clearForm();
  await loadMappings();
}

function clearForm() {
  editId = null; selectedNodeId = null; selectedEdgeId = null;
  el.targetType.value = 'node';
  el.nodeScope.value = 'outdoor';
  el.selectedTarget.value = '';
  el.buildingId.value = '';
  el.floorId.innerHTML = '<option value="">층 선택</option>';
  setStatus('ready');
  toggleScopePanels();
}

// --- Initialization ---
function bindEvents() {
  el.btnNew.onclick = clearForm;
  el.btnSave.onclick = saveMapping;
  el.btnDelete.onclick = deleteMapping;
  el.nodeScope.onchange = () => {
    selectedNodeId = null; selectedEdgeId = null; syncSelectedTargetInput();
    toggleScopePanels();
  };
  el.targetType.onchange = () => {
    selectedNodeId = null; selectedEdgeId = null; syncSelectedTargetInput();
  };
  el.buildingId.onchange = () => {
    renderFloorOptions(el.buildingId.value);
    el.floorId.value = '';
    if (el.nodeScope.value === 'indoor') {
      indoorNodes = []; indoorEdges = [];
      if (indoorNodeLayer) indoorNodeLayer.clearLayers();
      if (indoorEdgeLayer) indoorEdgeLayer.clearLayers();
    }
  };
  el.floorId.onchange = async () => { if (indoorMap) await loadIndoorData(); };
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
  setStatus('Initialized');
}

init();

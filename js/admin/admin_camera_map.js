/**
 * @file admin_camera_map.js
 * @version 1.2.11
 * @description 지도 클릭 시 navigation_elements.id를 조회하여 
 *              camera_node_map.node_status_id에 저장하는 로직 완성
 */

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
let selectedNavId = null; // ★ 반드시 navigation_elements.id를 담아야 함

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

// ★ 핵심 추가: 클릭한 물리 ID를 기반으로 navigation_elements.id를 찾아오는 함수
async function fetchNavElementId(type, rawId) {
  const scope = isIndoor() ? 'indoor' : 'outdoor';
  // target_type이 node면 element_type도 node, edge면 edge
  const elType = el.targetType.value; 
  
  const { data, error } = await supabase
    .from('navigation_elements')
    .select('id')
    .eq('scope', scope)
    .eq('element_type', elType)
    .eq('source_table', scope === 'indoor' ? (elType === 'node' ? 'indoor_nodes' : 'indoor_edges') : (elType === 'node' ? 'outdoor_nodes' : 'outdoor_edges'))
    .eq('elements_id', rawId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching Nav ID:", error);
    return null;
  }
  return data ? data.id : null;
}

// --- Map Initialization ---
function initIndoorMap() {
  if (indoorMap) return;
  try {
    indoorMap = L.map('indoor-map', { crs: L.CRS.Simple, zoomControl: true, attributionControl: false });
    indoorMap.setView([0, 0], 1);
    indoorNodeLayer = L.layerGroup().addTo(indoorMap);
    indoorEdgeLayer = L.layerGroup().addTo(indoorMap);
    indoorImageLayer = L.imageOverlay('', [[0, 0], [1000, 1000]]);
    indoorImageLayer.addTo(indoorMap);
    indoorImageLayer.getElement().style.pointerEvents = 'none'; 
    console.log("✅ Indoor map initialized.");
  } catch (e) { console.error("❌ Failed to initialize indoor map:", e); indoorMap = null; }
}

function initOutdoorMap() {
  if (outdoorMap) return;
  outdoorMap = L.map('outdoor-map').setView([37.5665, 126.9780], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, attribution: '&copy; OpenStreetMap' }).addTo(outdoorMap);
  outdoorNodeLayer = L.layerGroup().addTo(outdoorMap);
  outdoorEdgeLayer = L.layerGroup().addTo(outdoorMap);
}

function toggleScopePanels() {
  const indoor = isIndoor();
  if (indoor) {
    el.outdoorContainer.style.display = 'none'; el.indoorContainer.style.display = 'block';
    setTimeout(() => { if (!indoorMap) initIndoorMap(); if (indoorMap) { indoorMap.invalidateSize(); if (el.floorId.value) loadIndoorData(); } }, 250);
  } else {
    el.indoorContainer.style.display = 'none'; el.outdoorContainer.style.display = 'block';
    setTimeout(() => { if (outdoorMap) outdoorMap.invalidateSize(); }, 250);
  }
}

// --- Data Loading ---
async function loadCameras() {
  const { data, error } = await supabase.from('camera_profiles').select('camera_id, camera_name').order('camera_id', { ascending: true });
  if (error) return setStatus(`Camera load failed: ${error.message}`, false);
  el.cameraId.innerHTML = (data || []).map(c => `<option value="${c.camera_id}">${c.camera_id}${c.camera_name ? ` (${c.camera_name})` : ''}</option>`).join('');
}

async function loadBuildingsFloors() {
  const [bRes, fRes] = await Promise.all([
    supabase.from('buildings').select('id,name').order('id'),
    supabase.from('floors').select('id,building_id,floor_number,map_image_url').order('id')
  ]);
  if (bRes.error || fRes.error) return setStatus('Building/Floor load failed', false);
  buildings = bRes.data || []; floors = fRes.data || [];
  el.buildingId.innerHTML = '<option value="">건물 선택</option>' + buildings.map(b => `<option value="${b.id}">${b.id} - ${b.name}</option>`).join('');
}

function renderFloorOptions(buildingId) {
  const list = floors.filter(f => String(f.building_id) === String(buildingId));
  el.floorId.innerHTML = '<option value="">층 선택</option>' + list.map(f => `<option value="${f.id}">${f.floor_number}층</option>`).join('');
}

async function loadIndoorData() {
  const floorId = Number(el.floorId.value);
  if (!indoorMap || !indoorNodeLayer || !indoorEdgeLayer) return;
  if (!floorId) { indoorNodes = []; indoorEdges = []; if (indoorImageLayer) indoorImageLayer.setUrl(''); indoorNodeLayer.clearLayers(); indoorEdgeLayer.clearLayers(); return; }
  const floor = floors.find(f => Number(f.id) === floorId);
  if (floor && floor.map_image_url) {
    indoorImageLayer.off('load'); 
    indoorImageLayer.setUrl(floor.map_image_url);
    indoorImageLayer.on('load', () => { indoorMap.invalidateSize(); indoorMap.fitBounds([[0, 0], [1000, 1000]]); });
    setTimeout(() => { if (indoorImageLayer._url && indoorMap.getBounds().equals([[0,0],[0,0]])) { indoorMap.invalidateSize(); indoorMap.fitBounds([[0, 0], [1000, 1000]]); } }, 500);
  }
  const [nRes, eRes] = await Promise.all([
    supabase.from('indoor_nodes').select('*').eq('floor_id', floorId),
    supabase.from('indoor_edges').select('*')
  ]);
  if (nRes.error || eRes.error) return setStatus('Indoor data load failed', false);
  indoorNodes = nRes.data || [];
  const nodeIdSet = new Set(indoorNodes.map(n => n.id));
  indoorEdges = (eRes.data || []).filter(e => nodeIdSet.has(e.from_node) && nodeIdSet.has(e.to_node));
  renderIndoorLayers();
}

function renderIndoorLayers() {
  if (!indoorNodeLayer || !indoorEdgeLayer) return;
  indoorNodeLayer.clearLayers(); indoorEdgeLayer.clearLayers();
  if (indoorEdges.length > 0) {
    const nodeMap = {}; indoorNodes.forEach(n => { nodeMap[n.id] = n; });
    indoorEdges.forEach(e => {
      const startNode = nodeMap[e.from_node], endNode = nodeMap[e.to_node];
      if (startNode && endNode) {
        const edgeLine = L.polyline([[startNode.y, startNode.x], [endNode.y, endNode.x]], { color: '#ef4444', weight: 5, opacity: 0.7, lineJoin: 'round' }).addTo(indoorEdgeLayer);
        edgeLine.on('click', async (ev) => { 
          L.DomEvent.stopPropagation(ev); 
          if (!isIndoor() || el.targetType.value !== 'edge') return; 
          selectedEdgeId = e.id; selectedNodeId = null; 
          // ★ 핵심: 클릭 시 navigation_elements.id를 찾아 할당
          selectedNavId = await fetchNavElementId('edge', e.id); 
          syncSelectedTargetInput(); 
          setStatus(`Indoor Edge 선택됨: ${e.id}`); 
        });
      }
    });
  }
  indoorNodes.forEach(n => {
    const marker = L.circleMarker([n.y, n.x], { radius: 8, color: '#10b981', fillColor: '#10b981', fillOpacity: 0.9, weight: 2 }).addTo(indoorNodeLayer);
    marker.bindTooltip(`Node ${n.id}`, { direction: 'top', offset: [0, -5] });
    marker.on('click', async (ev) => { 
      L.DomEvent.stopPropagation(ev); 
      if (!isIndoor() || el.targetType.value !== 'node') return; 
      selectedNodeId = n.id; selectedEdgeId = null; 
      // ★ 핵심: 클릭 시 navigation_elements.id를 찾아 할당
      selectedNavId = await fetchNavElementId('node', n.id); 
      syncSelectedTargetInput(); 
      setStatus(`Indoor Node 선택됨: ${n.id}`); 
    });
  });
}

async function loadOutdoorData() {
  const [nRes, eRes] = await Promise.all([supabase.from('outdoor_nodes').select('*'), supabase.from('outdoor_edges').select('*')]);
  outdoorNodes = nRes.data || []; outdoorEdges = eRes.data || [];
  drawOutdoorLayers();
}

function drawOutdoorLayers() {
  outdoorNodeLayer.clearLayers(); outdoorEdgeLayer.clearLayers();
  const nodeMap = {}; outdoorNodes.forEach(n => { nodeMap[n.id] = n; });
  outdoorNodes.forEach(n => {
    L.circleMarker([n.lat, n.lng], { radius: 6, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.9 }).addTo(outdoorNodeLayer).on('click', async () => { 
      if (el.nodeScope.value !== 'outdoor' || el.targetType.value !== 'node') return; 
      selectedNodeId = n.id; selectedEdgeId = null; 
      // ★ 핵심: 클릭 시 navigation_elements.id를 찾아 할당
      selectedNavId = await fetchNavElementId('node', n.id); 
      syncSelectedTargetInput(); 
      setStatus(`Node ${n.id} selected`); 
    });
  });
  outdoorEdges.forEach(e => {
    const a = nodeMap[e.from_node], b = nodeMap[e.to_node];
    if (!a || !b) return;
    L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: '#f59e0b', weight: 4 }).addTo(outdoorEdgeLayer).on('click', async () => { 
      if (el.nodeScope.value !== 'outdoor' || el.targetType.value !== 'edge') return; 
      selectedEdgeId = e.id; selectedNodeId = null; 
      // ★ 핵심: 클릭 시 navigation_elements.id를 찾아 할당
      selectedNavId = await fetchNavElementId('edge', e.id); 
      syncSelectedTargetInput(); 
      setStatus(`Edge ${e.id} selected`); 
    });
  });
  if (outdoorNodes.length) outdoorMap.fitBounds(L.latLngBounds(outdoorNodes.map(n => [n.lat, n.lng])).pad(0.2));
}

// --- CRUD Operations ---
async function loadMappings() {
  const { data, error } = await supabase.from('camera_node_map').select('*, floors(floor_number)').order('updated_at', { ascending: false });
  if (error) return setStatus('Load failed', false);
  mappings = data || [];
  el.mappingCount.textContent = mappings.length;
  const collator = new Intl.Collator('ko', { numeric: true });
  mappings.sort((a, b) => collator.compare(a.floors?.floor_number ?? 0, b.floors?.floor_number ?? 0));
  el.mapList.innerHTML = mappings.map(m => {
    const target = m.target_type === 'node' ? `node:${m.node_id ?? '-'}` : `edge:${m.edge_id ?? '-'}`;
    const floorLabel = m.floors?.floor_number ? `${m.floors.floor_number}F` : '-';
    return `<div class="item ${editId === m.id ? 'active' : ''}" data-id="${m.id}">
      <div class="item-main"><span class="item-id">${m.camera_id}</span><span>${m.target_type.toUpperCase()}</span></div >
      <div class="item-meta"><span>${target}</span><span>|</span><span>${floorLabel}</span></div >
    </div >`;
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
      selectedNavId = m.node_status_id; // ★ 중요: node_status_id에 저장된 NavID를 로드
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
    node_status_id: selectedNavId, // ★ 핵심: navigation_elements.id를 저장
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
  editId = null; selectedNodeId = null; selectedEdgeId = null; selectedNavId = null;
  el.targetType.value = 'node'; el.nodeScope.value = 'outdoor';
  el.selectedTarget.value = ''; el.buildingId.value = ''; el.floorId.innerHTML = '<option value="">층 선택</option>';
  setStatus('ready'); toggleScopePanels();
}

function bindEvents() {
  el.btnNew.onclick = clearForm;
  el.btnSave.onclick = saveMapping;
  el.btnDelete.onclick = deleteMapping;
  el.nodeScope.onchange = () => { selectedNodeId = null; selectedEdgeId = null; selectedNavId = null; syncSelectedTargetInput(); toggleScopePanels(); };
  el.targetType.onchange = () => { selectedNodeId = null; selectedEdgeId = null; selectedNavId = null; syncSelectedTargetInput(); };
  el.buildingId.onchange = () => { renderFloorOptions(el.buildingId.value); el.floorId.value = ''; if (el.nodeScope.value === 'indoor') { indoorNodes = []; indoorEdges = []; if (indoorNodeLayer) indoorNodeLayer.clearLayers(); if (indoorEdgeLayer) indoorEdgeLayer.clearLayers(); } };
  el.floorId.onchange = async () => { if (indoorMap) await loadIndoorData(); };
}

async function init() {
  bindEvents(); initOutdoorMap();
  await Promise.all([loadCameras(), loadBuildingsFloors(), loadOutdoorData(), loadMappings()]);
  clearForm(); setStatus('Initialized');
}

init();

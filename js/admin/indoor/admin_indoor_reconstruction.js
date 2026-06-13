import { protectPage } from '../common/adminRouterGuard.js';
import { initAdminHeader } from '../common/adminHeader.js';
import { supabase } from '../common/adminApi.js';

await protectPage();
initAdminHeader('indoorScan');

const $ = (id) => document.getElementById(id);
const el = {
  building: $('building-select'),
  floor: $('floor-select'),
  navigation: $('navigation-select'),
  showNodes: $('show-nodes'),
  showEdges: $('show-edges'),
  cameraMatch: $('camera-match'),
  roomSelect: $('room-select'),
  roomName: $('room-name'),
  drawRoom: $('draw-room'),
  resetRoom: $('reset-room'),
  saveRoom: $('save-room'),
  roomResult: $('room-result'),
  modePhoto: $('mode-photo'),
  modeLive: $('mode-live'),
  depthStatus: $('depth-status'),
  monocularConfirmWrap: $('monocular-confirm-wrap'),
  monocularConfirm: $('monocular-confirm'),
  openLive: $('open-live'),
  images: $('room-images'),
  imageList: $('image-list'),
  apiBase: $('api-base'),
  generate: $('generate-draft'),
  realDistance: $('real-distance'),
  startScale: $('start-scale'),
  saveScale: $('save-scale'),
  scaleResult: $('scale-result'),
  saveObstacles: $('save-obstacles'),
  message: $('message'),
  planTitle: $('plan-title'),
  planMeta: $('plan-meta'),
  planStage: $('plan-stage'),
  planImage: $('plan-image'),
  overlay: $('plan-overlay'),
  emptyState: $('empty-state')
};

let buildings = [];
let floors = [];
let currentFloor = null;
let nodes = [];
let edges = [];
let candidates = [];
let scalePoints = [];
let scaleMode = false;
let navigationElements = [];
let cameraMappings = [];
let selectedCamera = null;
let analysisMode = 'photo';
let sensorStatus = null;
let roomSpaces = [];
let roomPoints = [];
let roomDrawMode = false;
let showNodes = true;
let showEdges = true;

const PLAN_SIZE = 1000;
const toSvgY = (leafletY) => PLAN_SIZE - Number(leafletY);

function setMessage(text, error = false) {
  el.message.textContent = text;
  el.message.classList.toggle('error', error);
}

function selectedFiles() {
  return [...(el.images.files || [])].slice(0, 12);
}

async function loadBaseData() {
  const [buildingResult, floorResult, navigationResult, cameraMapResult] = await Promise.all([
    supabase.from('buildings').select('id,name').order('name'),
    supabase.from('floors').select('*').order('floor_number'),
    supabase.from('navigation_elements').select('*').eq('scope', 'indoor').order('id'),
    supabase.from('camera_node_map').select('camera_id,node_status_id,node_scope').eq('node_scope', 'indoor')
  ]);
  if (buildingResult.error || floorResult.error || navigationResult.error) {
    setMessage('건물 또는 층 목록을 불러오지 못했습니다.', true);
    return;
  }
  buildings = buildingResult.data || [];
  floors = floorResult.data || [];
  navigationElements = navigationResult.data || [];
  cameraMappings = cameraMapResult.data || [];
  el.building.innerHTML = '<option value="">건물 선택</option>' +
    buildings.map((building) => `<option value="${building.id}">${building.name}</option>`).join('');
}

function renderFloorOptions() {
  const buildingId = Number(el.building.value);
  const list = floors.filter((floor) => Number(floor.building_id) === buildingId);
  el.floor.innerHTML = '<option value="">층 선택</option>' +
    list.map((floor) => `<option value="${floor.id}">${floor.floor_number}층</option>`).join('');
}

async function loadFloor() {
  currentFloor = floors.find((floor) => Number(floor.id) === Number(el.floor.value)) || null;
  candidates = [];
  scalePoints = [];
  if (!currentFloor) {
    el.emptyState.classList.remove('hidden');
    renderPlan();
    return;
  }
  const [nodeResult, edgeResult, roomResult] = await Promise.all([
    supabase.from('indoor_nodes').select('*').eq('floor_id', currentFloor.id),
    supabase.from('indoor_edges').select('*'),
    supabase.from('indoor_room_spaces').select('*').eq('floor_id', currentFloor.id).order('room_name')
  ]);
  nodes = nodeResult.data || [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  edges = (edgeResult.data || []).filter((edge) => nodeIds.has(edge.from_node) && nodeIds.has(edge.to_node));
  roomSpaces = roomResult.data || [];
  roomPoints = [];
  renderRoomOptions();
  renderNavigationOptions();
  candidates = [];
  const building = buildings.find((item) => Number(item.id) === Number(currentFloor.building_id));
  el.planTitle.textContent = `${building?.name || '건물'} ${currentFloor.floor_number}층`;
  el.planImage.src = currentFloor.map_image_url;
  el.emptyState.classList.add('hidden');
  renderPlan();
}

function renderRoomOptions() {
  el.roomSelect.innerHTML = '<option value="">층 전체 / 새 호실</option>' +
    roomSpaces.map((room) => `<option value="${room.id}">${room.room_name}</option>`).join('');
}

function loadRoomSelection() {
  const room = roomSpaces.find((item) => Number(item.id) === Number(el.roomSelect.value));
  roomPoints = room?.room_polygon || [];
  el.roomName.value = room?.room_name || '';
  if (room?.entrance_navigation_element_id) {
    el.navigation.value = String(room.entrance_navigation_element_id);
    loadSelectedSpace();
  }
  el.roomResult.textContent = room
    ? `${room.room_name} 영역 ${roomPoints.length}점 로드됨`
    : '새 호실 영역을 그릴 수 있습니다.';
  renderPlan();
}

function renderNavigationOptions() {
  const nodeIds = new Set(nodes.map((node) => Number(node.id)));
  const edgeIds = new Set(edges.map((edge) => Number(edge.id)));
  const valid = navigationElements.filter((item) => {
    if (item.source_table === 'indoor_nodes') return nodeIds.has(Number(item.elements_id));
    if (item.source_table === 'indoor_edges') return edgeIds.has(Number(item.elements_id));
    return false;
  });
  el.navigation.innerHTML = '<option value="">노드 또는 엣지 선택</option>' + valid.map((item) => {
    const source = item.element_type === 'node'
      ? nodes.find((node) => Number(node.id) === Number(item.elements_id))
      : edges.find((edge) => Number(edge.id) === Number(item.elements_id));
    const label = item.element_type === 'node'
      ? `Node ${item.elements_id} · ${source?.name || '이름 없음'}`
      : `Edge ${item.elements_id} · ${source?.type || 'walk'}`;
    return `<option value="${item.id}">${label}</option>`;
  }).join('');
  el.cameraMatch.textContent = valid.length
    ? `${valid.length}개의 Indoor 공간 대상을 선택할 수 있습니다.`
    : '이 층에 navigation_elements로 등록된 노드·엣지가 없습니다.';
}

function findNavigationElement(elementType, elementId) {
  const sourceTable = elementType === 'node' ? 'indoor_nodes' : 'indoor_edges';
  return navigationElements.find((item) =>
    item.element_type === elementType &&
    item.source_table === sourceTable &&
    Number(item.elements_id) === Number(elementId)
  ) || null;
}

async function selectMapTarget(elementType, elementId) {
  const navigation = findNavigationElement(elementType, elementId);
  if (!navigation) {
    setMessage(
      `${elementType === 'node' ? '노드' : '엣지'} ${elementId}는 navigation_elements에 등록되지 않아 공간과 매칭할 수 없습니다.`,
      true
    );
    return;
  }
  el.navigation.value = String(navigation.id);
  await loadSelectedSpace();
  const selectedLabel = el.navigation.options[el.navigation.selectedIndex]?.textContent || '';
  setMessage(`평면도에서 ${selectedLabel}을 선택했습니다.`);
}

async function loadSelectedSpace() {
  const navigationId = Number(el.navigation.value);
  selectedCamera = cameraMappings.find((item) => Number(item.node_status_id) === navigationId) || null;
  el.cameraMatch.textContent = selectedCamera
    ? `카메라 ${selectedCamera.camera_id} 매칭됨`
    : '매칭된 카메라 없음 · 다각도 사진 기반 구성은 계속 가능합니다.';

  if (!navigationId) {
    candidates = [];
    renderPlan();
    return;
  }
  const { data } = await supabase
    .from('indoor_obstacle_maps')
    .select('*')
    .eq('navigation_element_id', navigationId)
    .maybeSingle();
  candidates = data?.obstacles || [];
  renderPlan();
  await refreshSensorStatus();
}

async function refreshSensorStatus() {
  try {
    const response = await fetch(`${el.apiBase.value.trim().replace(/\/+$/, '')}/api/health`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    sensorStatus = await response.json();
    const depth = sensorStatus.depth_sensor || {};
    if (depth.active) {
      el.depthStatus.textContent = `깊이 센서 자동 감지 · ${depth.devices.join(', ')}`;
      el.depthStatus.className = 'sensor-box online';
      el.monocularConfirmWrap.style.display = 'none';
    } else {
      el.depthStatus.textContent = depth.available
        ? '깊이 센서는 있으나 현재 영상과 정렬되지 않았습니다 · 단안 확인 필요'
        : '깊이 센서 없음 · 단안 추정 사용 전 확인이 필요합니다.';
      el.depthStatus.className = 'sensor-box warning';
      el.monocularConfirmWrap.style.display = 'flex';
    }
    const liveAllowed = Boolean(selectedCamera && sensorStatus.camera_online);
    el.openLive.disabled = !liveAllowed;
    if (analysisMode === 'live' && !liveAllowed) {
      setMessage('카메라 프레임이 연결된 상태에서만 실시간 분석을 시작할 수 있습니다.', true);
    }
  } catch (error) {
    sensorStatus = null;
    el.depthStatus.textContent = '분석 서비스 오프라인 · 사진 기반 구성만 가능합니다.';
    el.depthStatus.className = 'sensor-box warning';
    el.openLive.disabled = true;
  }
}

function setAnalysisMode(mode) {
  analysisMode = mode;
  el.modePhoto.classList.toggle('active', mode === 'photo');
  el.modeLive.classList.toggle('active', mode === 'live');
  if (mode === 'live' && !(selectedCamera && sensorStatus?.camera_online)) {
    setMessage('실시간 분석은 매칭된 카메라가 현재 프레임을 송출할 때만 가능합니다.', true);
  } else if (mode === 'photo') {
    setMessage('카메라 연결 없이도 선택한 공간의 다각도 사진으로 평면도 초안을 만들 수 있습니다.');
  }
}

function renderPlan() {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const selectedNavigationId = Number(el.navigation.value);
  const edgeMarkup = showEdges ? edges.map((edge) => {
    const from = nodeMap.get(edge.from_node);
    const to = nodeMap.get(edge.to_node);
    if (!from || !to) return '';
    const navigation = findNavigationElement('edge', edge.id);
    const selected = navigation && Number(navigation.id) === selectedNavigationId;
    const color = navigation ? (selected ? '#f8fafc' : '#34d399') : '#64748b';
    const midX = (Number(from.x) + Number(to.x)) / 2;
    const midY = (toSvgY(from.y) + toSvgY(to.y)) / 2;
    return `<g class="map-target edge-target" data-element-type="edge" data-element-id="${edge.id}">
      <line x1="${from.x}" y1="${toSvgY(from.y)}" x2="${to.x}" y2="${toSvgY(to.y)}" stroke="transparent" stroke-width="24"/>
      <line class="target-shape" x1="${from.x}" y1="${toSvgY(from.y)}" x2="${to.x}" y2="${toSvgY(to.y)}" stroke="${color}" stroke-width="${selected ? 9 : 5}" opacity="${navigation ? '.9' : '.4'}"/>
      ${selected ? `<circle cx="${midX}" cy="${midY}" r="13" fill="#4776e6" stroke="#fff" stroke-width="3"/>
        <text x="${midX}" y="${midY + 6}" text-anchor="middle" fill="#fff" font-size="17" font-weight="900">✓</text>` : ''}
      <title>${navigation ? `Edge ${edge.id} 선택` : `Edge ${edge.id} · navigation_elements 미등록`}</title>
    </g>`;
  }).join('') : '';
  const obstacleMarkup = candidates.map((candidate, index) => {
    const points = candidate.polygon.map((point) => point.join(',')).join(' ');
    const enabled = candidate.enabled !== false;
    return `<g class="candidate" data-index="${index}" style="cursor:pointer">
      <polygon points="${points}" fill="${enabled ? 'rgba(245,158,11,.46)' : 'rgba(100,116,139,.18)'}" stroke="${enabled ? '#f59e0b' : '#64748b'}" stroke-width="4"/>
      <title>${candidate.label} · ${Math.round(candidate.confidence * 100)}% · ${candidate.source_image}</title>
    </g>`;
  }).join('');
  const nodeMarkup = showNodes ? nodes.map((node) => {
    const navigation = findNavigationElement('node', node.id);
    const selected = navigation && Number(navigation.id) === selectedNavigationId;
    const y = toSvgY(node.y);
    const fill = navigation ? (selected ? '#f8fafc' : '#4776e6') : '#64748b';
    return `<g class="map-target node-target" data-element-type="node" data-element-id="${node.id}">
      <circle cx="${node.x}" cy="${y}" r="20" fill="transparent"/>
      <circle class="target-shape" cx="${node.x}" cy="${y}" r="${selected ? 14 : 9}" fill="${fill}" stroke="${selected ? '#4776e6' : '#fff'}" stroke-width="${selected ? 6 : 3}" opacity="${navigation ? '1' : '.45'}"/>
      ${selected ? `<text x="${node.x}" y="${y + 6}" text-anchor="middle" fill="#4776e6" font-size="18" font-weight="900">✓</text>` : ''}
      <title>${navigation ? `${node.name || `Node ${node.id}`} 선택` : `Node ${node.id} · navigation_elements 미등록`}</title>
    </g>`;
  }).join('') : '';
  const savedRoomMarkup = roomSpaces.map((room) => {
    if (Number(room.id) === Number(el.roomSelect.value)) return '';
    const points = (room.room_polygon || []).map((point) => point.join(',')).join(' ');
    return `<polygon points="${points}" fill="rgba(71,118,230,.08)" stroke="rgba(126,164,251,.55)" stroke-width="3">
      <title>${room.room_name}</title>
    </polygon>`;
  }).join('');
  const roomMarkup = roomPoints.length
    ? `<polygon points="${roomPoints.map((point) => point.join(',')).join(' ')}" fill="rgba(46,164,255,.16)" stroke="#2ea4ff" stroke-width="5" stroke-dasharray="${roomDrawMode ? '10 7' : 'none'}"/>
       ${roomPoints.map((point, index) => `<circle cx="${point[0]}" cy="${point[1]}" r="8" fill="#2ea4ff" stroke="#fff" stroke-width="2"><title>${index + 1}</title></circle>`).join('')}`
    : '';
  const scaleMarkup = scalePoints.length
    ? `<polyline points="${scalePoints.map((point) => point.join(',')).join(' ')}" stroke="#fb7185" stroke-width="6" stroke-dasharray="12 8"/>
       ${scalePoints.map((point) => `<circle cx="${point[0]}" cy="${point[1]}" r="10" fill="#fb7185" stroke="#fff" stroke-width="3"/>`).join('')}`
    : '';
  el.overlay.innerHTML = savedRoomMarkup + roomMarkup + obstacleMarkup + edgeMarkup + nodeMarkup + scaleMarkup;
  el.planMeta.textContent = `호실 ${roomSpaces.length} · 노드 ${nodes.length} · 엣지 ${edges.length} · 장애물 ${candidates.filter((item) => item.enabled !== false).length}`;
  el.overlay.querySelectorAll('.candidate').forEach((group) => {
    group.addEventListener('click', (event) => {
      event.stopPropagation();
      const candidate = candidates[Number(group.dataset.index)];
      candidate.enabled = candidate.enabled === false;
      renderPlan();
    });
  });
  el.overlay.querySelectorAll('.map-target').forEach((target) => {
    target.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (roomDrawMode || scaleMode) return;
      await selectMapTarget(target.dataset.elementType, Number(target.dataset.elementId));
    });
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

el.images.onchange = () => {
  const files = selectedFiles();
  el.imageList.innerHTML = files.length
    ? files.map((file, index) => `${index + 1}. ${file.name}`).join('<br>')
    : '선택된 사진이 없습니다.';
};

el.generate.onclick = async () => {
  const files = selectedFiles();
  if (!currentFloor) return setMessage('대상 층을 먼저 선택하세요.', true);
  if (files.length < 2) return setMessage('서로 다른 각도의 사진을 2장 이상 선택하세요.', true);
  setMessage('사진에서 장애물 후보를 분석하고 있습니다.');
  el.generate.disabled = true;
  try {
    const images = await Promise.all(files.map(async (file, index) => ({
      name: file.name,
      angle: index * 360 / files.length,
      data_url: await fileToDataUrl(file)
    })));
    const response = await fetch(`${el.apiBase.value.trim().replace(/\/+$/, '')}/api/indoor/obstacle-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images, plan_width: 1000, plan_height: 1000 })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '분석 실패');
    candidates = result.candidates || [];
    renderPlan();
    setMessage(`${candidates.length}개의 장애물 후보를 생성했습니다. 평면도에서 검토하세요.`);
  } catch (error) {
    setMessage(`초안 생성 실패: ${error.message}`, true);
  } finally {
    el.generate.disabled = false;
  }
};

el.startScale.onclick = () => {
  if (!currentFloor) return setMessage('층을 먼저 선택하세요.', true);
  scalePoints = [];
  scaleMode = true;
  renderPlan();
  setMessage('평면도에서 실제 거리를 아는 두 점을 선택하세요.');
};

el.overlay.addEventListener('click', (event) => {
  const rect = el.overlay.getBoundingClientRect();
  const point = [
    (event.clientX - rect.left) * 1000 / rect.width,
    (event.clientY - rect.top) * 1000 / rect.height
  ];
  if (roomDrawMode) {
    roomPoints.push(point);
    el.roomResult.textContent = `호실 경계 ${roomPoints.length}점 · 3점 이상이면 저장 가능`;
    renderPlan();
    return;
  }
  if (!scaleMode || scalePoints.length >= 2) return;
  scalePoints.push(point);
  if (scalePoints.length === 2) {
    scaleMode = false;
    const pixelDistance = Math.hypot(
      scalePoints[1][0] - scalePoints[0][0],
      scalePoints[1][1] - scalePoints[0][1]
    );
    el.scaleResult.textContent = `선택한 기준선: ${pixelDistance.toFixed(1)} px`;
  }
  renderPlan();
});

el.drawRoom.onclick = () => {
  if (!currentFloor) return setMessage('층을 먼저 선택하세요.', true);
  roomPoints = [];
  roomDrawMode = true;
  el.roomResult.textContent = '평면도에서 호실 외곽을 순서대로 클릭하세요.';
  renderPlan();
};

el.resetRoom.onclick = () => {
  roomPoints = [];
  roomDrawMode = false;
  el.roomResult.textContent = '호실 영역을 초기화했습니다.';
  renderPlan();
};

el.saveRoom.onclick = async () => {
  const roomName = el.roomName.value.trim();
  const navigationId = Number(el.navigation.value) || null;
  if (!currentFloor || !roomName || roomPoints.length < 3) {
    return setMessage('호실명과 3점 이상의 호실 영역을 지정하세요.', true);
  }
  const payload = {
    floor_id: currentFloor.id,
    entrance_navigation_element_id: navigationId,
    room_name: roomName,
    room_polygon: roomPoints,
    updated_at: new Date().toISOString()
  };
  const roomId = Number(el.roomSelect.value);
  const result = roomId
    ? await supabase.from('indoor_room_spaces').update(payload).eq('id', roomId).select().single()
    : await supabase.from('indoor_room_spaces').insert(payload).select().single();
  if (result.error) return setMessage(`호실 저장 실패: ${result.error.message}`, true);
  roomDrawMode = false;
  await loadFloor();
  el.roomSelect.value = String(result.data.id);
  loadRoomSelection();
  setMessage(`${roomName} 호실을 문 앞 출입구 대상과 연결했습니다.`);
};

el.saveScale.onclick = async () => {
  const metres = Number(el.realDistance.value);
  if (!currentFloor || scalePoints.length !== 2 || metres <= 0) {
    return setMessage('기준선 두 점과 실제 길이를 입력하세요.', true);
  }
  const pixels = Math.hypot(
    scalePoints[1][0] - scalePoints[0][0],
    scalePoints[1][1] - scalePoints[0][1]
  );
  const scale = pixels / metres;
  const { error } = await supabase.from('floors').update({ scale }).eq('id', currentFloor.id);
  if (error) return setMessage(`축척 저장 실패: ${error.message}`, true);
  currentFloor.scale = scale;
  el.scaleResult.textContent = `축척: ${scale.toFixed(2)} px/m · 1px = ${(1 / scale).toFixed(4)}m`;
  setMessage('층 축척을 저장했습니다. Indoor 엣지 거리 환산에 사용됩니다.');
};

el.saveObstacles.onclick = async () => {
  const navigationId = Number(el.navigation.value);
  if (!currentFloor || !navigationId || !candidates.length) {
    return setMessage('공간 매칭 대상과 저장할 장애물 초안을 확인하세요.', true);
  }
  const depthActive = Boolean(sensorStatus?.depth_sensor?.active);
  if (!depthActive && !el.monocularConfirm.checked) {
    return setMessage('깊이 센서가 없을 때는 단안 추정 오차 확인이 필요합니다.', true);
  }
  const files = selectedFiles();
  const payload = {
    floor_id: currentFloor.id,
    navigation_element_id: navigationId,
    room_space_id: Number(el.roomSelect.value) || null,
    camera_id: selectedCamera?.camera_id || null,
    obstacles: candidates.filter((candidate) => candidate.enabled !== false),
    source_images: files.map((file, index) => ({ name: file.name, view_angle: index * 360 / files.length })),
    generation_method: 'multi-view-object-draft',
    scale_px_per_m: currentFloor.scale || null,
    depth_mode: depthActive ? 'depth' : 'monocular',
    monocular_confirmed: depthActive || el.monocularConfirm.checked,
    is_confirmed: true,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from('indoor_obstacle_maps').upsert(payload, { onConflict: 'navigation_element_id' });
  if (error) {
    return setMessage(`저장 실패: ${error.message}. sql/indoor_spatial_schema.sql 적용 여부를 확인하세요.`, true);
  }
  const selectedOption = el.navigation.options[el.navigation.selectedIndex];
  await supabase.from('indoor_spatial_spaces').upsert({
    navigation_element_id: navigationId,
    floor_id: currentFloor.id,
    camera_id: selectedCamera?.camera_id || null,
    space_name: selectedOption?.textContent || `Indoor space ${navigationId}`,
    analysis_mode: analysisMode,
    depth_mode: depthActive ? 'depth' : 'monocular',
    monocular_confirmed: depthActive || el.monocularConfirm.checked,
    is_active: true,
    updated_at: new Date().toISOString()
  }, { onConflict: 'navigation_element_id' });
  setMessage('이 층의 장애물 영역을 확정 저장했습니다.');
};

el.building.onchange = () => {
  renderFloorOptions();
  currentFloor = null;
  nodes = [];
  edges = [];
  candidates = [];
  renderPlan();
};
el.floor.onchange = loadFloor;
el.navigation.onchange = loadSelectedSpace;
el.showNodes.onchange = () => {
  showNodes = el.showNodes.checked;
  renderPlan();
};
el.showEdges.onchange = () => {
  showEdges = el.showEdges.checked;
  renderPlan();
};
el.roomSelect.onchange = loadRoomSelection;
el.modePhoto.onclick = () => setAnalysisMode('photo');
el.modeLive.onclick = () => setAnalysisMode('live');
el.openLive.onclick = () => {
  if (el.openLive.disabled || !selectedCamera) return;
  const query = new URLSearchParams({
    navigation_id: el.navigation.value,
    camera_id: selectedCamera.camera_id
  });
  location.href = `/html/admin/admin_spatial_analysis.html?${query}`;
};

await loadBaseData();
renderPlan();
refreshSensorStatus();
setInterval(refreshSensorStatus, 3000);

import { protectPage } from '../common/adminRouterGuard.js';
import { initAdminHeader } from '../common/adminHeader.js';
import { supabase } from '../common/adminApi.js';

// 페이지 보호 및 헤더 초기화
await protectPage();
initAdminHeader('indoor');

// --- 전역 변수 ---
const map = L.map('map', { crs: L.CRS.Simple, zoomControl: true });
let imageLayer = null;

let mode = 'floor_new';
let buildings = [];
let floors = [];
let nodes = [];
let edges = [];
let currentFloor = null;

let nodeMarkers = [];
let edgeLines = [];
let selectedNodes = [];

// [추가] Shift 연속 생성 기능을 위한 변수
let isShiftPressed = false;
let shiftSelectionQueue = []; 

// --- DOM 요소 참조 ---
const statusEl = document.getElementById('status');
const views = document.querySelectorAll('.view');
const tabs = document.querySelectorAll('.tab');

// 등록 탭
const bName = document.getElementById('bName');
const btnAddBuilding = document.getElementById('btnAddBuilding');
const fBuildingSel = document.getElementById('fBuildingSel');
const fFloorNum = document.getElementById('fFloorNum');
const fImageUrl = document.getElementById('fImageUrl');
const btnAddFloor = document.getElementById('btnAddFloor');
const fileInput = document.getElementById('floorImageFile');
const btnUpload = document.getElementById('btnUploadImage');

// 관리 탭
const searchBuilding = document.getElementById('searchBuilding');
const searchFloor = document.getElementById('searchFloor');
const floorList = document.getElementById('floorList');

// 편집 탭
const selBuildingSel = document.getElementById('selBuildingSel');
const selFloor = document.getElementById('selFloor');
const btnLoadFloor = document.getElementById('btnLoadFloor');

// --- 유틸리티 함수 ---
function setStatus(t) { 
  statusEl.innerText = t; 
  console.log(`[Status] ${t}`);
}

// 탭 전환 로직
tabs.forEach(tab => {
  tab.onclick = () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    mode = tab.dataset.mode;
    switchView(mode);
  };
});

function switchView(m) {
  views.forEach(v => v.style.display = 'none');
  const targetView = document.getElementById(`view-${m}`);
  if (targetView) targetView.style.display = 'block';
}

// --- 데이터 로딩 로직 ---

async function loadBuildings() {
  const { data, error } = await supabase.from('buildings').select('*');
  if (!error) {
    buildings = data || [];
    fillBuildingSelect(fBuildingSel);
    fillBuildingSelect(selBuildingSel);
  } else {
    setStatus('건물 로드 실패');
  }
}

function fillBuildingSelect(sel) {
  if (!sel) return;
  sel.innerHTML = '<option value="">건물 선택</option>';
  buildings.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = `${b.name || '건물'} (ID ${b.id})`;
    sel.appendChild(opt);
  });
}

async function loadFloors() {
  const { data, error } = await supabase.from('floors').select('*');
  if (!error) {
    floors = data || [];
    renderFloorList();
  } else {
    setStatus('층 목록 로드 실패');
  }
}

function renderFloorList() {
  const bFilter = searchBuilding.value.trim();
  const fFilter = searchFloor.value.trim();
  floorList.innerHTML = '';

  const filtered = floors.filter(x => {
    const matchB = !bFilter || String(x.building_id).includes(bFilter);
    const matchF = !fFilter || String(x.floor_number).includes(fFilter);
    return matchB && matchF;
  });

  if (filtered.length === 0) {
    floorList.innerHTML = '<div class="item">데이터가 없습니다.</div>';
    return;
  }

  filtered.forEach(x => {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div class="item-info">건물 ${x.building_id} / ${x.floor_number}층</div>
      <div class="item-actions">
        <button class="secondary" data-id="${x.id}" data-action="edit">수정</button>
        <button class="secondary" data-id="${x.id}" data-action="delete">삭제</button>
      </div>`;
    floorList.appendChild(div);
  });

  floorList.querySelectorAll('.item-actions button').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'delete') {
        if (!confirm('정말 삭제하시겠습니까?')) return;
        const { error } = await supabase.from('floors').delete().eq('id', id);
        if (!error) loadFloors();
      } else if (action === 'edit') {
        const floor = floors.find(f => String(f.id) === String(id));
        const newImg = prompt('새 이미지 URL을 입력하세요', floor.map_image_url || '');
        if (newImg) {
          const { error } = await supabase.from('floors').update({ map_image_url: newImg }).eq('id', id);
          if (!error) loadFloors();
        }
      }
    };
  });
}

// --- 등록 기능 ---

btnAddBuilding.onclick = async () => {
  const name = bName.value.trim();
  if (!name) { setStatus('건물 이름을 입력하세요.'); return; }

  const { error } = await supabase.from('buildings').insert({ name });
  if (error) {
    setStatus('건물 추가 실패');
  } else {
    setStatus('건물 추가 완료');
    bName.value = '';
    await loadBuildings();
  }
};

btnUpload.onclick = async () => {
  try {
    const file = fileInput.files?.[0];
    if (!file) { alert('파일을 선택해주세요.'); return; }

    const fileExt = file.name.split('.').pop()?.toLowerCase();
    const fileName = `indoor/floor_${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('maps')
      .upload(fileName, file, { upsert: true });

    if (uploadError) throw uploadError;

    const { data: pub } = supabase.storage.from('maps').getPublicUrl(fileName);
    fImageUrl.value = pub.publicUrl;
    setStatus('이미지 업로드 성공');
  } catch (e) {
    console.error(e);
    alert('업로드 실패: ' + e.message);
  }
};

btnAddFloor.onclick = async () => {
  const bid = Number(fBuildingSel.value);
  const flr = Number(fFloorNum.value);
  const img = fImageUrl.value.trim();

  if (!bid || !flr || !img) { setStatus('모든 필드를 채워주세요.'); return; }

  const { error } = await supabase.from('floors').insert({
    building_id: bid,
    floor_number: flr,
    map_image_url: img,
    scale: 1.0
  });

  if (error) {
    setStatus('평면도 등록 실패');
  } else {
    setStatus('평면도 등록 완료');
    fFloorNum.value = '';
    fImageUrl.value = '';
    await loadFloors();
  }
};

// --- 편집 기능 (Map & Nodes/Edges) ---

btnLoadFloor.onclick = async () => {
  const bid = Number(selBuildingSel.value);
  const flr = Number(selFloor.value);
  if (!bid || !flr) { setStatus('건물과 층을 선택하세요.'); return; }

  const { data: floor, error } = await supabase.from('floors')
    .select('*').eq('building_id', bid).eq('floor_number', flr).single();

  if (error || !floor) { setStatus('평면도를 찾을 수 없습니다.'); return; }

  currentFloor = floor;
  await loadNodesEdges(floor.id);
  loadImage(floor);
  setStatus(`편집 중: ${floor.building_id}번 건물 ${floor.floor_number}층 (Scale: ${floor.scale || 1})`);
};

async function loadNodesEdges(floorId) {
  const { data: n } = await supabase.from('indoor_nodes').select('*').eq('floor_id', floorId);
  const { data: e } = await supabase.from('indoor_edges').select('*');
  
  nodes = n || [];
  edges = (e || []).filter(ed => 
    nodes.some(nn => nn.id === ed.from_node) && 
    nodes.some(nn => nn.id === ed.to_node)
  );
  renderMap();
}

function loadImage(floor) {
  if (imageLayer) map.removeLayer(imageLayer);
  const w = 1000, h = 1000; 
  const bounds = [[0, 0], [h, w]];
  imageLayer = L.imageOverlay(floor.map_image_url, bounds).addTo(map);
  map.fitBounds(bounds);
}

function renderMap() {
  nodeMarkers.forEach(m => map.removeLayer(m));
  edgeLines.forEach(l => map.removeLayer(l));
  nodeMarkers = []; edgeLines = [];

  edges.forEach(e => {
    const from = nodes.find(n => n.id === e.from_node);
    const to = nodes.find(n => n.id === e.to_node);
    if (!from || !to) return;

    const line = L.polyline([[from.y, from.x], [to.y, to.x]], styleEdge(e)).addTo(map);
    line.on('click', () => openEdgeModal(e));
    edgeLines.push(line);
  });

  nodes.forEach(n => {
    const m = L.circleMarker([n.y, n.x], {
      radius: 7, color: '#2563eb', weight: 3, fillOpacity: 0.8, draggable: true
    }).addTo(map);
    
    m.bindTooltip(`${n.name || '노드'} (ID: ${n.id})`);
    
    m.on('dragend', async ev => {
      const { lat, lng } = ev.target.getLatLng();
      await supabase.from('indoor_nodes').update({ x: lng, y: lat }).eq('id', n.id);
      loadNodesEdges(currentFloor.id);
    });

    m.on('click', () => handleNodeSelect(n));
    nodeMarkers.push(m);
  });
}

function styleEdge(e) {
  if (e.type === 'stairs') return { color: '#ef4444', dashArray: '5, 5', weight: 3 };
  if (e.type === 'elevator') return { color: '#3b82f6', weight: 6 };
  return { color: '#10b981', weight: 3 };
}

// --- [핵심] 노드 선택 및 Shift 연속 생성 로직 ---

async function handleNodeSelect(n) {
  // 1. Shift 키가 눌려있는 경우 (연속 생성 모드)
  if (isShiftPressed) {
    shiftSelectionQueue.push(n.id);
    setStatus(`연속 선택 중: ${shiftSelectionQueue.length}개 노드`);
    
    const marker = nodeMarkers.find(m => m.getLatLng().lat === n.y && m.getLatLng().lng === n.x);
    if (marker) marker.setStyle({ color: '#f59e0b', weight: 5 }); // 주황색 강조
    return;
  }

  // 2. Shift 키가 없는 경우 (기존 1:1 방식)
  if (selectedNodes.includes(n.id)) {
    selectedNodes = selectedNodes.filter(id => id !== n.id);
  } else {
    selectedNodes.push(n.id);
  }

  setStatus(`노드 선택: ${selectedNodes.length} / 2`);

  if (selectedNodes.length === 2) {
    await createEdge(selectedNodes[0], selectedNodes[1]);
    selectedNodes = [];
    loadNodesEdges(currentFloor.id);
  }
}

// Shift 키 이벤트 핸들러
document.addEventListener('keydown', (e) => {
  if (e.key === 'Shift' && !isShiftPressed) {
    isShiftPressed = true;
    shiftSelectionQueue = [];
    setStatus('연속 생성 모드 활성화 (Shift)');
  }
});

document.addEventListener('keyup', async (e) => {
  if (e.key === 'Shift' && isShiftPressed) {
    isShiftPressed = false;

    if (shiftSelectionQueue.length < 2) {
      setStatus('선택된 노드가 부족합니다.');
      resetNodeStyles();
      return;
    }

    const confirmMsg = `총 ${shiftSelectionQueue.length - 1}개의 경로를 생성하시겠습니까?\n(모두 'walk', '양방향'으로 설정됩니다)`;
    if (!confirm(confirmMsg)) {
      resetNodeStyles();
      shiftSelectionQueue = [];
      setStatus('생성이 취소되었습니다.');
      return;
    }

    setStatus('연속 엣지 생성 중...');
    try {
      for (let i = 0; i < shiftSelectionQueue.length - 1; i++) {
        await createEdgeBatch(shiftSelectionQueue[i], shiftSelectionQueue[i + 1]);
      }
      setStatus('연속 생성 완료!');
    } catch (err) {
      console.error(err);
      setStatus('생성 중 오류 발생');
    } finally {
      shiftSelectionQueue = [];
      resetNodeStyles();
      loadNodesEdges(currentFloor.id);
    }
  }
});

function resetNodeStyles() {
  nodeMarkers.forEach(m => m.setStyle({ color: '#2563eb', weight: 3 }));
}

// 기존 단일 엣지 생성 (Prompt 포함)
async function createEdge(a, b) {
  const from = nodes.find(n => n.id === a);
  const to = nodes.find(n => n.id === b);
  if (!from || !to) return;

  const pxDist = calcPxDistance(from, to);
  const type = prompt('경로 타입 입력 (walk / stairs / elevator)', 'walk') || 'walk';
  const bidir = confirm('양방향 경로입니까? (확인: 양방향, 취소: 단방향)');
  const direction = bidir ? 'bidirectional' : 'one-way';
  const is_bidirectional = bidir;

  let realDist = 0;
  if (!currentFloor.scale || currentFloor.scale === 1) {
    const mInput = prompt(`[축척 미설정] 이 구간의 실제 거리(m)를 입력하세요:\n현재 픽셀 거리: ${pxDist.toFixed(2)}px`, pxDist.toFixed(2));
    if (mInput && !isNaN(mInput) && parseFloat(mInput) > 0) {
      const mDist = parseFloat(mInput);
      const newScale = pxDist / mDist;
      await supabase.from('floors').update({ scale: newScale }).eq('id', currentFloor.id);
      currentFloor.scale = newScale;
      realDist = mDist;
    } else {
      alert('입력이 취소되었습니다.');
      return;
    }
  } else {
    realDist = pxDist / currentFloor.scale;
  }

  await supabase.from('indoor_edges').insert({
    from_node: from.id, to_node: to.id, distance: realDist,
    px_distance: pxDist, type, direction, is_bidirectional
  });
}

// [추가] Shift용 배치 생성 (Prompt 없음)
async function createEdgeBatch(a, b) {
  const from = nodes.find(n => n.id === a);
  const to = nodes.find(n => n.id === b);
  if (!from || !to) return;

  const pxDist = calcPxDistance(from, to);
  const realDist = (currentFloor.scale && currentFloor.scale !== 1) ? (pxDist / currentFloor.scale) : pxDist;

  await supabase.from('indoor_edges').insert({
    from_node: from.id,
    to_node: to.id,
    distance: realDist,
    px_distance: pxDist,
    type: 'walk',
    direction: 'bidirectional',
    is_bidirectional: true
  });
}

// 엣지 수정/삭제
async function openEdgeModal(e) {
  const action = prompt(`[EDGE ID: ${e.id}]\n1: 수정\n2: 삭제\n3: [층 전체] 축척 재설정\n\n현재 정보:\n타입: ${e.type}\n거리: ${e.distance.toFixed(2)}m`);

  if (action === '2') {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await supabase.from('indoor_edges').delete().eq('id', e.id);
    loadNodesEdges(currentFloor.id);
    return;
  }

  if (action === '1') {
    const dist = parseFloat(prompt('실제 거리(m)를 입력하세요', e.distance));
    const type = prompt('경로 타입을 입력하세요 (walk/stairs/elevator)', e.type);
    const bidir = confirm('양방향 경로입니까?');
    if (!isNaN(dist) && type) {
      await supabase.from('indoor_edges').update({
        distance: dist, type, direction: bidir ? 'bidirectional' : 'one-way', is_bidirectional: bidir
      }).eq('id', e.id);
      loadNodesEdges(currentFloor.id);
    }
  }

  if (action === '3') {
    const input = prompt('새 축척 기준을 입력하세요.\n형식: "픽셀거리,실제거리" (예: 150,5)');
    if (input && input.includes(',')) {
      const [pStr, mStr] = input.split(',');
      const pVal = parseFloat(pStr), mVal = parseFloat(mStr);
      if (!isNaN(pVal) && !isNaN(mVal) && mVal > 0) {
        await supabase.from('floors').update({ scale: pVal / mVal }).eq('id', currentFloor.id);
        location.reload();
      }
    }
  }
}

// --- 거리 계산 및 기타 ---

function calcPxDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

map.on('dblclick', async (e) => {
  if (!currentFloor) { setStatus('먼저 평면도를 불러오세요.'); return; }
  const name = prompt('새 노드의 이름을 입력하세요');
  if (!name) return;

  const { error } = await supabase.from('indoor_nodes').insert({
    name, x: e.latlng.lng, y: e.latlng.lat,
    building_id: currentFloor.building_id, floor_id: currentFloor.id, type: 'normal'
  });

  if (error) setStatus('노드 생성 실패');
  else loadNodesEdges(currentFloor.id);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    selectedNodes = [];
    setStatus('선택이 초기화되었습니다.');
  }
});

searchBuilding.oninput = renderFloorList;
searchFloor.oninput = renderFloorList;

async function init() {
  await loadBuildings();
  await loadFloors();
}

init();

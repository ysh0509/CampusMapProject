import { protectPage } from '../common/adminRouterGuard.js';
import { initAdminHeader } from '../common/adminHeader.js';
import { supabase } from '../common/adminApi.js';
import { logAction } from '../common/adminLogger.js';

await protectPage();
initAdminHeader('elevation');

// =========================
// MAP
// =========================
const map = L.map('map').setView([37.5585, 126.9980], 18);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: 'OSM'
}).addTo(map);

// =========================
// STATE
// =========================
let nodes = [];
let markers = [];
let selected = [];
let isDragging = false;
let dragStart = null;
let dragBox = null;


// =========================
// LOAD
// =========================
async function loadNodes() {
  clear();

  const { data } = await supabase
    .from('outdoor_nodes')
    .select('*');

  nodes = data || [];
  renderNodes();
}

function clear() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
}


// =========================
// RENDER
// =========================
function renderNodes() {
  nodes.forEach((n, idx) => {

    const isSelected = selected.includes(n.id);
    const isLocked = n.is_locked;

    const marker = L.circleMarker([n.lat, n.lng], {
      radius: isSelected ? 9 : 6,
      color: isLocked ? '#9ca3af' : (isSelected ? '#f59e0b' : '#2563eb'),
      weight: 2
    }).addTo(map);

    // ✅ 겹침 방지 offset
    const offset = (idx % 5) * 6;

    const label = L.marker([n.lat, n.lng], {
      icon: L.divIcon({
        className: 'elev-label',
        html: `<div style="
          font-size:11px;
          background:white;
          color:black;          /* ✅ 글자 색상을 검정색으로 설정 */
          padding:2px 4px;
          border-radius:4px;
          transform: translate(${offset}px, ${-10 - offset}px);
        ">
          ${n.elevation ?? '-'}
        </div>` // ✅ 닫는 태그 오타 수정 (</div -> </div>)
      }),
      interactive: false
    }).addTo(map);

    marker.on('click', (e) => handleSelect(n, e));

    markers.push(marker);
    markers.push(label);
  });
}



// =========================
// SELECT
// =========================
function handleSelect(node, e) {

  if (e.originalEvent.ctrlKey) {
    if (selected.includes(node.id)) {
      selected = selected.filter(id => id !== node.id);
    } else {
      selected.push(node.id);
    }
  } else {
    selected = [node.id];
  }

  updateInfo();
  refresh();
}

function refresh() {
  clear();
  renderNodes();
}

function updateInfo() {
  const el = document.getElementById('selection-info');
  if (el) {
    el.innerText = `선택: ${selected.length} / ${nodes.length}`;
  }
}


// =========================
// APPLY
// =========================
window.applyElevation = async function () {

  const input = document.getElementById('elevation-input');
  const value = parseFloat(input.value);

  if (selected.length === 0) {
    alert('노드 선택 필요');
    return;
  }

  if (isNaN(value)) {
    alert('고도 입력 필요');
    return;
  }

  // ✅ 잠금 제외 대상 추출
  const target = nodes.filter(n =>
    selected.includes(n.id) && !n.is_locked
  );

  if (target.length === 0) {
    alert('모든 선택 노드가 잠금 상태');
    return;
  }

  // ✅ 로그를 위한 변경 전 데이터 수집
  const beforeData = target.map(n => ({ id: n.id, elevation: n.elevation }));
  const afterData = target.map(n => ({ id: n.id, elevation: parseFloat(value.toFixed(2)) }));

  const { error } = await supabase
    .from('outdoor_nodes')
    .update({
      elevation: parseFloat(value.toFixed(2))
    })
    .in('id', target.map(n => n.id));

  if (!error) {
    // ✅ 성공 시 로그 기록 (일괄 수정이므로 target_id는 null, description에 상세 내용 포함)
    await logAction({
      action: 'batch_update',
      target_type: 'outdoor_nodes',
      target_id: null,
      description: `고도 일괄 수정: ${target.length}개 노드 -> ${value}m`,
      before: beforeData,
      after: afterData
    });
  } else {
    console.error('고도 업데이트 실패', error);
  }

  selected = [];
  input.value = '';

  await loadNodes();
  updateInfo();
};




// =========================
// AUTO (BATCH)
// =========================
window.autoFillElevation = async function () {

  if (selected.length === 0) {
    alert('노드 선택 필요');
    return;
  }

  const target = nodes.filter(n =>
    selected.includes(n.id) && !n.is_locked
  );

  let success = 0;

  for (let i = 0; i < target.length; i++) {

    const n = target[i];

    setStatus(`처리중 ${i + 1}/${target.length}`);

    try {
      const url = `https://api.open-meteo.com/v1/elevation?latitude=${n.lat}&longitude=${n.lng}`;
      const res = await fetch(url);
      const json = await res.json();

      const elevation = await getElevation(n.lat, n.lng);


      if (elevation != null) {
        await supabase
          .from('outdoor_nodes')
          .update({
            elevation: parseFloat(elevation.toFixed(2))
          })
          .eq('id', n.id);

        success++;
      }

      await new Promise(r => setTimeout(r, 100));

    } catch (e) {
      console.error(e);
    }
  }

  setStatus(`완료: ${success}/${target.length}`);

  selected = [];
  await loadNodes();
  updateInfo();
};



// =========================
// SELECT NULL
// =========================
window.selectNoElevation = function () {

  selected = nodes
    .filter(n => n.elevation == null)
    .map(n => n.id);

  refresh();
  updateInfo();
};

// =========================
//status
// =========================
function setStatus(text) {
  const el = document.getElementById('status-text');
  if (el) el.innerText = text;
}

// =========================
//중앙값 함수
// =========================
function getMedian(values) {
  if (!values.length) return null;

  values.sort((a, b) => a - b);

  const mid = Math.floor(values.length / 2);

  return values.length % 2
    ? values[mid]
    : (values[mid - 1] + values[mid]) / 2;
}

// =========================
// 다중 샘플링 + 중앙값
// =========================
async function getElevation(lat, lng) {

  const offsets = [
    [0,0],
    [0.00001,0], [-0.00001,0],
    [0,0.00001], [0,-0.00001],
    [0.00001,0.00001], [-0.00001,-0.00001]
  ];

  const values = [];

  for (const o of offsets) {

    const url =
      `https://api.open-meteo.com/v1/elevation?latitude=${lat + o[0]}&longitude=${lng + o[1]}`;

    try {
      const res = await fetch(url);
      const json = await res.json();

      const v = json.elevation?.[0];

      if (v != null) values.push(v);

    } catch (e) {
      console.error(e);
    }
  }

  return getMedian(values);
}


// =========================
// 전체 선택
// =========================
window.selectAllNodes = function () {

  selected = nodes.map(n => n.id);

  refresh();
  updateInfo();
};

// =========================
// 선택 해제
// =========================
window.clearSelection = function () {

  selected = [];

  refresh();
  updateInfo();
};

//shift 기능
map.on('mousedown', (e) => {

  if (!e.originalEvent.shiftKey) return;

  isDragging = true;
  dragStart = e.latlng;

  dragBox = L.rectangle([dragStart, dragStart], {
    color: '#2563eb',
    weight: 1,
    dashArray: '4,4'
  }).addTo(map);

  map.dragging.disable();
});

map.on('mousemove', (e) => {

  if (!isDragging || !dragBox) return;

  dragBox.setBounds([dragStart, e.latlng]);
});

map.on('mouseup', () => {

  if (!isDragging) return;

  const bounds = dragBox.getBounds();

  nodes.forEach(n => {
    if (bounds.contains([n.lat, n.lng])) {
      if (!selected.includes(n.id)) {
        selected.push(n.id);
      }
    }
  });

  map.removeLayer(dragBox);
  dragBox = null;
  isDragging = false;

  map.dragging.enable();

  refresh();
  updateInfo();
});

// =========================
// LOCK
// =========================
window.lockNodes = async function () {

  if (selected.length === 0) {
    alert('노드 선택 필요');
    return;
  }

  await supabase
    .from('outdoor_nodes')
    .update({ is_locked: true })
    .in('id', selected);

  await loadNodes();
};

// =========================
// UNLOCK
// =========================
window.unlockNodes = async function () {

  if (selected.length === 0) {
    alert('노드 선택 필요');
    return;
  }

  await supabase
    .from('outdoor_nodes')
    .update({ is_locked: false })
    .in('id', selected);

  await loadNodes();
};



// =========================
// INIT
// =========================
loadNodes();

// js/admin/indoor/transfer_edges.js

import { supabase }
from '../common/adminApi.js';

import { protectPage }
from '../common/adminRouterGuard.js';

import { initAdminHeader }
from '../common/adminHeader.js';

import { logAction } from '../common/adminLogger.js';


await protectPage();

initAdminHeader('gate');

/* =========================
   MAP INIT
========================= */

const transferMap =
L.map('map')
.setView([37.5585,126.9980],18);

L.tileLayer(
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  {
    maxZoom:22
  }
).addTo(transferMap);

/* =========================
   STATE
========================= */

let transferOutdoorNodes = [];

let transferBuildings = [];

let transferEdgeList = [];

let transferIndoorNodes = [];

let selectedTransferOutdoor = null;

let selectedTransferIndoor = null;

let transferOutdoorMarkers = [];

/* =========================
   DOM
========================= */

const outdoorSelectedBox =
document.getElementById('outdoorSelected');

const indoorSelectedBox =
document.getElementById('indoorSelected');

const buildingSelectEl =
document.getElementById('buildingSelect');

const floorSelectEl =
document.getElementById('floorSelect');

const roomSearchEl =
document.getElementById('roomSearch');

const floorImageEl =
document.getElementById('floorImage');

const floorWrapperEl =
document.getElementById('floorWrapper');

const createBtnEl =
document.getElementById('createBtn');

/* =========================
   INIT
========================= */

initializeTransferPage();

async function initializeTransferPage() {

  // outdoor
  const { data:outdoorData,
          error:outdoorError } =
  await supabase
  .from('outdoor_nodes')
  .select('*');

  if (outdoorError) {
    showTransferError(outdoorError);
    return;
  }

  // buildings
  const { data:buildingData,
          error:buildingError } =
  await supabase
  .from('buildings')
  .select('*')
  .order('name');

  if (buildingError) {
    showTransferError(buildingError);
    return;
  }

  // transfers
  const { data:transferData,
          error:transferError } =
  await supabase
  .from('transfer_edges')
  .select('*');

  if (transferError) {
    showTransferError(transferError);
    return;
  }

  transferOutdoorNodes =
  outdoorData || [];

  transferBuildings =
  buildingData || [];

  transferEdgeList =
  transferData || [];

  renderTransferOutdoorNodes();

  renderTransferBuildings();
}

/* =========================
   OUTDOOR NODES
========================= */

function renderTransferOutdoorNodes() {

  transferOutdoorMarkers.forEach(marker => {

    transferMap.removeLayer(marker);
  });

  transferOutdoorMarkers = [];

  transferOutdoorNodes.forEach(node => {

    const marker =
    L.circleMarker(
      [node.lat,node.lng],
      {
        radius:6,
        color:'#2563eb',
        fillColor:'#2563eb',
        fillOpacity:1,
        weight:2
      }
    ).addTo(transferMap);

    transferOutdoorMarkers.push(marker);

    marker.bindTooltip(
      node.name || `Outdoor ${node.id}`
    );

    marker.on('click', () => {

      selectedTransferOutdoor = node;

      transferOutdoorMarkers
      .forEach(m => {

        m.setStyle({
          color:'#2563eb',
          fillColor:'#2563eb'
        });
      });

      marker.setStyle({
        color:'#dc2626',
        fillColor:'#dc2626'
      });

      const linkedCount =
      transferEdgeList.filter(edge =>

        edge.outdoor_node_id
        === node.id

      ).length;

      outdoorSelectedBox.innerText =
      `${node.name || node.id}
(${linkedCount}개 연결됨)`;

      renderTransferIndoorNodes();
    });
  });
}

/* =========================
   BUILDINGS
========================= */

function renderTransferBuildings() {

  buildingSelectEl.innerHTML =
  '<option value="">선택</option>';

  transferBuildings.forEach(building => {

    const option =
    document.createElement('option');

    option.value = building.id;

    option.innerText = building.name;

    buildingSelectEl
    .appendChild(option);
  });
}

/* =========================
   BUILDING CHANGE
========================= */

buildingSelectEl.onchange =
async () => {

  const buildingId =
  buildingSelectEl.value;

  resetTransferFloorUI();

  if (!buildingId) return;

  const { data, error } =
  await supabase
  .from('floors')
  .select('*')
  .eq('building_id', buildingId)
  .order('floor_number');

  if (error) {
    showTransferError(error);
    return;
  }

  renderTransferFloors(data || []);
};

/* =========================
   RESET FLOOR
========================= */

function resetTransferFloorUI() {

  floorSelectEl.innerHTML =
  '<option value="">선택</option>';

  floorImageEl.src = '';

  transferIndoorNodes = [];

  selectedTransferIndoor = null;

  indoorSelectedBox.innerText =
  '없음';

  clearTransferIndoorNodes();
}

/* =========================
   FLOORS
========================= */

function renderTransferFloors(floorList) {

  floorSelectEl.innerHTML =
  '<option value="">선택</option>';

  floorList.forEach(floor => {

    const option =
    document.createElement('option');

    option.value = floor.id;

    option.innerText =
    `${floor.floor_number}층`;

    floorSelectEl
    .appendChild(option);
  });
}

/* =========================
   FLOOR CHANGE
========================= */

floorSelectEl.onchange =
async () => {

  const floorId =
  floorSelectEl.value;

  if (!floorId) return;

  clearTransferIndoorNodes();

  // floor
  const { data:floorData,
          error:floorError } =
  await supabase
  .from('floors')
  .select('*')
  .eq('id', floorId)
  .single();

  if (floorError) {
    showTransferError(floorError);
    return;
  }

  // indoor nodes
  const { data:indoorData,
          error:indoorError } =
  await supabase
  .from('indoor_nodes')
  .select('*')
  .eq('floor_id', floorId);

  if (indoorError) {
    showTransferError(indoorError);
    return;
  }

  transferIndoorNodes =
  indoorData || [];

  floorImageEl.onload = () => {

    renderTransferIndoorNodes();
  };

  floorImageEl.src =
  floorData.map_image_url || '';
};

/* =========================
   CLEAR INDOOR NODES
========================= */

function clearTransferIndoorNodes() {

  document
  .querySelectorAll('.indoorNode')
  .forEach(el => el.remove());
}

/* =========================
   RENDER INDOOR NODES (List Mode)
========================= */

function renderTransferIndoorNodes() {
  // 1. 기존 렌더링 내용 및 마커 삭제
  clearTransferIndoorNodes();

  // 2. 목록 스타일을 위한 컨테이너 초기화 (필요 시)
  // floorWrapper 내부에 이미지 대신 목록을 보여주기 위해 내부를 비웁니다.
  // 만약 이미지가 이미 로드된 상태라면 floorImageEl.style.display = 'none' 처리가 필요할 수 있습니다.
  if (floorImageEl.src && floorImageEl.src !== '') {
    floorImageEl.style.display = 'none'; // 목록 모드일 때는 이미지 숨김
  }

  // 3. 필터링 및 목록 생성
  transferIndoorNodes.forEach(node => {
    // 공백만 있거나 빈 문자열인 노드명 필터링
    const nodeName = (node.name || '').trim();
    if (nodeName === '') {
      return; // 이름이 없으면 건너뜀
    }

    // 4. 목록 아이템(li 또는 div) 생성
    const listItem = document.createElement('div');
    listItem.className = 'indoor-node-list-item'; // CSS로 스타일링 가능
    listItem.style.padding = '10px';
    listItem.style.borderBottom = '1px solid var(--border-color)';
    listItem.style.cursor = 'pointer';
    listItem.style.fontSize = '0.9rem';

    // 이미 연결된 상태인지 확인
    const linked = transferEdgeList.some(edge =>
      edge.outdoor_node_id === selectedTransferOutdoor?.id &&
      edge.indoor_node_id === node.id
    );

    // 5. 항목 내용 구성
    if (linked) {
      listItem.innerHTML = `<span style="color: #9ca3af;">${nodeName} (연결됨)</span>`;
      listItem.style.opacity = '0.6';
    } else {
      listItem.innerHTML = `<span>${nodeName}</span>`;
      
      // 선택 상태 표시
      if (selectedTransferIndoor && selectedTransferIndoor.id === node.id) {
        listItem.style.backgroundColor = 'var(--accent-primary-light, #e0e7ff)';
        listItem.style.fontWeight = 'bold';
      }
    }

    // 6. 클릭 이벤트 (기존 로직 유지)
    listItem.onclick = () => {
      if (linked) {
        alert('이미 연결된 노드');
        return;
      }

      selectedTransferIndoor = node;
      indoorSelectedBox.innerText = nodeName;

      // 선택 효과 업데이트를 위해 전체 목록 다시 렌더링 (UI 동기화)
      renderTransferIndoorNodes();
    };

    // 7. floorWrapper에 추가
    floorWrapperEl.appendChild(listItem);
  });
}



/* =========================
   ROOM SEARCH
========================= */

roomSearchEl.oninput = e => {

  const keyword =
  e.target.value
  .trim()
  .toLowerCase();

  document
  .querySelectorAll('.indoorNode')
  .forEach(nodeEl => {

    const matched =
    nodeEl.title
    .toLowerCase()
    .includes(keyword);

    nodeEl.style.display =
      matched || !keyword
      ? 'block'
      : 'none';
  });
};

/* =========================
   CREATE TRANSFER
========================= */

createBtnEl.onclick =
async () => {

  if (!selectedTransferOutdoor) {

    alert(
    '외부 노드 선택 필요');

    return;
  }

  if (!selectedTransferIndoor) {

    alert(
    '실내 노드 선택 필요');

    return;
  }

  const duplicated =
  transferEdgeList.some(edge =>

    edge.outdoor_node_id
    === selectedTransferOutdoor.id

    &&

    edge.indoor_node_id
    === selectedTransferIndoor.id
  );

  if (duplicated) {

    alert(
    '이미 연결된 노드');

    return;
  }

  const { data, error } =
  await supabase
  .from('transfer_edges')
  .insert({

    outdoor_node_id:
    selectedTransferOutdoor.id,

    indoor_node_id:
    selectedTransferIndoor.id,

    type:'door',

    direction:'bidirectional'
  })
  .select()
  .single();

  if (error) {

    showTransferError(error);

    return;
  }

  transferEdgeList.push(data);

  alert('연결 생성 완료');

  renderTransferIndoorNodes();
};

/* =========================
   ERROR
========================= */

function showTransferError(error) {

  console.error(error);

  alert(

    `DB 오류\n\n` +

    `message:\n${error.message}\n\n` +

    `details:\n${error.details || '-'}\n\n` +

    `hint:\n${error.hint || '-'}\n\n` +

    `code:\n${error.code || '-'}`
  );
}
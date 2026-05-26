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
   RENDER INDOOR NODES
========================= */

function renderTransferIndoorNodes() {

  clearTransferIndoorNodes();

  transferIndoorNodes.forEach(node => {

    const nodeEl =
    document.createElement('div');

    nodeEl.className =
    'indoorNode';

    // 픽셀 좌표
    nodeEl.style.left =
    `${node.x}px`;

    nodeEl.style.top =
    `${node.y}px`;

    nodeEl.title =
    node.name || `Node ${node.id}`;

    const linked =
    transferEdgeList.some(edge =>

      edge.outdoor_node_id
      === selectedTransferOutdoor?.id

      &&

      edge.indoor_node_id
      === node.id
    );

    // 이미 연결됨
    if (linked) {

      nodeEl.style.opacity =
      '0.4';

      nodeEl.style.background =
      '#9ca3af';
    }

    // 선택 상태 유지
    if (
      selectedTransferIndoor &&
      selectedTransferIndoor.id
      === node.id
    ) {

      nodeEl.classList.add('active');
    }

    nodeEl.onclick = () => {

      if (linked) {

        alert(
        '이미 연결된 노드');

        return;
      }

      selectedTransferIndoor =
      node;

      indoorSelectedBox.innerText =
      node.name || node.id;

      document
      .querySelectorAll('.indoorNode')
      .forEach(el => {

        el.classList.remove(
        'active');
      });

      nodeEl.classList.add(
      'active');
    };

    floorWrapperEl
    .appendChild(nodeEl);
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
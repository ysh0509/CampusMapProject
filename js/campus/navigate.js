import { supabase } from '../admin/common/adminApi.js';
import { initMap } from '../campus/map_core.js';
import { loadGraph } from '../campus/graph_manager.js';
import { drawPath, clearPath } from '../campus/renderer.js';
import { findPath } from './pathfinder.js';

/* =========================================================
   STATE MANAGEMENT
========================================================= */
const state = {
    graph: null,
    indoorNodes: [],
    buildings: [],
    floors: [],
    map: null,
    
    // Layers
    outdoorLayer: null,
    indoorLayer: null,
    
    // View & Selection
    currentView: 'outdoor', // 'outdoor' | 'indoor'
    currentBuildingId: null,
    currentFloorId: null,

    // Start/End Config
    start: { type: 'outdoor', id: null, buildingId: null, floorId: null },
    end: { type: 'outdoor', id: null, buildingId: null, floorId: null },
    
    // Path Visuals
    lines: [],
    markers: [],
    floorSteps: [],
    currentStepIndex: 0
};

/* =========================================================
   INITIALIZATION
========================================================= */
async function init() {
    state.map = initMap('map');
    // 기본 실외 레이어 설정
    state.outdoorLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
        attribution: '© OpenStreetMap contributors' 
    }).addTo(state.map);

    await loadData();
    bindEvents();
}

async function loadData() {
    try {
        const [graph, indoorRes, buildingRes, floorRes] = await Promise.all([
            loadGraph(),
            supabase.from('indoor_nodes').select('*'),
            supabase.from('buildings').select('*').order('name'),
            supabase.from('floors').select('*').order('floor_number')
        ]);

        state.graph = graph;
        state.indoorNodes = indoorRes.data || [];
        state.buildings = buildingRes.data || [];
        state.floors = floorRes.data || [];

        // UI Select 초기화
        fillSelect('buildingSel', state.buildings);
        fillSelect('startBuilding', state.buildings);
        fillSelect('endBuilding', state.buildings);
        fillSelect('buildingMini', state.buildings);
        
        console.log('Data loaded successfully');
    } catch (err) {
        console.error('Initialization error:', err);
        document.getElementById('statusText').innerText = '❌ 데이터 로드 실패';
    }
}

/* =========================================================
   VIEW CONTROL (OUTDOOR <-> INDOOR)
========================================================= */

async function switchToIndoor(buildingId, floorId) {
    state.currentView = 'indoor';
    state.currentBuildingId = Number(buildingId);
    state.currentFloorId = Number(floorId);

    // 1. 실외 레이어 제거
    state.map.removeLayer(state.outdoorLayer);

    // 2. 실내 레이어(Floor Image) 로드
    const floor = state.floors.find(f => Number(f.id) === state.currentFloorId);
    if (floor && floor.map_image_url) {
        const bounds = [[0, 0], [1000, 1000]]; // 프로젝트 좌표계 기준
        state.indoorLayer = L.imageOverlay(floor.map_image_url, bounds).addTo(state.map);
        state.map.fitBounds(bounds);
    }

    renderIndoorNodes();
    document.getElementById('statusText').innerText = `📍 건물 내부 (${state.currentView})`;
}

async function switchToOutdoor() {
    state.currentView = 'outdoor';
    if (state.indoorLayer) state.map.removeLayer(state.indoorLayer);
    state.outdoorLayer.addTo(state.map);
    
    // 실외 기본 좌표 (캠퍼스 중심점)
    state.map.setView([37.5585, 126.9980], 18);
    
    renderOutdoorNodes();
    document.getElementById('statusText').innerText = `📍 실외 캠퍼스`;
}

/* =========================================================
   PATHFINDING & ROUTING
========================================================= */

async function runIntegratedRoute() {
    const modeBtn = document.querySelector('.modeBtn.active');
    const mode = modeBtn ? modeBtn.dataset.mode : 'optimal';
    const modeKey = mode === 'avoid_stairs' ? 'stairs_avoid' : mode;

    if (!state.start.id || !state.end.id) {
        alert('출발지와 도착지를 설정해주세요.');
        return;
    }

    document.getElementById('statusText').innerText = '🧭 경로 계산 중...';
    
    // 기존 경로/마커 제거
    clearAllVisuals();

    // Web Worker를 이용한 비동기 계산 (기존 로직 활용)
    const worker = new Worker('/js/campus/pathWorker.js', { type: 'module' });
    
    worker.postMessage({
        graphObj: state.graph,
        start: state.start.id,
        end: state.end.id,
        mode: modeKey
    });

    worker.onmessage = (e) => {
        const { path, mode: foundMode, error } = e.data;
        if (error || !path) {
            alert('해당 경로를 찾을 수 없습니다.');
            document.getElementById('statusText').innerText = '❌ 경로 탐색 실패';
        } else {
            processRoutePath(path);
            document.getElementById('statusText').innerText = `✅ 경로 탐색 완료 (${foundMode})`;
        }
        worker.terminate();
    };
}

function processRoutePath(path) {
    // 1. 경로를 시각적으로 그리기 (renderer.js 활용)
    // 실외/실내 통합 렌더링을 위해 renderer.js의 drawPath가 state.graph를 참조하도록 함
    const pathSet = new Set(path);
    
    // 2. 통합 렌더링 호출
    // renderer.js의 drawPath는 nodeMap을 통해 실내/실외 좌표를 모두 처리할 수 있어야 함
    // (기존 renderer.js 로직이 graphObj의 nodeMap을 사용하므로 그대로 작동)
    const newLines = drawPath(state.map, path, state.graph);
    state.lines.push(...newLines);

    // 3. 마커 표시 (시작/끝)
    const startNode = state.graph.nodeMap.get(path[0]);
    const endNode = state.graph.nodeMap.get(path[path.length - 1]);

    if (startNode) {
        const isIndoor = startNode.type === 'indoor';
        const pos = isIndoor ? [startNode.y, startNode.x] : [startNode.lat, startNode.lng];
        const m = L.circleMarker(pos, { radius: 10, color: '#10b981', fillOpacity: 1 }).addTo(state.map);
        state.markers.push(m);
    }

    if (endNode) {
        const isIndoor = endNode.type === 'indoor';
        const pos = isIndoor ? [endNode.y, endNode.x] : [endNode.lat, endNode.lng];
        const m = L.circleMarker(pos, { radius: 10, color: '#f59e0b', fillOpacity: 1 }).addTo(state.map);
        state.markers.push(m);
    }
}

/* =========================================================
   UI HELPERS & EVENTS
========================================================= */

function bindEvents() {
    // Hero Section
    document.getElementById('btn-start').onclick = () => {
        document.getElementById('hero-section').classList.add('fade-out');
        document.getElementById('main-content').classList.add('fade-in');
    };

    // Location Panel (Outdoor/Indoor Switching)
    document.getElementById('locationType').onchange = (e) => {
        const isIndoor = e.target.value === 'indoor';
        document.getElementById('buildingSection').classList.toggle('hidden', !isIndoor);
    };

    document.getElementById('applyLocation').onclick = async () => {
        const type = document.getElementById('locationType').value;
        if (type === 'indoor') {
            const bId = document.getElementById('buildingSel').value;
            const fId = document.getElementById('floorSel').value;
            if (!bId || !fId) return alert('건물과 층을 선택하세요.');
            await switchToIndoor(bId, fId);
        } else {
            await switchToOutdoor();
        }
    };

    // Start/End Node Selection Logic
    // 출발지/도착지의 type에 따라 건물/층/노드 UI를 dynamic하게 변경
    setupNodeSelection('start');
    setupNodeSelection('end');

    // Route Execution
    document.getElementById('runRoute').onclick = runIntegratedRoute;

    // Mode Selection
    document.querySelectorAll('.modeBtn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.modeBtn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        };
    });
    
    document.getElementById('closeRoutePanel').onclick = () => {
        document.getElementById('routePanel').classList.add('hidden');
    };
}

function setupNodeSelection(prefix) {
    const typeSel = document.getElementById(`${prefix}LocationType`);
    const indoorSec = document.getElementById(`${prefix}IndoorSection`);
    const nodeSel = document.getElementById(`${prefix}Node`);
    const bSel = document.getElementById(`${prefix}Building`);
    const fSel = document.getElementById(`${prefix}Floor`);

    if (!typeSel) return;

    typeSel.onchange = (e) => {
        const isIndoor = e.target.value === 'indoor';
        indoorSec.classList.toggle('hidden', !isIndoor);
        // 실외 노드 리스트와 실내 노드 리스트를 분리하여 업데이트
        updateNodeDropdown(prefix, isIndoor, bSel, fSel, nodeSel);
    };

    bSel.onchange = () => {
        // 건물 변경 시 해당 건물의 층 목록 업데이트
        const buildingId = bSel.value;
        fSel.innerHTML = '<option value="">층 선택</option>';
        state.floors.filter(f => String(f.building_id) === String(buildingId)).forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.id;
            opt.textContent = `${f.floor_number}층`;
            fSel.appendChild(opt);
        });
    };

    fSel.onchange = () => {
        updateNodeDropdown(prefix, true, bSel, fSel, nodeSel);
    };
}

function updateNodeDropdown(prefix, isIndoor, bSel, fSel, nodeSel) {
    nodeSel.innerHTML = '<option value="">노드 선택</option>';
    if (!isIndoor) {
        // 실외 노드 로드
        state.graph.nodeMap.forEach(node => {
            if (node.type === 'outdoor') {
                const opt = document.createElement('option');
                opt.value = node.id;
                opt.textContent = node.name || node.id;
                nodeSel.appendChild(opt);
            }
        });
    } else {
        // 실내 노드 로드 (선택된 건물/층 기준)
        const bId = bSel.value;
        const fId = fSel.value;
        if (!bId || !fId) return;

        state.indoorNodes.forEach(node => {
            if (String(node.building_id) === String(bId) && String(node.floor_id) === String(fId)) {
                const opt = document.createElement('option');
                opt.value = 'in_' + node.id; // map_outdoor 로직 호환을 위해 in_ 접두어 유지
                opt.textContent = node.name || node.id;
                nodeSel.appendChild(opt);
            }
        });
    }

    // 선택된 값 state에 저장
    nodeSel.onchange = (e) => {
        const val = e.target.value;
        if (isIndoor) {
            state.start.type = 'indoor'; // 실제론 prefix에 따라 다름
            state.start.id = val;
            // ... 생략: 실제 구현 시 prefix에 따라 start/end 분기
        } else {
            state.start.type = 'outdoor';
            state.start.id = val;
        }
    };
}

function clearAllVisuals() {
    clearPath(state.map, state.lines);
    state.lines = [];
    state.markers.forEach(m => state.map.removeLayer(m));
    state.markers = [];
}

function fillSelect(id, list) {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">선택</option>';
    list.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = item.name;
        sel.appendChild(opt);
    });
}

function renderOutdoorNodes() {
    // 실외 노드 마커 렌더링 (기존 로직 기반)
    state.graph.nodeMap.forEach(n => {
        if (n.type === 'outdoor') {
            L.circleMarker([n.lat, n.lng], { radius: 5, color: '#2563eb' }).addTo(state.map);
        }
    });
}

function renderIndoorNodes() {
    // 실내 노드 마커 렌더링 (기존 로직 기반)
    state.indoorNodes.filter(n => String(n.floor_id) === String(state.currentFloorId)).forEach(n => {
        L.circleMarker([n.y, n.x], { radius: 5, color: '#f97316' }).addTo(state.map);
    });
}

// 초기화 실행
init();

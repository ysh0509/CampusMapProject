import { supabase } from '/js/admin/common/adminApi.js';
import { initMap } from './map_core.js';
import { loadGraph } from './graph_manager.js';
import { drawPath, clearPath } from './renderer.js';
import { findPath } from './pathfinder.js';

/**
 * Campus Navigator - Advanced Unified Engine
 * 통합 내비게이션: 외부(지도 클릭/검색) + 내부(건물>층>노드 드롭다운)
 */

const state = {
    graph: null,
    indoorNodes: [],
    floors: [],
    buildings: [],
    map: null,
    
    // Layers
    outdoorLayer: null,
    indoorLayer: null, 
    
    // View State
    currentView: 'outdoor',
    currentBuildingId: null,
    currentFloorId: null,
    
    // Selection State (Requirement: External/Internal Switch)
    start: { type: null, id: null }, // type: 'outdoor' | 'indoor'
    end: { type: null, id: null },
    
    // Visuals
    lines: [],
    markers: [],          // Start/End selection markers
    selectionMarkers: [], // Clickable node markers
    
    // Theme
    theme: localStorage.getItem('campus-theme') || 'dark'
};

/* =========================================================
   CORE INITIALIZATION
   ========================================================= */

async function init() {
    console.log("🚀 Advanced Navigation Engine Initializing...");
    
    state.map = initMap('map');
    state.outdoorLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(state.map);

    applyTheme(state.theme);

    try {
        await loadAllData();
        console.log("✅ All Data Loaded");
    } catch (err) {
        console.error("❌ Data Load Error:", err);
        setStatus('❌ 데이터 로드 실패');
    }

    bindEvents();
}

async function loadAllData() {
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

    // 초기 데이터 채우기
    populateInitialUI();
}

/* =========================================================
   UI & DROPDOWN LOGIC (Requirement: Building > Floor > Node)
   ========================================================= */

function populateInitialUI() {
    // 1. 건물 선택 채우기
    fillSelect('startBuilding', state.buildings, 'name');
    fillSelect('endBuilding', state.buildings, 'name');
    
    // 2. 전체 건물 목록을 위한 초기화 (필요 시)
}

function fillSelect(elementId, data, keyField) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = '<option value="">선택하세요</option>';
    data.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = item[keyField];
        el.appendChild(opt);
    });
}

/**
 * [핵심] 층(Floor) 드롭다운 업데이트
 */
function fillFloorSelect(buildingId, targetSelectId) {
    const el = document.getElementById(targetSelectId);
    if (!el) return;
    el.innerHTML = '<option value="">층 선택</option>';
    
    const buildingFloors = state.floors.filter(f => String(f.building_id) === String(buildingId));
    buildingFloors.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = `${f.floor_number}F`;
        el.appendChild(opt);
    });
}

/**
 * [핵심] 노드(Node) 드롭다운 업데이트 (Requirement: 공백 제외)
 */
function fillNodeSelect(buildingId, floorId, targetSelectId) {
    const el = document.getElementById(targetSelectId);
    if (!el) return;
    el.innerHTML = '<option value="">노드 선택</option>';

    state.indoorNodes
        .filter(n => 
            String(n.building_id) === String(buildingId) && 
            String(n.floor_id) === String(floorId) &&
            n.name && n.name.trim() !== '' // Requirement 9: 공백 제외
        )
        .forEach(n => {
            const opt = document.createElement('option');
            opt.value = 'in_' + n.id; // Prefix for indoor identification
            opt.textContent = n.name.trim();
            el.appendChild(opt);
        });
}

/* =========================================================
   EVENT BINDING
   ========================================================= */

function bindEvents() {
    // 1. 테마 변경
    document.getElementById('themeBtn')?.addEventListener('click', () => {
        applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });

    // 2. 출발지 유형 토글 (외부/내부)
    document.querySelectorAll('[id^="startToggle"] .toggle').forEach(el => {
        el.addEventListener('click', (e) => {
            const type = e.currentTarget.dataset.type; // 'outdoor' or 'indoor'
            handleTypeToggle('start', type, e.currentTarget.parentElement);
        });
    });

    // 3. 도착지 유형 토글 (외부/내부)
    document.querySelectorAll('[id^="endToggle"] .toggle').forEach(el => {
        el.addEventListener('click', (e) => {
            const type = e.currentTarget.dataset.type;
            handleTypeToggle('end', type, e.currentTarget.parentElement);
        });
    });

    // 4. 내부 선택 계층형 이벤트 (Requirement 8: 건물 > 층 > 노드)
    document.getElementById('startBuilding')?.addEventListener('change', e => {
        fillFloorSelect(e.target.value, 'startFloorSel');
        resetIndoorSelection('start');
    });
    document.getElementById('startFloorSel')?.addEventListener('change', e => {
        fillNodeSelect(document.getElementById('startBuilding').value, e.target.value, 'startIndoorSel');
    });
    document.getElementById('startIndoorSel')?.addEventListener('change', e => {
        const val = e.target.value;
        state.start.id = val ? val.replace('in_', '') : null;
        updateSelectionVisuals();
    });

    document.getElementById('endBuilding')?.addEventListener('change', e => {
        fillFloorSelect(e.target.value, 'endFloorSel');
        resetIndoorSelection('end');
    });
    document.getElementById('endFloorSel')?.addEventListener('change', e => {
        fillNodeSelect(document.getElementById('endBuilding').value, e.target.value, 'endIndoorSel');
    });
    document.getElementById('endIndoorSel')?.addEventListener('change', e => {
        const val = e.target.value;
        state.end.id = val ? val.replace('in_', '') : null;
        updateSelectionVisuals();
    });

    // 5. 경로 실행 및 초기화
    document.getElementById('runRoute')?.addEventListener('click', runIntegratedRoute);
    document.getElementById('resetBtn')?.addEventListener('click', resetAll);

    // 6. 지도 클릭 (Requirement 6: 외부 노드 선택)
    state.map.on('click', (e) => {
        if (state.start.type === 'outdoor' && !state.start.id) {
            const nodeId = findNearestNode(e.latlng.lat, e.latlng.lng);
            if (nodeId) selectNode(nodeId, 'start');
        } else if (state.end.type === 'outdoor' && !state.end.id) {
            const nodeId = findNearestNode(e.latlng.lat, e.latlng.lng);
            if (nodeId) selectNode(nodeId, 'end');
        }
    });
}

function handleTypeToggle(target, type, container) {
    // UI 업데이트 (Active class)
    container.querySelectorAll('.toggle').forEach(t => t.classList.remove('active'));
    container.querySelector(`[data-type="${type}"]`).classList.add('active');

    // State 업데이트
    state[target].type = type;
    state[target].id = null;

    // Indoor UI 표시/숨김
    const indoorBox = document.getElementById(`${target}IndoorBox`);
    if (indoorBox) indoorBox.classList.toggle('hidden', type !== 'indoor');

    // 기존 선택 초기화 및 마커 제거
    resetIndoorSelection(target);
    updateSelectionVisuals();
}

function resetIndoorSelection(target) {
    state[target].id = null;
    const buildingSel = document.getElementById(`${target}Building`);
    const floorSel = document.getElementById(`${target}FloorSel`);
    const nodeSel = document.getElementById(`${target}IndoorSel`);
    if (buildingSel) buildingSel.value = '';
    if (floorSel) floorSel.value = '';
    if (nodeSel) nodeSel.value = '';
}

/* =========================================================
   SELECTION & VISUALIZATION
   ========================================================= */

function selectNode(nodeId, target) {
    state[target].id = nodeId;
    state[target].type = 'outdoor'; // Clicked on map implies outdoor
    
    // UI Sync (Search boxes)
    const searchInput = document.getElementById(`${target}Search`);
    const node = state.graph.nodeMap.get(Number(nodeId)) || state.graph.nodeMap.get(String(nodeId));
    if (searchInput && node) {
        searchInput.value = node.name || `Node ${nodeId}`;
    }

    updateSelectionVisuals();
}

function updateSelectionVisuals() {
    clearMarkers();
    
    // 1. Start Marker
    if (state.start.id) {
        const node = state.graph.nodeMap.get(Number(state.start.id)) || state.graph.nodeMap.get(String(state.start.id));
        if (node) {
            const pos = node.type === 'indoor' ? [node.y, node.x] : [node.lat, node.lng];
            addMarker(pos, '#10b981', '출발지');
        }
    }

    // 2. End Marker
    if (state.end.id) {
        const node = state.graph.nodeMap.get(Number(state.end.id)) || state.graph.nodeMap.get(String(state.end.id));
        if (node) {
            const pos = node.type === 'indoor' ? [node.y, node.x] : [node.lat, node.lng];
            addMarker(pos, '#f59e0b', '도착지');
        }
    }
}

function addMarker(pos, color, label) {
    const m = L.circleMarker(pos, {
        radius: 10,
        color: '#ffffff',
        fillColor: color,
        fillOpacity: 1,
        weight: 3
    }).addTo(state.map);
    
    m.bindTooltip(label, { permanent: true, direction: 'top' });
    state.markers.push(m);
}

function clearMarkers() {
    state.markers.forEach(m => state.map.removeLayer(m));
    state.markers = [];
}

function findNearestNode(lat, lng) {
    let minDistance = Infinity;
    let nearestId = null;

    state.graph.nodeMap.forEach((node, id) => {
        if (node.type !== 'outdoor') return;
        const dist = Math.sqrt(Math.pow(node.lat - lat, 2) + Math.pow(node.lng - lng, 2));
        if (dist < minDistance) {
            minDistance = dist;
            nearestId = id;
        }
    });

    return minDistance < 0.001 ? nearestId : null;
}

/* =========================================================
   ROUTING & THEME (Remaining Logic)
   ========================================================= */

async function runIntegratedRoute() {
    if (!state.start.id || !state.end.id) {
        alert('출발지와 도착지를 모두 설정해주세요.');
        return;
    }
    
    setStatus('🧭 경로 계산 중...');
    clearAllVisuals();

    const worker = new Worker('/js/campus/pathWorker.js', { type: 'module' });
    worker.postMessage({
        graphObj: state.graph,
        start: state.start.id,
        end: state.end.id,
        mode: 'optimal'
    });

    worker.onmessage = (e) => {
        const { path, error } = e.data;
        if (error || !path) {
            alert('경로를 찾을 수 없습니다.');
            setStatus('❌ 탐색 실패');
        } else {
            renderResult(path);
            setStatus('✅ 경로 탐색 완료');
        }
        worker.terminate();
    };
}

function renderResult(path) {
    drawPath(state.map, path, state.graph);
    updateRouteDetailCard(path);
    // Automatic View Switch logic can be added here
}

function updateRouteDetailCard(path) {
    const detailCard = document.getElementById('routeDetailCard');
    const content = document.getElementById('routeInfoContent');
    if (!detailCard || !content) return;

    detailCard.classList.remove('hidden');
    content.innerHTML = `
        <div class="detail-item"><span class="label">경로 노드</span><span class="value">${path.length}개 지점</span></div>
        <div class="detail-item"><span class="label">상태</span><span class="value text-success">최적 경로</span></div>
    `;
}

function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('campus-theme', theme);
}

function resetAll() {
    state.start = { type: null, id: null };
    state.end = { type: null, id: null };
    
    // Reset UI
    document.querySelectorAll('input').forEach(i => i.value = '');
    document.querySelectorAll('select').forEach(s => s.value = '');
    document.querySelectorAll('.toggle').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('[id$="IndoorBox"]').forEach(b => b.classList.add('hidden'));
    
    clearMarkers();
    clearAllVisuals();
    setStatus('🔄 초기화 완료');
}

function clearAllVisuals() {
    clearPath(state.map, state.lines);
    state.lines = [];
    const detailCard = document.getElementById('routeDetailCard');
    if (detailCard) detailCard.classList.add('hidden');
}

function setStatus(msg) {
    const el = document.getElementById('statusText');
    if (el) el.textContent = msg;
}

init();

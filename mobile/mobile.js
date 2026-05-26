import { supabase } from '../js/admin/common/adminApi.js';
import { initMap } from '../js/campus/map_core.js';
import { loadGraph } from '../js/campus/graph_manager.js';
import { drawPath, clearPath } from '../js/campus/renderer.js';
// 기존 pathfinder 로직을 가져오기 위해 별도 모듈화 되어있다고 가정하거나 내부 구현
import { findPath } from '../js/campus/pathfinder.js'; 

/**
 * [모바일 전용 상태 관리]
 */
const map = initMap('map');
const state = {
    graph: null,
    nodeMap: new Map(),      // 모든 노드의 상세 정보 (id -> data)
    outdoorNodes: [],        // 실외 노드 리스트
    indoorNodes: [],         // 실내 노드 리스트
    buildings: [],           // 건물 리스트
    start: { type: null, id: null, name: '' },
    end: { type: null, id: null, name: '' },
    isMapSelectMode: false,  // 지도에서 직접 선택 중인지 여부
    selectionTarget: 'start' // 'start' 또는 'end'
};

// DOM 요소
const searchInput = document.getElementById('node-search-input');
const suggestionList = document.getElementById('suggestion-list');
const searchSection = document.getElementById('search-section');
const selectionCard = document.getElementById('selection-card');
const startDisplay = document.getElementById('start-display');
const endDisplay = document.getElementById('end-display');
const statusBadge = document.getElementById('status-badge');
const currentModeText = document.getElementById('current-mode-text');

/**
 * [1. 초기화]
 */
async function init() {
    try {
        statusBadge.innerText = '데이터 로딩 중...';
        
        // 기존 map_outdoor.js의 init 로직을 모바일용으로 최적화하여 병렬 로드
        const [graph, indoorRes, buildingRes, outdoorRes] = await Promise.all([
            loadGraph(),
            supabase.from('indoor_nodes').select('id, name, building_id, floor_id, type'),
            supabase.from('buildings').select('*'),
            supabase.from('outdoor_nodes').select('*')
        ]);

        state.graph = graph;
        state.indoorNodes = indoorRes.data || [];
        state.buildings = buildingRes.data || [];
        state.outdoorNodes = outdoorRes.data || [];

        // 검색 엔진을 위한 통합 노드 맵 구축
        buildUnifiedNodeMap();
        
        statusBadge.innerText = '준비 완료';
        bindEvents();
        console.log('Mobile System Initialized');
    } catch (e) {
        console.error('Init Error:', e);
        statusBadge.innerText = '초기화 실패';
    }
}

/**
 * [2. 검색 엔진 구축]
 * 모든 노드를 검색하기 쉬운 형태(건물명 + 층 + 노드명)로 인덱싱합니다.
 */
function buildUnifiedNodeMap() {
    // 실외 노드 인덱싱
    state.outdoorNodes.forEach(node => {
        state.nodeMap.set(`out_${node.id}`, {
            ...node,
            type: 'outdoor',
            displayName: node.name || '실외 지점',
            subDisplay: node.description || '캠퍼스 실외'
        });
    });

    // 실내 노드 인덱싱 (건물명/층 정보 결합)
    state.indoorNodes.forEach(node => {
        const building = state.buildings.find(b => b.id === node.building_id);
        const floor = state.indoorNodes.find(f => f.id === node.floor_id); // 실제로는 floors 테이블 필요
        
        const bName = building ? building.name : '';
        const fNum = node.floor_id ? `${node.floor_id}F` : ''; // 간단하게 처리
        const nName = node.name || '';

        state.nodeMap.set(`in_${node.id}`, {
            ...node,
            type: 'indoor',
            displayName: nName,
            // 사용자가 요구한 [건물명] [n층] [노드명] 조합
            subDisplay: `${bName} ${fNum} ${nName}`.trim()
        });
    });
}

/**
 * [3. 이벤트 바인딩]
 */
function bindEvents() {
    // 검색어 입력 시 자동완성
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length > 0) {
            performSearch(query);
        } else {
            suggestionList.classList.add('hidden');
        }
    });

    // 지도에서 직접 선택 모드 활성화
    document.getElementById('btn-map-select').addEventListener('click', () => {
        state.isMapSelectMode = true;
        state.selectionTarget = state.start.id ? 'end' : 'start';
        statusBadge.innerText = '지도에서 지점을 터치하세요';
        alert('지도의 마커를 터치하여 위치를 선택하세요.');
    });

    // 지도 클릭 이벤트 (지도에서 직접 선택 기능)
    map.on('click', (e) => {
        if (!state.isMapSelectMode) return;

        // 클릭한 좌표에서 가장 가까운 노드 찾기 (실제 구현 시 거리 계산 로직 필요)
        const clickedNode = findNearestNode(e.latlng);
        if (clickedNode) {
            selectNode(clickedNode.id, clickedNode.displayName);
        }
    });

    // 경로 찾기 실행
    document.getElementById('btn-run-route').addEventListener('click', runRoute);

    // 초기화 버튼
    document.getElementById('btn-reset-selection').addEventListener('click', resetSelection);
}

/**
 * [4. 핵심 기능: 검색 및 선택]
 */
function performSearch(query) {
    const results = [];
    const lowerQuery = query.toLowerCase();

    for (const [id, data] of state.nodeMap.entries()) {
        if (data.displayName.toLowerCase().includes(lowerQuery) || 
            data.subDisplay.toLowerCase().includes(lowerQuery)) {
            results.push({ id, ...data });
        }
        if (results.length > 10) break; // 성능을 위해 최대 10개만
    }

    renderSuggestions(results);
}

function renderSuggestions(list) {
    if (list.length === 0) {
        suggestionList.innerHTML = '<li class="suggestion-item">검색 결과가 없습니다.</li>';
    } else {
        suggestionList.innerHTML = list.map(item => `
            <li class="suggestion-item" onclick="window.selectNode('${item.id}', '${item.displayName.replace(/'/g, "\\'")}')">
                <div class="suggestion-info">
                    <span class="suggestion-main">${item.displayName}</span>
                    <span class="suggestion-sub">${item.subDisplay}</span>
                </div>
            </li>
        `).join('');
    }
    suggestionList.classList.remove('hidden');
}

// 전역 함수로 노출 (HTML 인라인 onclick 대응)
window.selectNode = function(id, name) {
    const target = state.selectionTarget;
    state[target] = { id, name, type: id.startsWith('in_') ? 'indoor' : 'outdoor' };
    
    // UI 업데이트
    if (target === 'start') {
        startDisplay.innerText = name;
        state.selectionTarget = 'end';
    } else {
        endDisplay.innerText = name;
        state.selectionTarget = null;
    }

    // 검색창 및 리스트 닫기
    searchInput.value = name;
    suggestionList.classList.add('hidden');
    
    // UI 모드 전환 (검색창 -> 결과 카드)
    if (state.start.id && state.end.id) {
        showSelectionCard();
    }
};

function showSelectionCard() {
    searchSection.classList.add('hidden');
    selectionCard.classList.remove('hidden');
}

function resetSelection() {
    state.start = { type: null, id: null, name: '' };
    state.end = { type: null, id: null, name: '' };
    state.selectionTarget = 'start';
    
    startDisplay.innerText = '미선택';
    endDisplay.innerText = '미선택';
    
    selectionCard.classList.add('hidden');
    searchSection.classList.remove('hidden');
    searchInput.value = '';
    
    clearPath(map);
}

/**
 * [5. 경로 탐색 실행]
 */
async function runRoute() {
    if (!state.start.id || !state.end.id) return;

    statusBadge.innerText = '경로 계산 중...';
    
    // 기존 pathfinder.js 활용
    // 실제 구현 시 state.graph와 비용 모드(radio button)를 전달
    const mode = document.querySelector('input[name="cost-mode"]:checked').value;
    
    try {
        // pathfinder.js의 findPath 호출 (기존 로직 재사용)
        const path = await findPath(state.graph, state.start.id, state.end.id, mode);
        
        if (path && path.length > 0) {
            // 결과 그리기 (기존 renderer.js 활용)
            drawPath(map, path, state.graph);
            statusBadge.innerText = '경로 탐색 완료';
        } else {
            statusBadge.innerText = '경로를 찾을 수 없음';
        }
    } catch (e) {
        console.error(e);
        statusBadge.innerText = '경로 계산 오류';
    }
}

// 헬퍼 함수: 가장 가까운 노드 찾기
function findNearestNode(latlng) {
    let nearest = null;
    let minDist = Infinity;

    for (const [id, node] of state.nodeMap.entries()) {
        // 실내/외 좌표 체계가 다르므로 주의 필요 (실외는 lat/lng, 실내는 x/y)
        const nodeLat = node.lat || (node.x / 100); // 임시 변환 로직
        const nodeLng = node.lng || (node.y / 100);
        
        const dist = map.distance(latlng, [nodeLat, nodeLng]);
        if (dist < minDist) {
            minDist = dist;
            nearest = node;
        }
    }
    return nearest;
}

// 실행
init();

import { supabase } from '/js/admin/common/adminApi.js';
import { initAdminHeader } from '/js/admin/common/adminHeader.js';
import { protectPage } from '/js/admin/common/adminRouterGuard.js';

// 페이지 보호 및 헤더 초기화
await protectPage();
initAdminHeader('logs');

// DOM 요소 참조
const gridContainer = document.getElementById('log-grid-container');
const filterHwId = document.getElementById('filter-hw-id');
const filterLevel = document.getElementById('filter-level');
const filterCategory = document.getElementById('filter-category');

// 필터 및 카드 관리 상태
let currentFilters = {
  hwId: 'ALL',
  level: 'ALL',
  category: 'ALL'
};

// 디바이스별 터미널 요소를 관리하는 Map (hwId -> terminalElement)
const deviceCards = new Map();

/**
 * DB에서 중복 없는 하드웨어 ID 목록을 가져와 드롭다운을 채움
 */
async function loadHardwareIds() {
  try {
    const { data, error } = await supabase
      .from('device_logs')
      .select('hardware_id');

    if (error) throw error;

    const uniqueIds = [...new Set(data.map(item => item.hardware_id))].sort();

    // 드롭다운 초기화
    filterHwId.innerHTML = '<option value="ALL">모든 디바이스</option>';
    uniqueIds.forEach(id => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = id;
      filterHwId.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading HW IDs:', error);
  }
}

/**
 * 필터 조건에 따라 새로운 로그를 보여줄지 결정
 */
function shouldShowLog(log) {
  if (currentFilters.hwId !== 'ALL' && log.hardware_id !== currentFilters.hwId) return false;
  if (currentFilters.level !== 'ALL' && log.log_level !== currentFilters.level) return false;
  if (currentFilters.category !== 'ALL' && log.category !== currentFilters.category) return false;
  return true;
}

/**
 * 하드웨어 ID별 전용 로그 카드를 생성하거나 기존 카드를 반환
 */
function getOrCreateCard(hwId) {
  if (deviceCards.has(hwId)) {
    return deviceCards.get(hwId);
  }

  const card = document.createElement('div');
  card.className = 'log-card';
  card.id = `card-${hwId}`;
  
  card.innerHTML = `
    <h3>
      <span><i class="fas fa-microchip"></i> ${hwId}</span>
      <button class="btn-clear" onclick="clearCard('${hwId}')">Clear</button>
    </h3>
    <div class="terminal-container" id="terminal-${hwId}">
      <div class="log-line" style="color: var(--text-secondary);">디바이스 연결 대기 중...</div>
    </div>
  `;

  gridContainer.appendChild(card);
  const terminal = card.querySelector('.terminal-container');
  deviceCards.set(hwId, terminal);
  return terminal;
}

// 전역 함수로 등록 (HTML의 onclick에서 호출 가능하도록)
window.clearCard = (hwId) => {
  const terminal = deviceCards.get(hwId);
  if (terminal) {
    terminal.innerHTML = '<div class="log-line" style="color: var(--text-secondary);">Terminal cleared.</div>';
  }
};

/**
 * 로그 한 줄을 터미널에 추가
 */
function appendLogToTerminal(log) {
  const terminal = getOrCreateCard(log.hardware_id);
  
  const line = document.createElement('div');
  line.className = `log-line ${log.log_level}`;
  
  const date = new Date(log.created_at);
  const timeStr = date.toLocaleTimeString('ko-KR', { 
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' 
  });

  line.innerHTML = `
    <span class="log-timestamp">[${timeStr}]</span>
    <span class="log-cat">${log.category}</span>
    <span class="log-msg">${log.message}</span>
  `;

  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight; // 자동 스크롤
}

/**
 * DB에서 초기 로그 로드 (필터 적용)
 */
async function loadInitialLogs() {
  let query = supabase
    .from('device_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (currentFilters.hwId !== 'ALL') query = query.eq('hardware_id', currentFilters.hwId);
  if (currentFilters.level !== 'ALL') query = query.eq('log_level', currentFilters.level);
  if (currentFilters.category !== 'ALL') query = query.eq('category', currentFilters.category);

  const { data, error } = await query;
  if (error) {
    console.error('Error loading logs:', error);
    return;
  }

  // 최신 로그가 아래에 오도록 역순 정렬 후 출력
  data.reverse().forEach(log => appendLogToTerminal(log));
}

/**
 * 화면 전체 새로고침 (필터 변경 시)
 */
async function refreshDisplay() {
  gridContainer.innerHTML = '';
  deviceCards.clear();
  await loadInitialLogs();
}

/**
 * Supabase Realtime 구독
 */
function subscribeToLogs() {
  supabase
    .channel('device-log-stream')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'device_logs' },
      (payload) => {
        const newLog = payload.new;
        if (shouldShowLog(newLog)) {
          appendLogToTerminal(newLog);
        }
      }
    )
    .subscribe();
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
  const applyFilters = () => {
    currentFilters.hwId = filterHwId.value;
    currentFilters.level = filterLevel.value;
    currentFilters.category = filterCategory.value;
    refreshDisplay();
  };

  filterHwId.onchange = applyFilters;
  filterLevel.onchange = applyFilters;
  filterCategory.onchange = applyFilters;
}

/**
 * 초기화 실행
 */
async function init() {
  initAdminHeader('logs');
  await loadHardwareIds(); // 1. HW 목록 로드
  setupEventListeners();    // 2. 이벤트 바인딩
  subscribeToLogs();       // 3. 실시간 구독 시작
  await loadInitialLogs();  // 4. 초기 로그 로드
}

init();

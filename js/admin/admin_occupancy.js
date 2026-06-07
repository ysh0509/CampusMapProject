/**
 * @file admin_occupancy.js
 * @description 전역 혼잡도 분석 엔진 (차트는 선택된 노드/필터 기반, 테이블은 필터 기반)
 */

import { supabase } from '../../js/admin/common/adminApi.js';
import { protectPage } from '../../js/admin/common/adminRouterGuard.js';
import { initAdminHeader } from '../../js/admin/common/adminHeader.js';

// --- 초기화 ---
await protectPage();
initAdminHeader('occupancy');

// --- DOM 요소 ---
const eventsTableBody = document.querySelector('#events-table tbody');
const filterEventsNode = document.querySelector('#filter-events-node');
const filterAnalysisDimension = document.querySelector('#filter-analysis-dimension');
const filterChartType = document.querySelector('#filter-chart-type');
const filterEventsScope = document.querySelector('#filter-events-scope');
const filterEventsLevel = document.querySelector('#filter-events-level');

// 기간 필터 관련 요소
const filterDateRange = document.querySelector('#filter-date-range');
const customDateInputs = document.querySelector('#custom-date-inputs');
const dateStart = document.querySelector('#date-start');
const dateEnd = document.querySelector('#date-end');

const btnRefreshAnalysis = document.querySelector('#btn-refresh-analysis');
const btnPrevEvents = document.querySelector('#btn-prev-events');
const btnNextEvents = document.querySelector('#btn-next-events');
const eventsPageInfo = document.querySelector('#events-page-info');
const chartTitle = document.querySelector('#chart-title');

// --- 상태 변수 ---
const PAGE_SIZE = 50;
let eventsPage = 1;
let totalEvents = 0;

let tableData = [];      // [테이블용] 현재 필터링된 로그 데이터 (최신순)
let globalChartData = []; // [차트용] 선택된 필터(노드 포함) 조건에 맞는 시계열 데이터 (과거->현재 순)

let occupancyChart = null;

// --- 헬퍼 함수 ---
const levelBadge = (level) => {
  if (!level) return '-';
  const cls = level.toLowerCase();
  return `<span class="badge ${cls}">${level}</span>`;
};

const formatRatio = (v) => (v !== null && v !== undefined) ? (v * 100).toFixed(1) + '%' : '-';

/**
 * 차트용 데이터 정렬 (과거 -> 현재)
 */
function sortDataChronologically(data) {
  return [...data].sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at));
}

// =========================
// 차트 로직 (Chart.js)
// =========================
function initChart() {
  const ctx = document.getElementById('occupancy-chart');
  if (!ctx) return;

  occupancyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: '평균 혼잡도 (%)',
          data: [],
          yAxisID: 'yOccupancy',
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.4,
          borderWidth: 3
        },
        {
          type: 'bar',
          label: '평균 인원 수',
          data: [],
          yAxisID: 'yPeople',
          backgroundColor: 'rgba(148, 163, 184, 0.3)',
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        yOccupancy: {
          type: 'linear',
          position: 'left',
          beginAtZero: true,
          max: 100,
          title: { display: true, text: '혼잡도 (%)' }
        },
        yPeople: {
          type: 'linear',
          position: 'right',
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          title: { display: true, text: '인원 수' }
        }
      }
    }
  });
}

/**
 * [핵심] 차트 데이터 가공 엔진
 * dimension: 'raw' | 'hour' | 'weekday'
 */
function processDataForAnalysis(data, dimension) {
  if (dimension === 'raw') return data;

  const aggregated = {};

  data.forEach(row => {
    const date = new Date(row.captured_at);
    let key;

    if (dimension === 'hour') {
      key = `${date.getHours()}:00`;
    } else if (dimension === 'weekday') {
      const days = ['일', '월', '화', '수', '목', '금', '토'];
      key = days[date.getDay()];
    }

    if (!aggregated[key]) {
      aggregated[key] = { count: 0, sumRatio: 0, sumPeople: 0, timestamp: date };
    }
    aggregated[key].count++;
    aggregated[key].sumRatio += (row.occupancy_ratio || 0);
    aggregated[key].sumPeople += (row.people_count || 0);
  });

  const sortedKeys = Object.keys(aggregated).sort((a, b) => {
    if (dimension === 'hour') return parseInt(a) - parseInt(b);
    if (dimension === 'weekday') {
      const dayOrder = ['월', '화', '수', '목', '금', '토', '일'];
      return dayOrder.indexOf(a) - dayOrder.indexOf(b);
    }
    return 0;
  });

  return sortedKeys.map(k => ({
    displayTime: k,
    occupancy_ratio: aggregated[k].sumRatio / aggregated[k].count,
    people_count: Math.round(aggregated[k].sumPeople / aggregated[k].count)
  }));
}

function updateChart(data, dimension, type) {
  if (!occupancyChart) return;

  const processed = processDataForAnalysis(data, dimension);

  occupancyChart.config.type = type;
  occupancyChart.data.labels = processed.map(row => 
    dimension === 'raw' ? (row.captured_at ? new Date(row.captured_at).toLocaleTimeString() : '-') : row.displayTime
  );
  occupancyChart.data.datasets[0].data = processed.map(row => (row.occupancy_ratio * 100).toFixed(1));
  occupancyChart.data.datasets[1].data = processed.map(row => row.people_count);
  
  occupancyChart.update();
}

// =========================
// 데이터 로딩 및 실시간 갱신
// =========================

async function loadNodeIdOptions() {
  const { data, error } = await supabase.from('occupancy_events').select('node_id');
  if (error || !data) return;
  const uniqueNodes = [...new Set(data.map(item => item.node_id))].sort((a, b) => a - b);
  uniqueNodes.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `Node ${id}`;
    filterEventsNode.appendChild(opt);
  });
}

/**
 * [테이블용] 필터링된 최신 로그 로드
 */
async function loadTableEvents() {
  const from = (eventsPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase.from('occupancy_events')
    .select('*', { count: 'exact' })
    .order('captured_at', { ascending: false })
    .range(from, to);

  // 1. 기본 필터 적용
  if (filterEventsNode.value !== 'all') query = query.eq('node_id', filterEventsNode.value);
  if (filterEventsScope.value) query = query.eq('node_scope', filterEventsScope.value);
  if (filterEventsLevel.value) query = query.eq('congestion_level', filterEventsLevel.value);

  // 2. 기간 필터 적용
  const range = filterDateRange.value;
  const now = new Date();
  if (range === '7') {
    query = query.gte('captured_at', new Date(now.setDate(now.getDate() - 7)).toISOString());
  } else if (range === '30') {
    query = query.gte('captured_at', new Date(now.setDate(now.getDate() - 30)).toISOString());
  } else if (range === 'custom') {
    if (dateStart.value) query = query.gte('captured_at', new Date(dateStart.value).toISOString());
    if (dateEnd.value) query = query.lte('captured_at', new Date(dateEnd.value).toISOString() + 'T23:59:59');
  }

  const { data, error, count } = await query;
  if (error) {
    console.error('[Error] loadTableEvents:', error.message);
    eventsTableBody.innerHTML = `<tr><td colspan="8" style="color:red;">로드 실패</td></tr>`;
    return;
  }

  totalEvents = count || 0;
  const totalPages = Math.max(1, Math.ceil(totalEvents / PAGE_SIZE));
  eventsPageInfo.textContent = `${eventsPage} / ${totalPages}`;
  
  tableData = data || [];
  updateTableUI(tableData);
}

/**
 * [테이블 UI 업데이트]
 */
function updateTableUI(data) {
  if (!data || data.length === 0) {
    eventsTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;">데이터 없음</td></tr>`;
    return;
  }

  eventsTableBody.innerHTML = data.map(row => `
    <tr>
      <td>${row.node_id}</td>
      <td>${row.node_scope || '-'}</td>
      <td>${levelBadge(row.congestion_level)}</td>
      <td>${formatRatio(row.occupancy_ratio)}</td>
      <td>${row.people_count ?? '-'}</td>
      <td>${row.camera_angle ?? '-'}</td>
      <td>${row.roi_id ?? '-'}</td>
      <td>${row.captured_at ? new Date(row.captured_at).toLocaleString() : '-'}</td>
    </tr>
  `).join('');
}

/**
 * [차트용] 필터가 적용된 시계열 데이터 로드
 * 수정 사항: 노드(node_id) 필터가 차트 데이터에도 적용되도록 변경됨
 */
async function loadGlobalChartData() {
  console.log('[Chart] 차트 데이터 필터링 및 동기화 중...');
  try {
    let query = supabase
      .from('occupancy_events')
      .select('*')
      .order('captured_at', { ascending: true });

    // 1. [중요] 노드 필터 적용 (카메라별 차트 제어의 핵심)
    if (filterEventsNode.value !== 'all') {
      query = query.eq('node_id', filterEventsNode.value);
    }

    // 2. 기간 필터 적용 (차트 시계열을 위해)
    const range = filterDateRange.value;
    const now = new Date();
    if (range === '7') {
      query = query.gte('captured_at', new Date(now.setDate(now.getDate() - 7)).toISOString());
    } else if (range === '30') {
      query = query.gte('captured_at', new Date(now.setDate(now.getDate() - 30)).toISOString());
    } else if (range === 'custom') {
      if (dateStart.value) query = query.gte('captured_at', new Date(dateStart.value).toISOString());
      if (dateEnd.value) query = query.lte('captured_at', new Date(dateEnd.value).toISOString() + 'T23:59:59');
    }

    const { data, error } = await query;
    if (error) throw error;

    globalChartData = data || [];
    updateChart(globalChartData, filterAnalysisDimension.value, filterChartType.value);
    console.log(`[Chart] ${globalChartData.length}건 데이터 동기화 완료 (Node: ${filterEventsNode.value})`);
  } catch (err) {
    console.error('[Chart Error]', err.message);
  }
}

// =========================
// EVENT LISTENERS
// =========================

// 분석 실행 버튼
btnRefreshAnalysis.onclick = async () => {
  eventsPage = 1;
  await Promise.all([loadTableEvents(), loadGlobalChartData()]);
};

// 필터 변경 시
filterEventsNode.onchange = () => { 
  eventsPage = 1; 
  // 노드가 바뀌면 테이블과 차트 모두 해당 노드 데이터로 새로고침
  Promise.all([loadTableEvents(), loadGlobalChartData()]); 
};

filterEventsScope.onchange = () => { eventsPage = 1; loadTableEvents(); };
filterEventsLevel.onchange = () => { eventsPage = 1; loadTableEvents(); };

// 기간 필터 변경 시
filterDateRange.onchange = () => {
  if (filterDateRange.value === 'custom') {
    customDateInputs.style.display = 'flex';
  } else {
    customDateInputs.style.display = 'none';
  }
  eventsPage = 1;
  // 기간이 바뀌면 차트와 테이블 모두 새로 불러와야 함
  Promise.all([loadTableEvents(), loadGlobalChartData()]);
};

// 차트 타입/차원 변경
filterChartType.onchange = () => updateChart(globalChartData, filterAnalysisDimension.value, filterChartType.value);
filterAnalysisDimension.onchange = () => updateChart(globalChartData, filterAnalysisDimension.value, filterChartType.value);

btnPrevEvents.onclick = () => { if (eventsPage > 1) { eventsPage--; loadTableEvents(); } };
btnNextEvents.onclick = () => {
  if (eventsPage < Math.ceil(totalEvents / PAGE_SIZE)) { eventsPage++; loadTableEvents(); }
};

// =========================
// INIT
// =========================
(async function init() {
  console.log('[Occupancy Analytics] 엔진 가동 중...');
  initChart();
  await loadNodeIdOptions();
  
  // 초기 로드
  await Promise.all([
    loadTableEvents(),
    loadGlobalChartData()
  ]);

  // 30초마다 데이터 동기화 (Silent Refresh)
  setInterval(async () => {
    console.log('[Auto-Refresh] 데이터 동기화 중...');
    try {
      if (eventsPage === 1) {
        await loadTableEvents();
      }
      // 차트의 경우 현재 적용된 필터(노드 등)를 유지하며 동기화
      await loadGlobalChartData();
    } catch (err) {
      console.error('[Auto-Refresh Error]', err.message);
    }
  }, 30000);
  
  console.log('[Occupancy Analytics] 가동 완료');
})();

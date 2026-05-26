/**
 * @file admin_occupancy.js
 * @description 시계열 정렬 보정 및 Silent Auto-Refresh 기능이 적용된 분석 엔진
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
const btnRefreshAnalysis = document.querySelector('#btn-refresh-analysis');
const btnPrevEvents = document.querySelector('#btn-prev-events');
const btnNextEvents = document.querySelector('#btn-next-events');
const eventsPageInfo = document.querySelector('#events-page-info');
const chartTitle = document.querySelector('#chart-title');

// --- 상태 변수 ---
const PAGE_SIZE = 50;
let eventsPage = 1;
let totalEvents = 0;
let rawEventData = []; // 차트 엔진이 사용하는 정렬된 데이터 (과거 -> 현재)
let occupancyChart = null;

// --- 헬퍼 함수 ---
const levelBadge = (level) => {
  if (!level) return '-';
  const cls = level.toLowerCase();
  return `<span class="badge ${cls}">${level}</span>`;
};

const formatRatio = (v) => (v !== null && v !== undefined) ? (v * 100).toFixed(1) + '%' : '-';

/**
 * [개선] 데이터 정렬 함수
 * 차트용 데이터는 반드시 과거 -> 현재(Ascending) 순서여야 시계열 흐름이 정상적으로 보임
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
          label: '혼잡도 (%)',
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
          label: '인원 수',
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
 * [개선] 테이블 UI 전용 업데이트 함수
 * 실시간 갱신 시 화면 깜빡임을 방지하기 위해 HTML을 통째로 갈아끼우는 대신 데이터만 매핑
 */
function updateTableUI(data) {
  if (!data || data.length === 0) {
    eventsTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;">데이터 없음</td></tr>`;
    return;
  }

  // 테이블은 관리 효율을 위해 최신순(Descending)으로 보여줌
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

async function loadEvents() {
  eventsTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;">데이터 로딩 중...</td></tr>`;
  const from = (eventsPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase.from('occupancy_events').select('*', { count: 'exact' }).order('captured_at', { ascending: false }).range(from, to);

  if (filterEventsNode.value !== 'all') query = query.eq('node_id', filterEventsNode.value);
  if (filterEventsScope.value) query = query.eq('node_scope', filterEventsScope.value);
  if (filterEventsLevel.value) query = query.eq('congestion_level', filterEventsLevel.value);

  const { data, error, count } = await query;
  if (error) {
    console.error('[Error] loadEvents:', error.message);
    eventsTableBody.innerHTML = `<tr><td colspan="8" style="color:red;">로드 실패</td></tr>`;
    return;
  }

  totalEvents = count || 0;
  const totalPages = Math.max(1, Math.ceil(totalEvents / PAGE_SIZE));
  eventsPageInfo.textContent = `${eventsPage} / ${totalPages}`;
  
  // [중요] 차트 엔진용 원본 데이터는 정렬 보정(과거->현재)하여 저장
  rawEventData = sortDataChronologically(data || []);

  updateTableUI(data);
  updateChart(rawEventData, filterAnalysisDimension.value, filterChartType.value);
}

/**
 * [핵심] Silent Auto-Refresh
 * 사용자가 조작 중인 화면을 방해하지 않고 백그라운드에서 데이터만 동기화
 */
async function silentRefresh() {
  console.log('[Auto-Refresh] 데이터 동기화 중...');
  try {
    let query = supabase.from('occupancy_events').select('*', { count: 'exact' }).order('captured_at', { ascending: false }).range(0, PAGE_SIZE - 1);

    if (filterEventsNode.value !== 'all') query = query.eq('node_id', filterEventsNode.value);
    if (filterEventsScope.value) query = query.eq('node_scope', filterEventsScope.value);
    if (filterEventsLevel.value) query = query.eq('congestion_level', filterEventsLevel.value);

    const { data, error, count } = await query;
    if (error) throw error;

    // 데이터 교체 (사용자는 눈치채지 못하게 차트와 테이블만 조용히 업데이트)
    rawEventData = sortDataChronologically(data || []);
    totalEvents = count || 0;

    // 테이블 업데이트 (현재 페이지가 1페이지일 때만 자동 갱신하여 사용자 혼란 방지)
    if (eventsPage === 1) {
      updateTableUI(data);
    }

    // 차트 업데이트
    updateChart(rawEventData, filterAnalysisDimension.value, filterChartType.value);
    
    console.log('[Auto-Refresh] 동기화 성공');
  } catch (err) {
    console.error('[Auto-Refresh Error]', err.message);
  }
}

// =========================
// EVENT LISTENERS
// =========================
btnRefreshAnalysis.onclick = () => {
  eventsPage = 1;
  loadEvents();
};

filterEventsNode.onchange = () => { eventsPage = 1; loadEvents(); };
filterEventsScope.onchange = () => { eventsPage = 1; loadEvents(); };
filterEventsLevel.onchange = () => { eventsPage = 1; loadEvents(); };

// 차트 모드/타입 변경 시 데이터 재로딩 없이 즉시 차트만 업데이트
filterChartType.onchange = () => updateChart(rawEventData, filterAnalysisDimension.value, filterChartType.value);
filterAnalysisDimension.onchange = () => updateChart(rawEventData, filterAnalysisDimension.value, filterChartType.value);

btnPrevEvents.onclick = () => { if (eventsPage > 1) { eventsPage--; loadEvents(); } };
btnNextEvents.onclick = () => {
  if (eventsPage < Math.ceil(totalEvents / PAGE_SIZE)) { eventsPage++; loadEvents(); }
};

// =========================
// INIT
// =========================
(async function init() {
  console.log('[Occupancy Analytics] 엔진 가동 중...');
  initChart();
  await loadNodeIdOptions();
  await loadEvents();

  // 30초마다 자동 갱신 실행
  setInterval(silentRefresh, 30000);
  
  console.log('[Occupancy Analytics] 가동 완료 (Silent Refresh Active)');
})();

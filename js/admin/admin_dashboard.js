/**
 * @file admin_dashboard.js
 * @description 관리자 대시보드 메인 로직 - 실시간 모니터링, 데이터 분석, 로그 관리
 */

import { protectPage } from '../../js/admin/common/adminRouterGuard.js';
import { initAdminHeader } from '../../js/admin/common/adminHeader.js';
import { supabase } from '../../js/admin/common/adminApi.js';

// --- 초기화 및 보안 ---
await protectPage();
initAdminHeader('dashboard');

// --- 전역 상태 변수 ---
let logsAll = [];
let logsPage = 1;
const LOGS_PAGE_SIZE = 5;
const CHIP_POS_KEY = 'admin_overlay_chip_pos_v1';
const STREAM_URL_KEY = 'admin_live_stream_url';

const chipMap = new Map(); // NodeID -> DOM Element 매핑
let chipPos = JSON.parse(localStorage.getItem(CHIP_POS_KEY) || '{}');

// --- 유틸리티 함수 ---

/**
 * DOM 요소에 텍스트 값을 안전하게 설정
 * @param {string} id 요소 ID
 * @param {any} v 설정할 값
 */
function set(id, v) {
  const el = document.getElementById(id);
  if (el) el.innerText = v !== undefined && v !== null ? v : 0;
}

/**
 * 혼잡도 레벨에 따른 CSS 클래스 반환
 */
function getLevelClass(level) {
  const lv = String(level || 'LOW').toUpperCase();
  if (lv === 'HIGH') return 'chip-high';
  if (lv === 'MID') return 'chip-mid';
  return 'chip-low';
}

/**
 * 데이터 최신성 체크 (15초 경과 시 stale)
 */
function isStale(updatedAt) {
  const t = new Date(updatedAt || Date.now()).getTime();
  return (Date.now() - t) > 15000;
}

/**
 * 지도 이동 (외부/실내)
 */
window.goToMap = (lat, lng) => {
  if (lat === undefined || lng === undefined) return;
  localStorage.setItem('admin_focus', JSON.stringify({ lat, lng }));
  location.href = '/html/admin/outdoor/admin_outdoor_map.html';
};

// --- 핵심 기능 함수 ---

/**
 * 1. 통계 데이터 로드 (내부 노드/엣지 추가 버전)
 */
async function loadStats() {
  try {
    console.log('[Dashboard] 통계 데이터 요청 중...');
    // Promise.all에 indoor_nodes와 indoor_edges 쿼리 추가
    const [n, e, inN, inE, b, f] = await Promise.all([
      supabase.from('outdoor_nodes').select('id', { count: 'exact', head: true }),
      supabase.from('outdoor_edges').select('id', { count: 'exact', head: true }),
      supabase.from('indoor_nodes').select('id', { count: 'exact', head: true }), // 신설
      supabase.from('indoor_edges').select('id', { count: 'exact', head: true }), // 신설
      supabase.from('buildings').select('id', { count: 'exact', head: true }),
      supabase.from('floors').select('id', { count: 'exact', head: true })
    ]);

    // 에러 검사
    if (n.error) throw new Error(`Outdoor Nodes: ${n.error.message}`);
    if (e.error) throw new Error(`Outdoor Edges: ${e.error.message}`);
    if (inN.error) throw new Error(`Indoor Nodes: ${inN.error.message}`); // 에러 체크 추가
    if (inE.error) throw new Error(`Indoor Edges: ${inE.error.message}`); // 에러 체크 추가
    if (b.error) throw new Error(`Buildings: ${b.error.message}`);
    if (f.error) throw new Error(`Floors: ${f.error.message}`);

    // 값 세팅
    set('outdoor-node-count', n.count);
    set('outdoor-edge-count', e.count);
    set('indoor-node-count', inN.count); // 신설 세팅
    set('indoor-edge-count', inE.count); // 신설 세팅
    set('building-count', b.count);
    set('floor-count', f.count);

    console.log('[Dashboard] 통계 로드 완료');
  } catch (err) {
    console.error('[Dashboard Error] loadStats 실패:', err.message);
  }
}


/**
 * 2. 시스템 로그 로드 및 페이징
 */
async function loadLogs() {
  try {
    const { data, error } = await supabase
      .from('admin_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;
    logsAll = data || [];
    logsPage = 1;
    renderLogPage();
  } catch (err) {
    console.error('[Dashboard Error] loadLogs 실패:', err.message);
  }
}

function renderLogPage() {
  const el = document.getElementById('recent-logs');
  const info = document.getElementById('logs-page-info');
  if (!el || !info) return;

  const total = Math.max(1, Math.ceil(logsAll.length / LOGS_PAGE_SIZE));
  logsPage = Math.min(Math.max(1, logsPage), total);

  const start = (logsPage - 1) * LOGS_PAGE_SIZE;
  const pageRows = logsAll.slice(start, start + LOGS_PAGE_SIZE);

  if (pageRows.length === 0) {
    el.innerHTML = `<div class="item muted">기록이 없습니다.</div>`;
  } else {
    el.innerHTML = pageRows.map(l => `
      <div class="item">
        <div style="display:flex; justify-content:space-between; font-size:13px;">
          <b style="color:#1e293b;">${l.action || 'ACTION'}</b>
          <span style="color:#94a3b8;">${new Date(l.created_at).toLocaleTimeString()}</span>
        </div>
        <div style="font-size:12px; color:#64748b;">대상: ${l.target_type || l.table_name || '-'}</div>
      </div>
    `).join('');
  }
  info.textContent = `${logsPage} / ${total}`;
}

// 페이징 이벤트 바인딩
function bindLogPager() {
  document.getElementById('logs-prev')?.addEventListener('click', () => {
    if (logsPage > 1) { logsPage--; renderLogPage(); }
  });
  document.getElementById('logs-next')?.addEventListener('click', () => {
    const total = Math.ceil(logsAll.length / LOGS_PAGE_SIZE);
    if (logsPage < total) { logsPage++; renderLogPage(); }
  });
}

/**
 * 3. 데이터 이상 탐지 (Integrity Check)
 */
async function detectIssues() {
  try {
    const { data: nodes, error: nErr } = await supabase.from('outdoor_nodes').select('*');
    const { data: edges, error: eErr } = await supabase.from('outdoor_edges').select('*');
    if (nErr || eErr) throw new Error('데이터 조회 실패');

    const issues = [];
    (nodes || []).forEach(n => {
      if (n.elevation == null) issues.push({ text: `고도 누락: ${n.name || n.id}`, type: 'danger', lat: n.lat, lng: n.lng });
      const connected = (edges || []).some(e => e.from_node === n.id || e.to_node === n.id);
      if (!connected) issues.push({ text: `고립 노드: ${n.name || n.id}`, type: 'warn', lat: n.lat, lng: n.lng });
    });

    (edges || []).forEach(e => {
      if (e.from_node === e.to_node) issues.push({ text: `자기 루프 엣지: ID ${e.id}`, type: 'danger' });
      if (!e.distance || e.distance <= 0) issues.push({ text: `거리 오류 엣지: ID ${e.id}`, type: 'danger' });
    });

    const el = document.getElementById('data-issues');
    if (!el) return;

    if (issues.length === 0) {
      el.innerHTML = `<div class="item ok">✅ 모든 데이터가 정상입니다.</div>`;
    } else {
      el.innerHTML = issues.map(i => {
        const clickAttr = (i.lat != null) ? `onclick="goToMap(${i.lat},${i.lng})"` : '';
        return `<div class="item ${i.type}" ${clickAttr}>${i.text}</div>`;
      }).join('');
    }
  } catch (err) {
    console.error('[Dashboard Error] detectIssues 실패:', err.message);
  }
}

/**
 * 4. 경로 품질 분석 (Slope/Path Analysis)
 */
async function analyzePaths() {
  try {
    const { data: nodes } = await supabase.from('outdoor_nodes').select('*');
    const { data: edges } = await supabase.from('outdoor_edges').select('*');
    const nodeMap = {};
    nodes?.forEach(n => nodeMap[n.id] = n);

    const results = [];
    (edges || []).forEach(e => {
      const from = nodeMap[e.from_node];
      const to = nodeMap[e.to_node];
      if (!from || !to) return;

      const elevDiff = (from.elevation ?? 0) - (to.elevation ?? 0);
      const slope = elevDiff / (e.distance || 1);

      if (Math.abs(slope) > 0.3) {
        results.push({ text: `급경사 주의: ${e.name || e.id}`, type: 'warn', lat: from.lat, lng: from.lng });
      }
      if (!e.path_points || e.path_points.length === 0) {
        results.push({ text: `직선경로 확인: ${e.id}`, type: 'ok', lat: from.lat, lng: from.lng });
      }
    });

    const el = document.getElementById('path-analysis');
    if (!el) return;

    if (results.length === 0) {
      el.innerHTML = `<div class="item ok">✅ 경로 품질 양호</div>`;
    } else {
      el.innerHTML = results.map(i => `
        <div class="item ${i.type}" onclick="goToMap(${i.lat},${i.lng})">${i.text}</div>
      `).join('');
    }
  } catch (err) {
    console.error('[Dashboard Error] analyzePaths 실패:', err.message);
  }
}

/**
 * 5. 실시간 노드 상태 및 오버레이 관리
 */
async function loadNodeStatus() {
  try {
    const { data, error } = await supabase
      .from('node_status')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    
    const rows = data || [];
    rows.forEach(updateChip);
    renderStatusList(rows);
  } catch (err) {
    console.error('[Dashboard Error] loadNodeStatus 실패:', err.message);
  }
}

function updateChip(row) {
  const id = String(row.node_id);
  let chip = chipMap.get(id);

  if (!chip) {
    chip = createChip(row);
    chipMap.set(id, chip);
  }

  // DOM 최적화를 위해 변경된 값만 업데이트
  chip.querySelector('.p').textContent = row.last_people_count ?? 0;
  chip.querySelector('.r').textContent = Number(row.last_occupancy_ratio ?? 0).toFixed(2);
  
  const lv = String(row.last_congestion_level ?? 'LOW').toUpperCase();
  const lEl = chip.querySelector('.l');
  lEl.textContent = lv;
  lEl.className = `chip-badge ${getLevelClass(lv)} l`;

  // 최신성 시각화
  if (isStale(row.updated_at)) chip.classList.add('stale');
  else chip.classList.remove('stale');
}

function createChip(row) {
  const id = String(row.node_id);
  const chip = document.createElement('div');
  chip.className = 'overlay-chip';
  chip.dataset.id = id;
  chip.innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
      <b style="color:#fff;">Node ${id}</b>
      <span style="font-size:10px; opacity:0.7;">${row.node_scope}</span>
    </div>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:4px;">
      <div>인원: <b class="p">0</b></div>
      <div>점유: <b class="r">0.00</b></div>
    </div>
    <div style="text-align:center; margin-top:4px;">
      <span class="chip-badge ${getLevelClass(row.last_congestion_level)} l">${row.last_congestion_level || 'LOW'}</span>
    </div>
  `;

  document.getElementById('overlay-layer').appendChild(chip);

  // 위치 복원
  const saved = chipPos[id];
  const baseX = saved?.x ?? 20 + (Math.random() * 100); 
  const baseY = saved?.y ?? 20 + (Math.random() * 100);
  chip.style.left = `${baseX}px`;
  chip.style.top = `${baseY}px`;

  bindChipDrag(chip);
  return chip;
}

function bindChipDrag(chip) {
  let isDragging = false;
  let startX, startY, initialX, initialY;

  chip.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    initialX = parseFloat(chip.style.left);
    initialY = parseFloat(chip.style.top);
    chip.style.zIndex = 1000;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    const stage = document.getElementById('video-stage');
    const maxX = stage.clientWidth - chip.offsetWidth;
    const maxY = stage.clientHeight - chip.offsetHeight;

    let nextX = Math.min(Math.max(0, initialX + dx), maxX);
    let nextY = Math.min(Math.max(0, initialY + dy), maxY);

    chip.style.left = `${nextX}px`;
    chip.style.top = `${nextY}px`;
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    const id = chip.dataset.id;
    chipPos[id] = { x: parseFloat(chip.style.left), y: parseFloat(chip.style.top) };
    localStorage.setItem(CHIP_POS_KEY, JSON.stringify(chipPos));
  });
}

function renderStatusList(rows) {
  const el = document.getElementById('node-status-list');
  if (!el) return;

  if (rows.length === 0) {
    el.innerHTML = `<div class="item muted">상태 데이터가 없습니다.</div>`;
    return;
  }

  el.innerHTML = rows.map(r => {
    const lv = String(r.last_congestion_level ?? 'LOW').toUpperCase();
    const staleIcon = isStale(r.updated_at) ? '⚠️ ' : '';
    return `
      <div class="item">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <b>Node ${r.node_id}</b>
          <span class="chip-badge ${getLevelClass(lv)}">${lv}</span>
        </div>
        <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
          인원 ${r.last_people_count ?? 0}명 | 점유 ${Number(r.last_occupancy_ratio ?? 0).toFixed(2)}
          ${staleIcon}<span style="font-size:10px;">${new Date(r.updated_at).toLocaleTimeString()}</span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 6. 실시간 구독 (Realtime)
 */
function subscribeNodeStatus() {
  const channel = supabase
    .channel('node-status-updates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'node_status' }, () => {
      console.log('[Realtime] 노드 상태 변경 감지');
      loadNodeStatus();
    })
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') {
        console.error('[Realtime Error] 구독 실패:', status);
      }
    });
}

/**
 * 7. 스트림 뷰어 초기화
 */
function initStreamViewer() {
  const input = document.getElementById('stream-url');
  const btn = document.getElementById('apply-stream-btn');
  const img = document.getElementById('live-stream-view');
  
  const saved = localStorage.getItem(STREAM_URL_KEY) || 'http://192.168.0.100:81/stream';
  if (input) input.value = saved;
  if (img) img.src = saved;

  btn?.addEventListener('click', () => {
    const url = input.value.trim();
    if (!url) return alert('URL을 입력하세요.');
    localStorage.setItem(STREAM_URL_KEY, url);
    img.src = url;
    console.log('[Stream] URL 변경:', url);
  });
}

// --- 페이지 이동 함수 ---
window.goOutdoor = () => location.href = '../../html/campus/map_outdoor.html';
window.goIndoor = () => location.href = '../../html/campus/map_indoor.html';
window.goVisionControl = () => location.href = '../../html/admin/admin_vision_control.html';

// --- 앱 실행 ---
(async function main() {
  console.log('[Dashboard] 시스템 시작...');
  try {
    await Promise.all([
      loadStats(),
      loadLogs(),
      detectIssues(),
      analyzePaths(),
      initStreamViewer(),
      loadNodeStatus()
    ]);
    bindLogPager();
    subscribeNodeStatus();
    console.log('[Dashboard] 모든 서비스 정상 가동 중');
  } catch (err) {
    console.error('[Dashboard Fatal Error] 초기화 실패:', err);
  }
})();

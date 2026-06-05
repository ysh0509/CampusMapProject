/**
 * @file admin_hardware_mgmt.js
 * @description 하드웨어 프로필(ESP32 등)의 식별 정보 및 내비게이션 연결 관리
 */

import { supabase } from '../../js/admin/common/adminApi.js';
import { protectPage } from '../../js/admin/common/adminRouterGuard.js';
import { initAdminHeader } from '../../js/admin/common/adminHeader.js';

await protectPage();
initAdminHeader('hardware');

const $ = (id) => document.getElementById(id);

const el = {
  hwId: $('hw_id'),
  hwIp: $('hw_ip'),
  hwTargetPoint: $('hw_target_point'),
  hwIsActive: $('hw_is_active'),
  btnNew: $('btn_new'),
  btnSave: $('btn_save'),
  btnDelete: $('btn_delete'),
  hwList: $('hw_list'),
  hwCount: $('hw_count')
};

let hardwareProfiles = [];
let selectedId = null; // PK (id)

// --- Utilities ---
function setStatus(msg, ok = true) {
  // 대시보드 스타일의 Toast 혹은 간단한 알림 처리 (필요시 확장)
  console.log(`[Hardware Mgmt] ${ok ? 'SUCCESS' : 'ERROR'}: ${msg}`);
}

// --- Data Loading ---
async function loadHardwareProfiles() {
  const { data, error } = await supabase
    .from('hardware_profiles')
    .select('*')
    .order('hardware_id', { ascending: true });

  if (error) {
    console.error('Load error:', error);
    return setStatus('목록 로드 실패', false);
  }

  hardwareProfiles = data || [];
  el.hwCount.textContent = hardwareProfiles.length;
  renderList();
}

function renderList() {
  el.hwList.innerHTML = hardwareProfiles.map(hw => `
    <div class="item ${selectedId === hw.id ? 'active' : ''}" data-id="${hw.id}">
      <div class="item-main">
        <span class="item-id">${hw.hardware_id}</span>
        <span class="badge ${hw.is_active ? 'badge-on' : 'badge-off'}">
          ${hw.is_active ? 'ON' : 'OFF'}
        </span>
      </div>
      <div class="item-sub">
        <span><i class="fas fa-network-wired"></i> ${hw.hardware_ip || '-'}</span>
        <span><i class="fas fa-map-marker-alt"></i> Point: ${hw.target_point || '-'}</span>
      </div>
    </div>
  `).join('');

  // 클릭 이벤트 바인딩
  el.hwList.querySelectorAll('.item').forEach(item => {
    item.onclick = () => selectProfile(Number(item.dataset.id));
  });
}

function selectProfile(id) {
  selectedId = id;
  const hw = hardwareProfiles.find(h => h.id === id);
  if (!hw) return;

  el.hwId.value = hw.hardware_id;
  el.hwIp.value = hw.hardware_ip || '';
  el.hwTargetPoint.value = hw.target_point || '';
  el.hwIsActive.value = String(hw.is_active);

  renderList(); // active 클래스 업데이트를 위해 재렌더링
}

function clearForm() {
  selectedId = null;
  el.hwId.value = '';
  el.hwIp.value = '';
  el.hwTargetPoint.value = '';
  el.hwIsActive.value = 'true';
  renderList();
}

// --- CRUD Operations ---
async function saveProfile() {
  const hardware_id = el.hwId.value.trim();
  const hardware_ip = el.hwIp.value.trim();
  const target_point = el.hwTargetPoint.value ? Number(el.hwTargetPoint.value) : null;
  const is_active = el.hwIsActive.value === 'true';

  if (!hardware_id) return setStatus('Hardware ID는 필수입니다.', false);

  const payload = {
    hardware_id,
    hardware_ip,
    target_point,
    is_active,
    updated_at: new Date().toISOString()
  };

  if (selectedId) {
    // Update
    const { error } = await supabase
      .from('hardware_profiles')
      .update(payload)
      .eq('id', selectedId);
    if (error) return setStatus(`수정 실패: ${error.message}`, false);
    setStatus('수정되었습니다.');
  } else {
    // Insert
    const { error } = await supabase
      .from('hardware_profiles')
      .insert(payload);
    if (error) return setStatus(`생성 실패: ${error.message}`, false);
    setStatus('새 프로필이 생성되었습니다.');
  }

  await loadHardwareProfiles();
}

async function deleteProfile() {
  if (!selectedId) return setStatus('삭제할 프로필을 선택하세요.', false);
  if (!confirm('정말로 이 하드웨어를 삭제하시겠습니까?')) return;

  const { error } = await supabase
    .from('hardware_profiles')
    .delete()
    .eq('id', selectedId);

  if (error) return setStatus(`삭제 실패: ${error.message}`, false);
  
  setStatus('삭제되었습니다.');
  clearForm();
  await loadHardwareProfiles();
}

// --- Initialization ---
function bindEvents() {
  el.btnNew.onclick = clearForm;
  el.btnSave.onclick = saveProfile;
  el.btnDelete.onclick = deleteProfile;
}

async function init() {
  bindEvents();
  await loadHardwareProfiles();
  clearForm();
}

init();

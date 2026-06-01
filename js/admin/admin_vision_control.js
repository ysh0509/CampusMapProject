/* =========================================================
   IMPORT & INITIALIZATION
   ========================================================= */
import { supabase } from '/js/admin/common/adminApi.js';
import { protectPage } from '/js/admin/common/adminRouterGuard.js';
import { initAdminHeader } from '/js/admin/common/adminHeader.js';

// 페이지 보호 및 헤더 초기화
await protectPage();
initAdminHeader('vision');

const $ = (id) => document.getElementById(id);

// DOM 요소 맵핑
const el = {
  cameraId: $('camera_id'),
  cameraName: $('camera_name'),
  videoSource: $('video_source'),
  nodeScope: $('node_scope'),
  isActive: $('is_active'),
  roiJson: $('roi_json'),
  roiMsg: $('roi_msg'),
  profileList: $('profile_list'),
  previewUrl: $('preview_url'),
  previewImg: $('preview_img'),
  btnNew: $('btn_new'),
  btnValidate: $('btn_validate'),
  btnSave: $('btn_save'),
  btnDelete: $('btn_delete'),
  btnSetActive: $('btn_set_active'),
  btnPreview: $('btn_preview'),
  btnUsb0: $('btn_usb_0'),
  btnUsb1: $('btn_usb_1'),
  btnUsb2: $('btn_usb_2')
};

let profiles = [];
let selectedId = null;

const defaultRoi = {
  zones: [{
    "id": 101, "name": "zone-101", "low_lt": 3, "mid_lt": 7,
    "points": [[20, 40], [620, 40], [620, 350], [20, 350]], "capacity": 10
  }]
};

/* =========================================================
   UTILITIES
   ========================================================= */
function setMsg(msg, ok = true) {
  if (!el.roiMsg) return;
  el.roiMsg.textContent = msg;
  el.roiMsg.className = ok ? 'msg-box show ok' : 'msg-box show err';
  setTimeout(() => el.roiMsg.classList.remove('show'), 3000);
}

function isValidVideoSource(v) {
  const s = String(v || '').trim();
  if (!s) return false;
  if (/^\d+$/.test(s)) return true;
  if (/^(rtsp|http|https):\/\//i.test(s)) return true;
  if (/\.(mp4|avi|mov|mkv|webm)$/i.test(s)) return true;
  return true;
}

function validateRoiJsonText(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, msg: 'JSON 파싱 실패' }; }
  if (!obj || !Array.isArray(obj.zones) || obj.zones.length === 0) return { ok: false, msg: 'zones 배열이 필요합니다.' };
  for (const z of obj.zones) {
    if (z.id === undefined || !Array.isArray(z.points) || z.points.length < 3) return { ok: false, msg: `zone ${z.id} 형식이 잘못되었습니다.` };
  }
  return { ok: true, msg: 'ROI JSON 유효' };
}

/* =========================================================
   FORM CONTROL
   ========================================================= */
function clearForm() {
  selectedId = null;
  el.cameraId.value = '';
  el.cameraName.value = '';
  el.videoSource.value = '0';
  el.nodeScope.value = 'indoor';
  el.isActive.checked = false;
  el.roiJson.value = JSON.stringify(defaultRoi, null, 2);
  if (el.previewUrl) el.previewUrl.value = '';
  if (el.previewImg) el.previewImg.src = '';
  setMsg('입력 폼이 초기화되었습니다.');
}

function fillForm(p) {
  selectedId = p.camera_id;
  el.cameraId.value = p.camera_id ?? '';
  el.cameraName.value = p.name ?? '';
  el.videoSource.value = String(p.video_source ?? '');
  el.nodeScope.value = p.node_scope ?? 'indoor';
  el.isActive.checked = !!p.is_active;
  el.roiJson.value = JSON.stringify(p.roi_json ?? defaultRoi, null, 2);
  if (el.previewUrl) el.previewUrl.value = String(p.video_source ?? '');
  if (el.previewImg) {
    const v = String(p.video_source ?? '');
    el.previewImg.src = /^\d+$/.test(v) ? '' : v;
  }
}

function renderList() {
  if (!el.profileList) return;
  el.profileList.innerHTML = (profiles || []).map(p => {
    const active = p.is_active ? 'active' : '';
    const dotClass = p.is_active ? 'dot-on' : 'dot-off';
    return `
      <div class="list-item ${active}" data-id="${p.camera_id}">
        <div class="status-dot ${dotClass}"></div>
        <div class="item-info">
          <span class="item-id">${p.camera_id}</span>
          <span class="item-sub">${p.name ?? '-'} | ${p.video_source}</span>
        </div>
      </div>`;
  }).join('');

  el.profileList.querySelectorAll('.list-item').forEach(node => {
    node.onclick = () => {
      const id = node.dataset.id;
      const p = profiles.find(x => x.camera_id === id);
      if (p) fillForm(p);
    };
  });
}

/* =========================================================
   DATABASE OPERATIONS (SUPABASE)
   ========================================================= */
async function loadProfiles() {
  const { data, error } = await supabase
    .from('camera_profiles')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    setMsg(`로드 실패: ${error.message}`, false);
    return;
  }
  profiles = data || [];
  renderList();
}

async function saveProfile() {
  const camera_id = el.cameraId.value.trim();
  const name = el.cameraName.value.trim();
  const video_source = el.videoSource.value.trim();
  const node_scope = el.nodeScope.value;
  const is_active = el.isActive.checked;
  const roiText = el.roiJson.value.trim();

  if (!camera_id) return setMsg('camera_id 필수', false);
  if (!isValidVideoSource(video_source)) return setMsg('video_source 형식 오류', false);

  const v = validateRoiJsonText(roiText);
  if (!v.ok) return setMsg(v.msg, false);

  const roi_json = JSON.parse(roiText);

  // 단일 활성 원칙: 새 카메라를 켜는 경우, 기존의 다른 카메라들은 모두 끈다.
  if (is_active) {
    await supabase.from('camera_profiles').update({ is_active: false }).neq('camera_id', camera_id);
  }

  const payload = {
    camera_id, name, video_source, node_scope, roi_json, is_active,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from('camera_profiles').upsert(payload);
  if (error) return setMsg(`저장 실패: ${error.message}`, false);

  setMsg('설정이 저장되었습니다.');
  await loadProfiles();
  const p = profiles.find(x => x.camera_id === camera_id);
  if (p) fillForm(p);
}

async function deleteProfile() {
  const id = el.cameraId.value.trim();
  if (!id) return setMsg('삭제할 camera_id 입력', false);
  if (!confirm(`정말로 '${id}' 프로필을 삭제하시겠습니까?`)) return;

  const { error } = await supabase.from('camera_profiles').delete().eq('camera_id', id);
  if (error) return setMsg(`삭제 실패: ${error.message}`, false);

  setMsg('삭제 완료');
  await loadProfiles();
  clearForm();
}

/**
 * [핵심] 활성 상태 즉시 전환 함수
 * 체크박스를 조작하면 Supabase DB의 is_active 값이 업데이트됩니다.
 * 이 업데이트를 로컬 PC의 command_listener.py가 Realtime으로 감지하여 엔진을 켭니다/끕니다.
 */
async function handleActiveStatusChange() {
  const id = el.cameraId.value.trim();
  if (!id) return setMsg('camera_id가 필요합니다.', false);

  const targetIsActive = el.isActive.checked;

  // 1. 다른 모든 카메라 비활성화 (단일 활성 보장)
  await supabase.from('camera_profiles').update({ is_active: false });

  // 2. 현재 선택된 카메라 상태 업데이트
  const { error } = await supabase.from('camera_profiles').update({
    is_active: targetIsActive,
    updated_at: new Date().toISOString()
  }).eq('camera_id', id);

  if (error) {
    setMsg(`상태 변경 실패: ${error.message}`, false);
    el.isActive.checked = !targetIsActive; // 실패 시 UI 롤백
  } else {
    setMsg(`${targetIsActive ? '활성화' : '비활성화'} 명령 전달됨`);
    await loadProfiles();
    const p = profiles.find(x => x.camera_id === id);
    if (p) fillForm(p);
  }
}

async function setActiveProfile() {
  el.isActive.checked = true;
  await handleActiveStatusChange();
}

function applyPreview() {
  const url = (el.previewUrl?.value || '').trim();
  if (!url || !el.previewImg) return;
  if (/^\d+$/.test(url)) {
    setMsg('USB 카메라는 웹에서 직접 볼 수 없습니다.', false);
    el.previewImg.src = '';
    return;
  }
  el.previewImg.src = url;
  setMsg('미리보기 적용됨');
}

function setUsbSource(idx) {
  if (!el.videoSource) return;
  el.videoSource.value = String(idx);
  if (el.previewUrl) el.previewUrl.value = String(idx);
  if (el.previewImg) el.previewImg.src = '';
  [el.btnUsb0, el.btnUsb1, el.btnUsb2].forEach((btn, i) => {
    btn.classList.toggle('active', i === idx);
  });
  setMsg(`USB 소스 ${idx} 선택됨`);
}

/* =========================================================
   EVENT BINDING
   ========================================================= */
function bindEvents() {
  if (el.btnNew) el.btnNew.onclick = clearForm;
  if (el.btnSave) el.btnSave.onclick = saveProfile;
  if (el.btnDelete) el.btnDelete.onclick = deleteProfile;
  if (el.btnValidate) el.btnValidate.onclick = () => {
    const v = validateRoiJsonText(el.roiJson.value);
    setMsg(v.msg, v.ok);
  };
  if (el.btnPreview) el.btnPreview.onclick = applyPreview;
  if (el.btnSetActive) el.btnSetActive.onclick = setActiveProfile;

  // [핵심] 체크박스 변경 시 즉시 DB 반영 (이것이 무선 명령의 트리거가 됨)
  if (el.isActive) {
    el.isActive.onchange = handleActiveStatusChange;
  }

  if (el.btnUsb0) el.btnUsb0.onclick = () => setUsbSource(0);
  if (el.btnUsb1) el.btnUsb1.onclick = () => setUsbSource(1);
  if (el.btnUsb2) el.btnUsb2.onclick = () => setUsbSource(2);
}

// 초기 실행
bindEvents();
clearForm();
await loadProfiles();

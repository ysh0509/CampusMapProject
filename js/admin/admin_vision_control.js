/**
 * @file admin_vision_control.js
 * @description 카메라 프로필 CRUD 및 실시간 상태 관리를 위한 관리자 페이지 로직
 * 개선사항: 
 * 1. 체크박스(is_active) 조작 시 즉시 DB 반영 (Auto-save)
 * 2. USB 소스 선택 및 미리보기 UX 개선
 * 3. 컴팩트한 2단 레이아웃에 최적화된 이벤트 바인딩
 */

import { protectPage } from './common/adminRouterGuard.js';
import { initAdminHeader } from './common/adminHeader.js';
import { supabase } from './common/adminApi.js';

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

// 기본 ROI 구조 정의
const defaultRoi = {
  zones: [{
    "id": 101,
    "name": "zone-101",
    "low_lt": 3,
    "mid_lt": 7,
    "points": [[20, 40], [620, 40], [620, 350], [20, 350]],
    "capacity": 10
  }]
};

/**
 * UI 메시지 출력 함수
 * @param {string} msg - 표시할 메시지
 * @param {boolean} ok - 성공 여부 (true: 녹색, false: 적색)
 */
function setMsg(msg, ok = true) {
  if (!el.roiMsg) return;
  el.roiMsg.textContent = msg;
  el.roiMsg.className = ok ? 'msg-box show ok' : 'msg-box show err';
  
  // 3초 후 메시지 숨김 (UI 자동 정리)
  setTimeout(() => {
    el.roiMsg.classList.remove('show');
  }, 3000);
}

/**
 * 비디오 소스 형식 유효성 검사
 */
function isValidVideoSource(v) {
  const s = String(v || '').trim();
  if (!s) return false;
  if (/^\d+$/.test(s)) return true; // USB 인덱스 (0, 1, 2...)
  if (/^(rtsp|http|https):\/\//i.test(s)) return true; // 스트리밍 URL
  if (/\.(mp4|avi|mov|mkv|webm)$/i.test(s)) return true; // 영상 파일
  return true;
}

/**
 * ROI JSON 데이터 구조 검증
 */
function validateRoiJsonText(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, msg: 'JSON 파싱 실패' };
  }

  if (!obj || !Array.isArray(obj.zones) || obj.zones.length === 0) {
    return { ok: false, msg: 'zones 배열이 필요합니다.' };
  }

  for (const z of obj.zones) {
    if (z.id === undefined || !Array.isArray(z.points) || z.points.length < 3) {
      return { ok: false, msg: `zone ${z.id} 형식이 잘못되었습니다.` };
    }
  }
  return { ok: true, msg: 'ROI JSON 유효' };
}

/**
 * 폼 초기화 (새로 만들기)
 */
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

/**
 * 특정 프로필 데이터를 폼에 채우기
 */
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

/**
 * 프로필 목록 렌더링
 */
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

/**
 * 전체 프로필 로드 (Supabase)
 */
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

/**
 * 프로필 저장/수정 (Upsert)
 */
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

  // 만약 이 카메라를 활성화한다면, 기존에 켜져있던 다른 카메라들은 모두 끈다 (단일 활성 원칙)
  if (is_active) {
    await supabase.from('camera_profiles').update({ is_active: false }).neq('camera_id', camera_id);
  }

  const payload = {
    camera_id,
    name,
    video_source,
    node_scope,
    roi_json,
    is_active,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from('camera_profiles').upsert(payload);
  if (error) return setMsg(`저장 실패: ${error.message}`, false);

  setMsg('설정이 저장되었습니다.');
  await loadProfiles();
  const p = profiles.find(x => x.camera_id === camera_id);
  if (p) fillForm(p);
}

/**
 * 프로필 삭제
 */
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
 * [핵심 개선] 활성 상태 즉시 전환 함수 (Auto-save 기능)
 * 사용자가 '활성화' 버튼을 누르거나 체크박스를 조작할 때 호출됨
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
    // 실패 시 UI를 이전 상태로 롤백
    el.isActive.checked = !targetIsActive;
  } else {
    setMsg(`${targetIsActive ? '활성화' : '비활성화'} 성공`);
    await loadProfiles(); // 목록 갱신
    const p = profiles.find(x => x.camera_id === id);
    if (p) fillForm(p);
  }
}

/**
 * 별도의 '활성화 전용 버튼' 클릭 시 처리
 */
async function setActiveProfile() {
  el.isActive.checked = true;
  await handleActiveStatusChange();
}

/**
 * 스트림 미리보기 적용
 */
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

/**
 * USB 소스 번호 빠른 선택
 */
function setUsbSource(idx) {
  if (!el.videoSource) return;
  el.videoSource.value = String(idx);
  if (el.previewUrl) el.previewUrl.value = String(idx);
  if (el.previewImg) el.previewImg.src = '';
  
  // USB 버튼 시각적 효과 (Active 클래스 관리)
  [el.btnUsb0, el.btnUsb1, el.btnUsb2].forEach((btn, i) => {
    btn.classList.toggle('active', i === idx);
  });
  
  setMsg(`USB 소스 ${idx} 선택됨`);
}

/**
 * 이벤트 바인딩
 */
function bindEvents() {
  // 기본 버튼
  if (el.btnNew) el.btnNew.onclick = clearForm;
  if (el.btnSave) el.btnSave.onclick = saveProfile;
  if (el.btnDelete) el.btnDelete.onclick = deleteProfile;
  if (el.btnValidate) el.btnValidate.onclick = () => {
    const v = validateRoiJsonText(el.roiJson.value);
    setMsg(v.msg, v.ok);
  };
  if (el.btnPreview) el.btnPreview.onclick = applyPreview;
  if (el.btnSetActive) el.btnSetActive.onclick = setActiveProfile;

  // [개선] 체크박스 클릭 시 즉시 DB 반영 (Auto-save)
  if (el.isActive) {
    el.isActive.onchange = handleActiveStatusChange;
  }

  // USB 소스 선택
  if (el.btnUsb0) el.btnUsb0.onclick = () => setUsbSource(0);
  if (el.btnUsb1) el.btnUsb1.onclick = () => setUsbSource(1);
  if (el.btnUsb2) el.btnUsb2.onclick = () => setUsbSource(2);
}

// 초기 실행
bindEvents();
clearForm();
await loadProfiles();

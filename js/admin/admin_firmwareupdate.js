import { supabase } from '/js/admin/common/adminApi.js';
import { initAdminHeader } from '/js/admin/common/adminHeader.js';
import { protectPage } from '/js/admin/common/adminRouterGuard.js';


await protectPage();
initAdminHeader('firmware');

// DOM 요소
const otaForm = document.getElementById('ota-form');
const loadingOverlay = document.getElementById('loading-overlay');
const historyList = document.getElementById('history-list');

// SHA-256 해시 계산 함수 (Web Crypto API 사용)
async function calculateSHA256(file) {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 히스토리 목록 로드
async function loadHistory() {
  const { data, error } = await supabase
    .from('firmware_updates')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading history:', error);
    return;
  }

  historyList.innerHTML = data.map(item => `
    <tr>
      <td><b>${item.version}</b></td>
      <td>${item.description || '-'}</td>
      <td>${new Date(item.created_at).toLocaleString()}</td>
      <td>
        <span class="badge ${item.is_active ? 'badge-active' : 'badge-old'}">
          ${item.is_active ? '현재 활성 버전' : '이전 버전'}
        </span>
      </td>
    </tr>
  `).join('');
}

// 폼 제출 이벤트
otaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const file = document.getElementById('firmware-file').files[0];
  const version = document.getElementById('version-input').value;
  const description = document.getElementById('desc-input').value;

  if (!file) return;

  loadingOverlay.style.display = 'flex';

  try {
    // 1. 파일 해시 계산
    const checksum = await calculateSHA256(file);

    // 2. Supabase Storage에 업로드
    const fileName = `firmware_${version}_${Date.now()}.bin`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('firmware')
      .upload(fileName, file);

    if (uploadError) throw uploadError;

    // 3. 업로드된 파일의 Public URL 가져오기
    const { data: urlData } = supabase.storage
      .from('firmware')
      .getPublicUrl(fileName);

    // 4. DB에 레코드 삽입 (트리거가 작동하여 기존 active 버전을 false로 전환함)
    const { error: dbError } = await supabase
      .from('firmware_updates')
      .insert([{
        version,
        file_url: urlData.publicUrl,
        checksum,
        description,
        is_active: true
      }]);

    if (dbError) throw dbError;

    alert('성공적으로 배포되었습니다! ESP32가 곧 업데이트를 감지합니다.');
    otaForm.reset();
    loadHistory();

  } catch (error) {
    console.error('OTA Upload Error:', error);
    alert(`오류 발생: ${error.message}`);
  } finally {
    loadingOverlay.style.display = 'none';
  }
});

// 초기화
loadHistory();

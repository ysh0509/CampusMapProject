import { supabase } from './common/adminApi.js';
import { protectPage } from './common/adminRouterGuard.js';

// 1. 페이지 보호 및 권한 확인
await protectPage();

const {
  data: { user }
} = await supabase.auth.getUser();

const { data: me, error: meError } = await supabase
  .from('admin_users')
  .select('role')
  .eq('id', user.id)
  .single();

if (meError || me.role !== 'superadmin') {
  alert('접근 권한이 없습니다. Super Admin만 진입 가능합니다.');
  location.href = '/';
  throw new Error('Unauthorized');
}

// 2. DOM 요소 참조 (새로운 UI 구조 반영)
const adminTableBody = document.getElementById('admin-table-body');
const logTableBody = document.getElementById('log-table-body');
const totalAdminsEl = document.getElementById('total-admins'); // Stats용
const totalLogsEl = document.getElementById('total-logs');     // Stats용

// 3. 데이터 로드 및 UI 업데이트 함수

/**
 * 관리자 목록 로드 및 테이블 렌더링
 */
async function loadAdmins() {
  const { data, error } = await supabase
    .from('admin_users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Load Admins Error:', error);
    return;
  }

  // 통계 업데이트
  if (totalAdminsEl) totalAdminsEl.textContent = data.length;

  adminTableBody.innerHTML = '';

  data.forEach(admin => {
    const tr = document.createElement('tr');

    // Role에 따른 Badge 클래스 결정
    const badgeClass = admin.role === 'superadmin' ? 'badge-superadmin' : 'badge-admin';

    tr.innerHTML = `
      <td>${admin.email}</td>
      <td><span class="badge ${badgeClass}">${admin.role}</span></td>
      <td>${new Date(admin.created_at).toLocaleString()}</td>
      <td style="text-align: right;">
        <div class="row" style="justify-content: flex-end;">
          <select class="role-select" data-id="${admin.id}" style="margin-top:0; width: auto;">
            <option value="admin" ${admin.role === 'admin' ? 'selected' : ''}>admin</option>
            <option value="superadmin" ${admin.role === 'superadmin' ? 'selected' : ''}>superadmin</option>
          </select>
          <button class="delete-btn btn-danger" data-id="${admin.id}" style="margin-top:0;">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </td>
    `;

    adminTableBody.appendChild(tr);
  });

  // 이벤트 바인딩 (새로 생성된 요소에 대해)
  bindRoleEvents();
  bindDeleteEvents();
}

/**
 * 시스템 로그 로드 및 테이블 렌더링
 */
async function loadLogs() {
  const { data, error } = await supabase
    .from('admin_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Load Logs Error:', error);
    return;
  }

  // 통계 업데이트 (오늘 발생한 로그 수 예시)
  if (totalLogsEl) totalLogsEl.textContent = data.length;

  logTableBody.innerHTML = '';

  data.forEach(log => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color: var(--text-secondary); font-size: 0.8rem;">#${log.id}</td>
      <td><span class="badge" style="background: rgba(255,255,255,0.1);">${log.action}</span></td>
      <td>${log.description ?? '-'}</td>
      <td style="color: var(--text-secondary); font-size: 0.85rem;">${new Date(log.created_at).toLocaleString()}</td>
    `;
    logTableBody.appendChild(tr);
  });
}

// 4. 이벤트 핸들러

/**
 * 권한 변경 (Role Change)
 */
function bindRoleEvents() {
  document.querySelectorAll('.role-select').forEach(select => {
    select.addEventListener('change', async e => {
      const id = e.target.dataset.id;
      const role = e.target.value;

      const { error } = await supabase
        .from('admin_users')
        .update({ role })
        .eq('id', id);

      if (error) {
        alert('권한 변경 실패');
        loadAdmins(); // 상태 복구
        return;
      }

      // 로그 기록
      await supabase.from('admin_logs').insert({
        admin_id: user.id,
        action: 'ROLE_CHANGE',
        target_type: 'admin_users',
        description: `권한 변경 → ${role}`,
        after_data: { role }
      });

      alert('권한이 성공적으로 변경되었습니다.');
      loadAdmins();
      loadLogs();
    });
  });
}

/**
 * 관리자 삭제 (Delete Admin)
 */
function bindDeleteEvents() {
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = e.target.dataset.id;

      if (!confirm('정말 이 관리자를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;

      const { error } = await supabase
        .from('admin_users')
        .delete()
        .eq('id', id);

      if (error) {
        alert('삭제 실패');
        return;
      }

      await supabase.from('admin_logs').insert({
        admin_id: user.id,
        action: 'DELETE_ADMIN',
        target_type: 'admin_users',
        description: `관리자 계정 삭제 (ID: ${id})`
      });

      alert('삭제가 완료되었습니다.');
      loadAdmins();
      loadLogs();
    });
  });
}

/**
 * 신규 관리자 생성 (Create Admin)
 */
document.getElementById('create-admin-btn').addEventListener('click', async () => {
  const email = document.getElementById('new-email').value;
  const password = document.getElementById('new-password').value;
  const role = document.getElementById('new-role').value;

  if (!email || !password) {
    alert('이메일과 비밀번호를 모두 입력해주세요.');
    return;
  }

  // UX: 생성 중 버튼 비활성화
  const btn = document.getElementById('create-admin-btn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Processing...';

  try {
    // 1. Auth 계정 생성
    const { data, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError) throw authError;
    if (!data.user) throw new Error('User creation failed');

    // 2. admin_users 테이블에 프로필 등록
    const { error: insertError } = await supabase
      .from('admin_users')
      .insert({
        id: data.user.id,
        email: data.user.email,
        role
      });

    if (insertError) throw insertError;

    // 3. 로그 기록
    await supabase.from('admin_logs').insert({
      admin_id: user.id,
      action: 'CREATE_ADMIN',
      target_type: 'admin_users',
      description: `신규 관리자 생성 (${email})`,
      after_data: { email, role }
    });

    alert('관리자 계정이 생성되었습니다.');
    
    // 입력창 초기화
    document.getElementById('new-email').value = '';
    document.getElementById('new-password').value = '';
    
    loadAdmins();
    loadLogs();
  } catch (error) {
    console.error(error);
    alert(`실패: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// 5. 초기 실행
loadAdmins();
loadLogs();

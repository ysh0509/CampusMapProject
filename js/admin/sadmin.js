import { protectPage } from '/js/admin/common/adminRouterGuard.js';
import { initAdminHeader } from '/js/admin/common/adminHeader.js';
import { supabase } from '/js/admin/common/adminApi.js';

// 1. 초기화 및 보안 체크
const currentUser = await protectPage();
if (!currentUser) throw new Error('Unauthorized');

initAdminHeader('privilege');

// 2. DOM 요소 참조
const navItems = document.querySelectorAll('.nav-item');
const sections = document.querySelectorAll('.admin-section');
const adminTableBody = document.getElementById('admin-table-body');
const logTableBody = document.getElementById('log-table-body');
const totalAdminsEl = document.getElementById('total-admins');
const totalLogsEl = document.getElementById('total-logs');

// 필터 요소
const filterAction = document.getElementById('filter-action');
const filterDate = document.getElementById('filter-date');
const btnFilterApply = document.getElementById('btn-filter-apply');
const btnFilterReset = document.getElementById('btn-filter-reset');

// 3. SPA 네비게이션 로직
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const targetId = item.getAttribute('data-target');

    navItems.forEach(nav => nav.classList.remove('active'));
    item.classList.add('active');

    sections.forEach(sec => {
      sec.classList.remove('active');
      if (sec.id === targetId) sec.classList.add('active');
    });

    if (targetId === 'admin-management') loadAdmins();
    if (targetId === 'admin-logs') loadLogs();
  });
});

// 4. 데이터 핸들러

/**
 * 관리자 목록 로드
 */
async function loadAdmins() {
  const { data, error } = await supabase
    .from('admin_users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return console.error(error);

  if (totalAdminsEl) totalAdminsEl.textContent = data.length;
  adminTableBody.innerHTML = '';

  data.forEach(admin => {
    const tr = document.createElement('tr');
    const badgeClass = admin.role === 'superadmin' ? 'badge-superadmin' : 'badge-admin';
    const isActive = admin.is_active;
    
    // 디자인 개선된 상태 버튼 설정
    const statusBtnClass = isActive ? 'btn-status-active' : 'btn-status-block';
    const statusIcon = isActive ? 'fa-check-circle' : 'fa-ban';
    const statusLabel = isActive ? 'Active' : 'Block';

    tr.innerHTML = `
      <td class="email-cell">${admin.email}</td>
      <td><span class="badge ${badgeClass}">${admin.role}</span></td>
      <td class="date-cell">${new Date(admin.created_at).toLocaleString()}</td>
      <td style="text-align: right;">
        <div class="mgmt-row">
          <button class="toggle-status-btn ${statusBtnClass}" data-id="${admin.id}" data-active="${admin.is_active}">
            <i class="fas ${statusIcon}"></i> <span>${statusLabel}</span>
          </button>
          <select class="role-select" data-id="${admin.id}">
            <option value="admin" ${admin.role === 'admin' ? 'selected' : ''}>admin</option>
            <option value="superadmin" ${admin.role === 'superadmin' ? 'selected' : ''}>superadmin</option>
          </select>
          <button class="delete-btn" data-id="${admin.id}"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    `;
    adminTableBody.appendChild(tr);
  });

  bindRoleEvents();
  bindDeleteEvents();
  bindStatusEvents();
}

/**
 * 시스템 로그 로드 (필터 적용)
 */
async function loadLogs() {
  let query = supabase.from('admin_logs').select('*').order('created_at', { ascending: false });

  const action = filterAction.value;
  if (action !== 'ALL') query = query.eq('action', action);

  const dateVal = filterDate.value;
  if (dateVal) {
    const startOfDay = new Date(dateVal).toISOString().split('T')[0] + 'T00:00:00Z';
    const endOfDay = new Date(dateVal).toISOString().split('T')[0] + 'T23:59:59Z';
    query = query.gte('created_at', startOfDay).lte('created_at', endOfDay);
  }

  const { data, error } = await query.limit(100);
  if (error) return console.error(error);

  if (totalLogsEl) totalLogsEl.textContent = data.length;
  logTableBody.innerHTML = '';

  data.forEach(log => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="log-id">#${log.id}</td>
      <td><span class="badge log-action">${log.action}</span></td>
      <td>${log.description ?? '-'}</td>
      <td class="date-cell">${new Date(log.created_at).toLocaleString()}</td>
    `;
    logTableBody.appendChild(tr);
  });
}

// 5. 이벤트 바인딩

function bindStatusEvents() {
  document.querySelectorAll('.toggle-status-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const currentStatus = e.currentTarget.dataset.active === 'true';
      const newStatus = !currentStatus;

      if (!confirm(`${currentStatus ? '비활성화' : '활성화'} 하시겠습니까?`)) return;

      const { error } = await supabase.from('admin_users').update({ is_active: newStatus }).eq('id', id);
      if (error) return alert('변경 실패');

      await supabase.from('admin_logs').insert({
        admin_id: currentUser.id,
        action: 'STATUS_CHANGE',
        target_type: 'admin_users',
        description: `계정 상태 변경: ${newStatus ? 'Active' : 'Block'}`
      });

      loadAdmins();
      loadLogs();
    });
  });
}

function bindRoleEvents() {
  document.querySelectorAll('.role-select').forEach(select => {
    select.addEventListener('change', async e => {
      const id = e.target.dataset.id;
      const role = e.target.value;
      const { error } = await supabase.from('admin_users').update({ role }).eq('id', id);
      if (error) return alert('권한 변경 실패');
      await supabase.from('admin_logs').insert({ admin_id: currentUser.id, action: 'ROLE_CHANGE', target_type: 'admin_users', description: `권한 변경 → ${role}` });
      loadAdmins();
      loadLogs();
    });
  });
}

function bindDeleteEvents() {
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = e.target.dataset.id;
      if (!confirm('정말 삭제하시겠습니까?')) return;
      const { error } = await supabase.from('admin_users').delete().eq('id', id);
      if (error) return alert('삭제 실패');
      await supabase.from('admin_logs').insert({ admin_id: currentUser.id, action: 'DELETE_ADMIN', target_type: 'admin_users', description: `관리자 계정 삭제` });
      loadAdmins();
      loadLogs();
    });
  });
}

// 필터 이벤트
btnFilterApply.addEventListener('click', loadLogs);
btnFilterReset.addEventListener('click', () => {
  filterAction.value = 'ALL';
  filterDate.value = '';
  loadLogs();
});

// 신규 생성
document.getElementById('create-admin-btn').addEventListener('click', async () => {
  const email = document.getElementById('new-email').value;
  const password = document.getElementById('new-password').value;
  const role = document.getElementById('new-role').value;
  if (!email || !password) return alert('입력 필요');

  const btn = document.getElementById('create-admin-btn');
  btn.disabled = true;
  try {
    const { data, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError) throw authError;
    const { error: insertError } = await supabase.from('admin_users').insert({ id: data.user.id, email, role, is_active: true });
    if (insertError) throw insertError;
    await supabase.from('admin_logs').insert({ admin_id: currentUser.id, action: 'CREATE_ADMIN', target_type: 'admin_users', description: `신규 관리자 생성 (${email})` });
    alert('생성 완료');
    document.getElementById('new-email').value = '';
    document.getElementById('new-password').value = '';
    loadAdmins();
  } catch (e) { alert(e.message); }
  finally { btn.disabled = false; }
});

// 초기 실행
loadAdmins();
loadLogs();

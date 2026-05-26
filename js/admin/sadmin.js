
import { supabase } from './common/adminApi.js';
import { protectPage } from './common/adminRouterGuard.js';

await protectPage();

// 현재 로그인 유저
const {
  data: { user }
} = await supabase.auth.getUser();

// superadmin 확인
const { data: me, error: meError } = await supabase
  .from('admin_users')
  .select('role')
  .eq('id', user.id)
  .single();

if (meError || me.role !== 'superadmin') {
  alert('접근 권한 없음');
  location.href = '/';
  throw new Error('Unauthorized');
}

const adminTableBody = document.getElementById('admin-table-body');
const logTableBody = document.getElementById('log-table-body');

// 관리자 목록 로드
async function loadAdmins() {
  const { data, error } = await supabase
    .from('admin_users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  adminTableBody.innerHTML = '';

  data.forEach(admin => {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${admin.email}</td>

      <td>
        <select class="role-select" data-id="${admin.id}">
          <option value="admin" ${admin.role === 'admin' ? 'selected' : ''}>admin</option>
          <option value="superadmin" ${admin.role === 'superadmin' ? 'selected' : ''}>superadmin</option>
        </select>
      </td>

      <td>${new Date(admin.created_at).toLocaleString()}</td>

      <td>
        <button class="delete-btn danger" data-id="${admin.id}">
          삭제
        </button>
      </td>
    `;

    adminTableBody.appendChild(tr);
  });

  bindRoleEvents();
  bindDeleteEvents();
}

// 로그 로드
async function loadLogs() {
  const { data, error } = await supabase
    .from('admin_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error(error);
    return;
  }

  logTableBody.innerHTML = '';

  data.forEach(log => {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${log.id}</td>
      <td>${log.action}</td>
      <td>${log.description ?? '-'}</td>
      <td>${new Date(log.created_at).toLocaleString()}</td>
    `;

    logTableBody.appendChild(tr);
  });
}

// 권한 변경 이벤트
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
        console.error(error);
        alert('권한 변경 실패');
        return;
      }

      // 로그 기록
      await supabase
        .from('admin_logs')
        .insert({
          admin_id: user.id,
          action: 'ROLE_CHANGE',
          target_type: 'admin_users',
          description: `권한 변경 → ${role}`,
          after_data: { role }
        });

      alert('권한 변경 완료');
      loadLogs();
    });
  });
}

// 삭제 이벤트
function bindDeleteEvents() {
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const id = e.target.dataset.id;

      const ok = confirm('정말 삭제하시겠습니까?');
      if (!ok) return;

      const { error } = await supabase
        .from('admin_users')
        .delete()
        .eq('id', id);

      if (error) {
        console.error(error);
        alert('삭제 실패');
        return;
      }

      // 로그 기록
      await supabase
        .from('admin_logs')
        .insert({
          admin_id: user.id,
          action: 'DELETE_ADMIN',
          target_type: 'admin_users',
          description: `관리자 삭제 ${id}`
        });

      alert('삭제 완료');

      loadAdmins();
      loadLogs();
    });
  });
}

// 관리자 생성
document.getElementById('create-admin-btn').addEventListener('click', async () => {
  const email = document.getElementById('new-email').value;
  const password = document.getElementById('new-password').value;
  const role = document.getElementById('new-role').value;

  if (!email || !password) {
    alert('입력값 확인');
    return;
  }

  // auth 생성
  const { data, error } = await supabase.auth.signUp({
    email,
    password
  });

  if (error) {
    console.error(error);
    alert('회원 생성 실패');
    return;
  }

  const newUser = data.user;

  if (!newUser) {
    alert('유저 생성 실패');
    return;
  }

  // admin_users 등록
  const { error: insertError } = await supabase
    .from('admin_users')
    .insert({
      id: newUser.id,
      email: newUser.email,
      role
    });

  if (insertError) {
    console.error(insertError);
    alert('admin_users 등록 실패');
    return;
  }

  // 로그 기록
  await supabase
    .from('admin_logs')
    .insert({
      admin_id: user.id,
      action: 'CREATE_ADMIN',
      target_type: 'admin_users',
      description: `관리자 생성 ${email}`,
      after_data: {
        email,
        role
      }
    });

  alert('관리자 생성 완료');

  loadAdmins();
  loadLogs();
});

loadAdmins();
loadLogs();

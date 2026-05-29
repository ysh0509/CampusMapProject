import { supabase } from './adminApi.js';

export function initAdminHeader(active = '') {
  const style = document.createElement('style');
  style.innerHTML = `
  :root {
    --admin-bg: rgba(30, 41, 59, 0.8);
    --admin-border: rgba(255, 255, 255, 0.1);
    --admin-accent: #3b82f6;
    --admin-text: #f8fafc;
    --admin-text-dim: #94a3b8;
    --admin-danger: #ef4444;
  }

  #admin-header {
    position: sticky;
    top: 0;
    z-index: 2000;
    background: var(--admin-bg);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--admin-border);
  }

  .admin-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 24px;
    height: 64px;
    font-family: 'Pretendard', sans-serif;
  }

  .admin-left {
    display: flex;
    align-items: center;
    gap: 32px;
  }

  .logo {
    font-weight: 800;
    font-size: 16px;
    letter-spacing: -0.5px;
    color: var(--admin-text);
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer; /* 클릭 가능함을 표시 */
    transition: opacity 0.2s;
  }

  .logo:hover {
    opacity: 0.8;
  }

  .logo i { color: var(--admin-accent); }

  .nav {
    display: flex;
    gap: 4px;
  }

  .nav button {
    border: none;
    background: transparent;
    color: var(--admin-text-dim);
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .nav button:hover {
    color: var(--admin-text);
    background: rgba(255, 255, 255, 0.05);
  }

  .nav button.active {
    background: rgba(59, 130, 246, 0.15);
    color: var(--admin-accent);
  }

  .logout-group {
    display: flex;
    align-items: center;
  }

  .logout {
    background: rgba(239, 68, 68, 0.1);
    color: var(--admin-danger);
    border: 1px solid rgba(239, 68, 68, 0.2);
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .logout:hover {
    background: var(--admin-danger);
    color: white;
  }

  /* 레이아웃 보정 */
  #admin-content {
    position: relative;
    z-index: 1;
  }

  /* 모바일/태블릿 대응 */
  @media (max-width: 1024px) {
    .admin-header { height: auto; padding: 12px 20px; flex-direction: column; gap: 16px; }
    .admin-left { flex-direction: column; gap: 12px; width: 100%; }
    .nav { justify-content: center; width: 100%; overflow-x: auto; padding-bottom: 4px; }
    .nav button { white-space: nowrap; }
  }
  `;
  document.head.appendChild(style);

  const header = document.createElement('div');
  header.className = 'admin-header';

  header.innerHTML = `
    <div class="admin-left">
      <div class="logo"><i class="fas fa-shield-halved"></i> SUPER ADMIN</div>
      <div class="nav">
        <button data-page="dashboard"><i class="fas fa-chart-line"></i> Dashboard</button>
        <button data-page="vision"><i class="fas fa-video"></i> Vision</button>
        <button data-page="outdoor"><i class="fas fa-map-marked-alt"></i> Outdoor</button>
        <button data-page="indoor"><i class="fas fa-building"></i> Indoor</button>
        <button data-page="elevation"><i class="fas fa-mountain"></i> Elevation</button>
        <button data-page="occupancy"><i class="fas fa-users"></i> Occupancy</button>
        <button data-page="gate"><i class="fas fa-exchange-alt"></i> Transfer</button>
        <button data-page="vision2NE"><i class="fas fa-link"></i> Camera Map</button>
      </div>
    </div>
    <div class="logout-group">
      <button id="logout-btn" class="logout">
        <i class="fas fa-sign-out-alt"></i> Logout
      </button>
    </div>
  `;

  const mount = document.getElementById('admin-header');
  if (!mount) return;
  mount.innerHTML = '';
  mount.appendChild(header);

  const base = '/html/admin';
  const routes = {
    main: '/index.html', // 메인 페이지 경로 추가
    dashboard: `${base}/admin_dashboard.html`,
    vision: `${base}/admin_vision_control.html`,
    outdoor: `${base}/outdoor/admin_outdoor_map.html`,
    indoor: `${base}/indoor/admin_indoor.html`,
    elevation: `${base}/outdoor/admin_elevation_editor.html`,
    vision2NE: `${base}/admin_camera_map.html`,
    occupancy: `${base}/admin_occupancy.html`,
    gate: `${base}/indoor/transfer_edges.html`
  };

  // 로고 클릭 시 메인 페이지로 이동
  const logo = header.querySelector('.logo');
  if (logo) {
    logo.onclick = () => {
      location.href = routes.main;
    };
  }

  header.querySelectorAll('[data-page]').forEach(btn => {
    btn.onclick = () => {
      const page = btn.dataset.page;
      if (routes[page]) location.href = routes[page];
    };
  });

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      if(confirm('로그아웃 하시겠습니까?')) {
        await supabase.auth.signOut();
        location.href = '/html/admin/admin_login.html';
      }
    };
  }

  if (active) {
    const btn = header.querySelector(`[data-page="${active}"]`);
    if (btn) btn.classList.add('active');
  }
}

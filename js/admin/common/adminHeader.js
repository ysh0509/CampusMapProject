import { supabase } from './adminApi.js';

export async function initAdminHeader(active = '') {
  // =========================================================
  // 사용자 및 권한 조회
  // =========================================================
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    location.href = '/html/admin/admin_login.html';
    return;
  }

  let userRole = 'admin';

  const { data: adminInfo, error: adminError } = await supabase
    .from('admin_users')
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (adminError || !adminInfo) {
    console.error('관리자 정보 조회 실패:', adminError);

    await supabase.auth.signOut();
    alert('관리자 권한이 없습니다.');
    location.href = '/html/admin/admin_login.html';
    return;
  }

  if (!adminInfo.is_active) {
    await supabase.auth.signOut();
    alert('비활성화된 계정입니다.');
    location.href = '/html/admin/admin_login.html';
    return;
  }

  userRole = adminInfo.role || 'admin';

  const isSuperAdmin = userRole === 'superadmin';
  const displayTitle = isSuperAdmin ? 'SUPER ADMIN' : 'ADMIN';

  // =========================================================
  // 스타일
  // =========================================================
  const styleId = 'admin-header-style';

  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;

    style.innerHTML = `
    :root {
      --admin-bg: rgba(11, 18, 32, 0.76);
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
      padding: 8px 24px;
      height: 64px;
      font-family: 'Pretendard', sans-serif;
    }

    .admin-left {
      display: flex;
      align-items: center;
      gap: 24px;
      min-width: 0;
      flex: 1;
    }

    .logo {
      font-weight: 800;
      font-size: 16px;
      letter-spacing: -0.5px;
      color: var(--admin-text);
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      transition: opacity 0.2s;
      flex: 0 0 auto;
    }

    .logo:hover {
      opacity: 0.8;
    }

    .logo i {
      color: var(--admin-accent);
    }

    .nav {
      display: flex;
      gap: 4px;
      min-width: 0;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .nav::-webkit-scrollbar {
      display: none;
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
      border: 1px solid rgba(59, 130, 246, 0.25);
      background: rgba(59, 130, 246, 0.16);
      color: #bfdbfe;
    }

    .logout-group {
      display: flex;
      align-items: center;
      flex: 0 0 auto;
      margin-left: 8px;
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

    @media (max-width: 1024px) {
      .admin-header {
        height: auto;
        padding: 12px 20px;
        flex-direction: column;
        gap: 16px;
      }

      .admin-left {
        flex-direction: column;
        gap: 12px;
        width: 100%;
      }

      .nav {
        justify-content: center;
        width: 100%;
        overflow-x: auto;
        padding-bottom: 4px;
      }

      .nav button {
        white-space: nowrap;
      }
    }
    `;

    document.head.appendChild(style);
  }

  // =========================================================
  // 헤더 생성
  // =========================================================
  const header = document.createElement('div');
  header.className = 'admin-header';

  let navButtons = `
    <button data-page="dashboard"><i class="fas fa-chart-line"></i> Dashboard</button>
    <button data-page="vision"><i class="fas fa-video"></i> Vision</button>
    <button data-page="hardware"><i class="fas fa-microchip"></i> Hardware</button>
  `;

  if (isSuperAdmin) {
    navButtons += `
      <button data-page="privilege" style="color: var(--admin-accent); font-weight:700;">
        <i class="fas fa-user-shield"></i> Privilege
      </button>
    `;
  }

  navButtons += `
    <button data-page="outdoor"><i class="fas fa-map-marked-alt"></i> Outdoor</button>
    <button data-page="indoor"><i class="fas fa-building"></i> Indoor</button>
    <button data-page="indoorScan"><i class="fas fa-cubes"></i> Indoor Scan</button>
    <button data-page="elevation"><i class="fas fa-mountain"></i> Elevation</button>
    <button data-page="occupancy"><i class="fas fa-users"></i> Occupancy</button>
    <button data-page="spatial"><i class="fas fa-vector-square"></i> Spatial 2D</button>
    <button data-page="gate"><i class="fas fa-exchange-alt"></i> Transfer</button>
    <button data-page="vision2NE"><i class="fas fa-link"></i> Camera Map</button>
    <button data-page="firmware"><i class="fas fa-microchip"></i> Firmware</button>
  `;

  header.innerHTML = `
    <div class="admin-left">
      <div class="logo">
        <i class="fas fa-shield-halved"></i>
        ${displayTitle}
      </div>

      <div class="nav">
        ${navButtons}
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

  // =========================================================
  // 라우팅
  // =========================================================
  const base = '/html/admin';

  const routes = {
    main: '/index.html',
    dashboard: `${base}/admin_dashboard.html`,
    vision: `${base}/admin_vision_control.html`,
    hardware: `${base}/admin_hardware_mgmt.html`,
    privilege: `${base}/sadmin.html`,
    outdoor: `${base}/outdoor/admin_outdoor_map.html`,
    indoor: `${base}/indoor/admin_indoor.html`,
    indoorScan: `${base}/indoor/admin_indoor_reconstruction.html`,
    elevation: `${base}/outdoor/admin_elevation_editor.html`,
    occupancy: `${base}/admin_occupancy.html`,
    spatial: `${base}/admin_spatial_analysis.html`,
    gate: `${base}/indoor/transfer_edges.html`,
    vision2NE: `${base}/admin_camera_map.html`,
    firmware: `${base}/admin_firmwareupdate.html`
  };

  // =========================================================
  // 이벤트
  // =========================================================

  const logo = header.querySelector('.logo');

  if (logo) {
    logo.onclick = () => {
      location.href = routes.main;
    };
  }

  header.querySelectorAll('[data-page]').forEach(btn => {
    btn.onclick = () => {
      const page = btn.dataset.page;

      if (routes[page]) {
        location.href = routes[page];
      }
    };
  });

  const logoutBtn = document.getElementById('logout-btn');

  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      if (!confirm('로그아웃 하시겠습니까?')) return;

      await supabase.auth.signOut();
      location.href = '/html/admin/admin_login.html';
    };
  }

  // =========================================================
  // 활성 메뉴 표시
  // =========================================================
  if (active) {
    const btn = header.querySelector(`[data-page="${active}"]`);

    if (btn) {
      btn.classList.add('active');
    }
  }
}

import { supabase } from './adminApi.js';

export function initAdminHeader(active = '') {
  const style = document.createElement('style');
  style.innerHTML = `
  #admin-header {
    position: sticky;
    top: 0;
    z-index: 2000;
    background: #ffffff;
  }

  .admin-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 18px;
    border-bottom: 1px solid #e5e7eb;
    font-family: Arial, sans-serif;
  }

  .admin-left {
    display: flex;
    align-items: center;
    gap: 18px;
  }

  .logo {
    font-weight: 800;
    font-size: 14px;
    color: #111827;
  }

  .nav {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .nav button {
    border: 1px solid #e5e7eb;
    background: #f9fafb;
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 12px;
    cursor: pointer;
  }

  .nav button.active {
    background: #111827;
    color: white;
  }

  .logout {
    background: #ef4444;
    color: white;
    border: none;
    padding: 6px 12px;
    border-radius: 8px;
    cursor: pointer;
  }

  #admin-content {
    position: relative;
    z-index: 1;
  }

  .leaflet-pane,
  .leaflet-top,
  .leaflet-control {
    z-index: 500 !important;
  }

  .leaflet-tooltip {
    z-index: 600 !important;
  }

  #map {
    height: calc(100vh - 60px);
  }
  `;
  document.head.appendChild(style);

  const header = document.createElement('div');
  header.className = 'admin-header';

  header.innerHTML = `
    <div class="admin-left">
      <div class="logo">ADMIN</div>
      <div class="nav">
        <button data-page="dashboard">Dashboard</button>
        <button data-page="vision">Vision Control</button>
        <button data-page="outdoor">Outdoor</button>
        <button data-page="indoor">Indoor</button>
        <button data-page="elevation">Elevation</button>
        <button data-page="vision2NE">Vision</button>
        <button data-page="occupancy">Occupancy</button>
        <button data-page="gate">Transfer</button>
      </div>
    </div>
    <button id="logout-btn" class="logout">Logout</button>
  `;

  const mount = document.getElementById('admin-header');
  if (!mount) return;
  mount.innerHTML = '';
  mount.appendChild(header);

  const base = '/html/admin';
  const routes = {
    dashboard: `${base}/admin_dashboard.html`,
    vision: `${base}/admin_vision_control.html`,
    outdoor: `${base}/outdoor/admin_outdoor_map.html`,
    indoor: `${base}/indoor/admin_indoor.html`,
    elevation: `${base}/outdoor/admin_elevation_editor.html`,
    vision2NE: `${base}/admin_camera_map.html`,
    occupancy: `${base}/admin_occupancy.html`,
    gate: `${base}/indoor/transfer_edges.html`
  };

  header.querySelectorAll('[data-page]').forEach(btn => {
    btn.onclick = () => {
      const page = btn.dataset.page;
      if (routes[page]) location.href = routes[page];
    };
  });

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await supabase.auth.signOut();
      location.href = '/html/admin/admin_login.html';
    };
  }

  if (active) {
    const btn = header.querySelector(`[data-page="${active}"]`);
    if (btn) btn.classList.add('active');
  }
}

import { protectPage } from './common/adminRouterGuard.js';
import { initAdminHeader } from './common/adminHeader.js';
import { supabase } from './common/adminApi.js';

await protectPage();
initAdminHeader('nodes');

const list = document.getElementById('node-list');

async function loadNodes() {

  const { data } = await supabase
    .from('outdoor_nodes')
    .select('*')
    .order('id');

  render(data);
}

// =========================
// RENDER
// =========================
function render(data) {

  list.innerHTML = '';

  data.forEach(n => {

    const div = document.createElement('div');
    div.className = 'card';

    div.innerHTML = `
      <div><b>${n.name}</b></div>
      <div>ID: ${n.id}</div>
      <div>(${n.lat.toFixed(5)}, ${n.lng.toFixed(5)})</div>

      <button class="edit">수정</button>
      <button class="delete">삭제</button>
    `;

    // DELETE
    div.querySelector('.delete').onclick = async () => {
      await supabase.from('outdoor_nodes').delete().eq('id', n.id);
    };

    // UPDATE
    div.querySelector('.edit').onclick = async () => {

      const name = prompt('이름 수정', n.name);
      if (!name) return;

      const lat = parseFloat(prompt('lat', n.lat));
      const lng = parseFloat(prompt('lng', n.lng));

      await supabase
        .from('outdoor_nodes')
        .update({ name, lat, lng })
        .eq('id', n.id);
    };

    list.appendChild(div);
  });
}

// =========================
// INITIAL LOAD
// =========================
loadNodes();

// =========================
// REALTIME
// =========================
supabase
  .channel('nodes-changes')
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'outdoor_nodes'
    },
    () => {
      loadNodes();
    }
  )
  .subscribe();
import { protectPage } from './common/adminRouterGuard.js';
import { initAdminHeader } from './common/adminHeader.js';
import { supabase } from './common/adminApi.js';

await protectPage();
initAdminHeader('edges');

const list = document.getElementById('edge-list');

async function loadEdges() {

  const { data } = await supabase
    .from('outdoor_edges')
    .select('*')
    .order('id');

  render(data);
}

// =========================
// RENDER
// =========================
function render(data) {

  list.innerHTML = '';

  data.forEach(e => {

    const div = document.createElement('div');
    div.className = 'card';

    div.innerHTML = `
      <div><b>${e.name}</b></div>
      <div>거리: ${e.distance?.toFixed(1)}m</div>
      <div>방향: ${e.direction}</div>

      <button class="edit">수정</button>
      <button class="delete">삭제</button>
    `;

    // DELETE
    div.querySelector('.delete').onclick = async () => {
      await supabase.from('outdoor_edges').delete().eq('id', e.id);
    };

    // UPDATE
    div.querySelector('.edit').onclick = async () => {

      const name = prompt('이름', e.name);
      const direction = prompt('방향 (bidirectional / one-way)', e.direction);
      const distance = parseFloat(prompt('거리', e.distance));

      await supabase
        .from('outdoor_edges')
        .update({
          name,
          direction,
          distance
        })
        .eq('id', e.id);
    };

    list.appendChild(div);
  });
}

// =========================
// LOAD
// =========================
loadEdges();

// =========================
// REALTIME
// =========================
supabase
  .channel('edges-changes')
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'outdoor_edges'
    },
    () => {
      loadEdges();
    }
  )
  .subscribe();
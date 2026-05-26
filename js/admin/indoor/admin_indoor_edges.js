import { protectPage } from '../common/adminRouterGuard.js';
import { initAdminHeader } from '../common/adminHeader.js';
import {
  getIndoorEdges,
  createIndoorEdge,
  deleteIndoorEdge
} from './indoorEdgeManager.js';
import { logAction } from '../common/adminLogger.js';

async function loadEdges() {
  await protectPage();
  initAdminHeader();

  const { data } = await getIndoorEdges();

  const list = document.getElementById('edge-list');
  list.innerHTML = '';

  data.forEach(edge => {
    const li = document.createElement('li');
    li.innerText = `${edge.from_node} → ${edge.to_node}`;

    li.onclick = async () => {
      const { error } = await deleteIndoorEdge(edge.id);
      if (!error) {
        // ✅ 엣지 삭제 로그
        await logAction({
          action: 'delete',
          target_type: 'indoor_edge',
          target_id: edge.id,
          description: '실내 엣지 삭제',
          before: edge
        });
      }
      loadEdges();
    };
    list.appendChild(li);
  });
}

// ============================
// 생성
// ============================

async function handleCreate() {
  const from = parseInt(document.getElementById('from').value);
  const to = parseInt(document.getElementById('to').value);

  const { data, error } = await createIndoorEdge({ from_node: from, to_node: to });

  if (!error && data) {
    // ✅ 엣지 생성 로그
    await logAction({
      action: 'create',
      target_type: 'indoor_edge',
      target_id: data.id,
      description: `실내 엣지 생성 (${from} $\rightarrow$ ${to})`,
      after: data
    });
    loadEdges();
  }
}

document.getElementById('create-btn').onclick = handleCreate;

loadEdges();
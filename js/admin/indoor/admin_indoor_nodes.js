import { protectPage } from '../common/adminRouterGuard.js';
import { initAdminHeader } from '../common/adminHeader.js';
import {
  getIndoorNodes,
  createIndoorNode,
  deleteIndoorNode
} from './indoorNodeManager.js';
import { logAction } from '../common/adminLogger.js';


async function loadNodes() {
  await protectPage();
  initAdminHeader();

  const { data } = await getIndoorNodes();

  const list = document.getElementById('node-list');
  list.innerHTML = '';

  data.forEach(node => {
    const li = document.createElement('li');
    li.innerText = `[B:${node.building_id} F:${node.floor_id}] ${node.id} - ${node.name}`;

    li.onclick = async () => {
      const { error } = await deleteIndoorNode(node.id);
      if (!error) {
        // ✅ 노드 삭제 로그
        await logAction({
          action: 'delete',
          target_type: 'indoor_node',
          target_id: node.id,
          description: `실내 노드 삭제: ${node.name}`,
          before: node
        });
      }
      loadNodes();
    };
    list.appendChild(li);
  });
}

// ============================
// 생성
// ============================

async function handleCreate() {
  const name = document.getElementById('name').value;
  const building_id = parseInt(document.getElementById('building_id').value);
  const floor_id = parseInt(document.getElementById('floor_id').value);
  const x = parseFloat(document.getElementById('x').value);
  const y = parseFloat(document.getElementById('y').value);

  const { data, error } = await createIndoorNode({ name, building_id, floor_id, x, y });

  if (!error && data) {
    // ✅ 노드 생성 로그
    await logAction({
      action: 'create',
      target_type: 'indoor_node',
      target_id: data.id,
      description: `실내 노드 생성: ${name}`,
      after: data
    });
    loadNodes();
  }
}

document.getElementById('create-btn').onclick = handleCreate;

loadNodes();
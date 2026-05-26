import { protectPage } from '../common/adminRouterGuard.js';
import { initAdminHeader } from '../common/adminHeader.js';
import {
  getOutdoorEdges,
  createOutdoorEdge,
  deleteOutdoorEdge
} from './outdoorEdgeManager.js';
import { logAction } from '../common/adminLogger.js';


async function loadEdges() {
  await protectPage();
  initAdminHeader();

  const { data } = await getOutdoorEdges();

  const list = document.getElementById('edge-list');
  list.innerHTML = '';

  data.forEach(edge => {
    const li = document.createElement('li');
    li.innerText = `${edge.from_node} → ${edge.to_node}`;

    li.onclick = async () => {
      const { error } = await deleteOutdoorEdge(edge.id);

      if (!error) {
        // ✅ 삭제 로그 기록
        await logAction({
          action: 'delete',
          target_type: 'outdoor_edge',
          target_id: edge.id,
          description: '외부 엣지 삭제',
          before: edge
        });
      }
      loadEdges();
    };

    list.appendChild(li);
  });
}

async function handleCreate() {
  const from = parseInt(document.getElementById('from').value);
  const to = parseInt(document.getElementById('to').value);

  const direction = document.getElementById('direction').value;
  const elevation = parseFloat(document.getElementById('elevation').value);
  const slope = parseFloat(document.getElementById('slope').value);

  // 최소 안전 처리
  if (from === to) {
    alert('같은 노드 연결 불가');
    return;
  }

  await createOutdoorEdge({
    from_node: from,
    to_node: to,

    direction: direction || 'bidirectional',

    elevation_diff: elevation || 0,

    slope_forward: slope || 0,
    slope_backward: -(slope || 0),

    distance: null,         // 수동 입력이라 계산 불가
    path_points: []         // 없음
  });

  await logAction({
  action: 'create',
  target_type: 'edge',
  target_id: edge.id,
  description: '외부 엣지 생성',
  after: edge
  });

  loadEdges();
}

document.getElementById('create-btn').onclick = handleCreate;

loadEdges();
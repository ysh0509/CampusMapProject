/**
 * graphBuilder.js 수정본
 * floors의 scale 정보를 반영하여 실내 거리(Cost)를 미터 단위로 변환합니다.
 */
export function buildUnifiedGraph({
  outdoorNodes,
  outdoorEdges,
  indoorNodes,
  indoorEdges,
  transferEdges,
  floors // <--- 추가: 층별 scale 정보를 전달받음
}) {

  const graph = new Map();

  // 층별 scale을 빠르게 찾기 위한 Map 생성 (floor_id -> scale)
  const floorScaleMap = new Map();
  floors.forEach(f => {
    // scale 칼럼이 없거나 null인 경우를 대비해 기본값 1.0 사용
    floorScaleMap.set(Number(f.id), Number(f.scale) || 1.0);
  });

  const addEdge = (from, to, cost) => {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push({ to, cost });
  };

  // =========================
  // OUTDOOR EDGES (기존과 동일)
  // =========================
  outdoorEdges.forEach(e => {
    const cost = (e.distance || 0) + Math.abs(e.elevation_diff || 0) * 2;
    addEdge(e.from_node, e.to_node, cost);
    if (e.direction === 'bidirectional') {
      addEdge(e.to_node, e.from_node, cost);
    }
  });

  // =========================
  // INDOOR EDGES (축척 반영 핵심 로직)
  // =========================
  indoorEdges.forEach(e => {
    // 1. 에지의 출발 노드 정보를 통해 해당 노드가 속한 floor_id 확인
    // (indoor_nodes 데이터를 참조해야 함 - 여기서는 e에 floor_id가 포함되어 있다고 가정하거나 
    //  e.from_node를 통해 nodeMap에서 찾아야 합니다. 
    //  가장 효율적인 방법은 indoor_edges 로드 시 floor_id를 함께 가져오는 것입니다.)
    
    const floorId = e.floor_id; 
    const scale = floorScaleMap.get(Number(floorId)) || 1.0;

    // 2. distance(픽셀 단위)에 scale을 곱하여 실제 미터(m) 단위로 변환
    // admin_indoor 수정으로 scale은 더이상 곱하지 않아도 됩니다. scale이 이미 적용된 distance가 저장되어 있다고 가정합니다.
    const realDistance = (e.distance || 0);

    // 3. 최종 비용 계산
    const cost = realDistance + (e.type === 'stairs' ? 2 : 1);

    addEdge(e.from_node, e.to_node, cost);
    addEdge(e.to_node, e.from_node, cost);
  });

  // =========================
  // TRANSFER EDGES (기존과 동일)
  // =========================
  transferEdges.forEach(t => {
    const cost = t.cost ?? 0;
    const inId = t.indoor_node_id;
    const outId = t.outdoor_node_id;

    if (t.direction === 'bidirectional') {
      addEdge(inId, outId, cost);
      addEdge(outId, inId, cost);
    }
    if (t.direction === 'outdoor_to_indoor') addEdge(outId, inId, cost);
    if (t.direction === 'indoor_to_outdoor') addEdge(inId, outId, cost);
  });

  return graph;
}

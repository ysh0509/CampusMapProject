/**
 * heuristic: A* 알고리즘의 성능을 결정하는 휴리스틱 함수.
 * 목표 지점까지의 예상 거리를 추정하여 탐색 방향을 가이드한다.
 * 
 * @param {string|number} aId - 현재 탐색 중인 노드 ID
 * @param {string|number} bId - 목표 지점(Goal) 노드 ID
 * @param {Map} nodeMap - 모든 노드 정보를 담고 있는 Map 객체
 * @returns {number} 추정 거리 (비용)
 */
function heuristic(aId, bId, nodeMap) {
  const A = nodeMap.get(Number(aId));
  const B = nodeMap.get(Number(bId));

  // 노드 정보가 없으면 계산 불가하므로 0 반환
  if (!A || !B) return 0;

  const AOutdoor = A.type === 'outdoor';
  const BOutdoor = B.type === 'outdoor';

  // [CASE 1] 실외 노드 간 이동 (Outdoor ↔ Outdoor)
  // 위경도(lat, lng) 좌표를 사용하여 실제 지구상의 거리를 추정함
  if (AOutdoor && BOutdoor) {
    if (A.lat == null || B.lat == null) return 0;

    const dx = A.lat - B.lat;
    const dy = A.lng - B.lng;

    // Math.hypot를 사용하여 피타고라스 정리로 직선 거리 계산
    // 100,000은 위경도 단위 차이를 실제 거리 스케일로 보정하기 위한 계수
    return Math.hypot(dx, dy) * 100000;
  }

  // [CASE 2] 실내 노드 간 이동 (Indoor ↔ Indoor)
  // 실내 노드는 평면 좌표(x, y)를 사용하므로 2D 유클리드 거리를 계산함
  if (!AOutdoor && !BOutdoor) {
    if (A.x == null || B.x == null) return 0;

    const dx = A.x - B.x;
    const dy = A.y - B.y;

    return Math.hypot(dx, dy);
  }

  // [CASE 3] 실내 ↔ 실외 이동 (Transfer)
  // 실내와 실외를 연결하는 구간은 'transfer_edge'를 통해 별도로 처리되므로
  // 휴리스틱 값을 0으로 설정하여 알고리즘이 연결 노드를 우선적으로 탐색하게 유도함
  return 0;
}

/**
 * COST_MODE: 경로 탐색의 목적(Mode)에 따른 엣지 가중치(Cost) 계산 로직
 */
const COST_MODE = {

  /**
   * optimal (최적 경로 모드): 
   * 거리, 경사, 이동수단, 실시간 혼잡도를 종합적으로 고려하여 '가장 효율적인' 경로를 찾음.
   */
  optimal: function(e) {
    let d = e.distance || 1;           // 기본 이동 거리
    const elev = e.elevation_diff ?? 0; // 고도 차이
    const slope = elev / d;            // 경사도 계산

    let cost = d; // 초기 비용은 거리로 설정

    // 1. 경사도 반영: 오르막(slope > 0)은 3배, 내리막은 1.2배의 가중치를 부여하여 편한 길 유도
    if (slope > 0) cost *= (1 + slope * 3);
    else if (slope < 0) cost *= (1 + slope * 1.2);

    // 2. 이동 수단 반영: 계단(stairs)은 이동 효율이 낮으므로 비용을 2배로 증가
    if (e.edgeType === 'stairs') cost *= 2;

    // 3. 실시간 혼잡도 반영: 혼잡도 데이터가 존재할 경우 비용을 비례하여 증가 (가장 핵심)
    if (e.congestion != null) {
      cost *= (1 + e.congestion); 
    }

    return cost;
  },

  /**
   * fastest (최단 시간 모드): 
   * 물리적인 시간(초 단위)을 계산하여 가장 '빨리 도착하는' 경로를 찾음.
   */
  fastest: function(e) {
    // 지하철(subway)은 이동 거리에 상관없이 고정 시간(6분 = 360초)을 비용으로 처리
    if (e.edgeType === 'subway') return 6 * 60;

    let d = e.distance || 1;
    const elev = e.elevation_diff ?? 0;
    const slope = elev / d;

    // 기본 보행 속도 설정 (1.4 m/s)
    let speed = 1.4;

    // 1. 경사도에 따른 속도 저하 반영
    if (slope > 0) speed *= (1 - slope * 0.7); // 오르막은 속도 급감
    else if (slope < 0) speed *= (1 - slope * 0.3); // 내리막은 약간의 속도 변화
    if (speed < 0.5) speed = 0.5; // 최소 속도 제한 (안전장치)

    // 2. 기초 소요 시간 계산 (시간 = 거리 / 속도)
    let t = d / speed; 

    // 3. 이동 수단 및 혼잡도 가중치 적용
    if (e.edgeType === 'stairs') t *= 1.8; // 계단은 시간 소모가 큼
    if (e.congestion != null) {
      // 혼잡도가 높을수록 소요 시간을 최대 1.5배까지 증가시켜 시간 기반 우회 유도
      t *= (1 + e.congestion * 1.5);
    }

    return t;
  },

  /**
   * stairs_avoid (계단 회피 모드):
   * 계단이나 에스컬레이터를 이용하지 않는 경로를 최우선으로 탐색함.
   */
  stairs_avoid: function(e) {
    // 계단이나 에스컬레이터인 경우 비용을 무한대(Infinity)로 설정하여 탐색 대상에서 제외
    if (e.edgeType === 'stairs' || e.edgeType === 'escalator') return Infinity;
    // 그 외에는 최단 시간 모드와 동일한 로직 적용
    return COST_MODE.fastest(e);
  }
};

/**
 * findPath: A* 알고즘을 이용한 최적 경로 탐색 메인 함수
 * 
 * @param {Object} graphObj - 그래프 데이터(nodeMap, edgeMap 포함)
 * @param {string|number} start - 출발 노드 ID
 * @param {string|number} goal - 목적지 노드 ID
 * @param {string} mode - 탐색 모드 (optimal, fastest, stairs_avoid)
 * @returns {Array} 찾은 경로의 노드 ID 리스트 (실패 시 빈 배열)
 */
export function findPath(graphObj, start, goal, mode) {
  // 예외 처리: 그래프 정보나 시작/목표 지점이 없으면 즉시 종료
  if (!graphObj || !graphObj.graph) return [];
  if (!start || !goal) return [];

  const graph = graphObj.graph;
  const nodeMap = graphObj.nodeMap;
  const costFn = COST_MODE[mode] || COST_MODE.optimal; // 모드에 맞는 가중치 함수 선택

  // A* 알고즘을 위한 자료구조 초기화
  const open = new Set([start]);   // 현재 탐색 가능성이 있는 후보 노드 집합
  const closed = new Set();        // 탐색이 완료된 노드 집합

  const came = new Map();          // 경로 역추적을 위해 '이전 노드'를 기록하는 Map
  const g = new Map();             // 출발지로부터 현재 노드까지의 실제 누적 비용
  const f = new Map();             // f(n) = g(n) + h(n) (현재까지 비용 + 목적지까지의 예상 비용)

  g.set(start, 0);
  f.set(start, heuristic(start, goal, nodeMap));

  let loopGuard = 0; // 무한 루프 방지를 위한 안전장치

  while (open.size > 0) {
    loopGuard++;
    if (loopGuard > 100000) break; // 과도한 연산 시 강제 종료

    // 1. Open Set에서 f(n) 값이 가장 작은(가장 유망한) 노드 선택
    let cur = null;
    open.forEach(v => {
      if (cur === null || f.get(v) < f.get(cur)) cur = v;
    });

    // 2. 목적지에 도달했다면 탐색 종료
    if (cur === goal) break;

    // 3. 현재 노드를 탐색 완료 목록(Closed Set)으로 이동
    open.delete(cur);
    closed.add(cur);

    // 4. 인접 노드(Neighbors) 탐색
    const neighbors = graph.get(cur) || [];
    for (let i = 0; i < neighbors.length; i++) {
      const nb = neighbors[i];

      // 이미 탐색이 끝난 노드는 건너뜀
      if (closed.has(nb.to)) continue;

      // 현재 엣지의 가중치(Cost) 계산
      const cost = costFn(nb.edge);
      if (cost === Infinity) continue; // 계단 회피 모드 등에서 유효하지 않은 경로 제외

      // 5. 새로운 경로를 통한 도달 비용 계산 (tentative_g_score)
      const tentative = (g.get(cur) ?? Infinity) + cost;

      // 6. 현재 알고 있는 경로보다 더 짧은 경로를 발견한 경우 업데이트
      if (tentative < (g.get(nb.to) ?? Infinity)) {
        came.set(nb.to, cur);          // 경로 기록
        g.set(nb.to, tentative);       // 실제 비용 업데이트
        f.set(nb.to, tentative + heuristic(nb.to, goal, nodeMap)); // 총 예상 비용 업데이트
        open.add(nb.to);               // 후보 노드 집합에 추가
      }
    }
  }

  // 7. 경로 역추적 (Backtracking)
  // 목적지부터 시작하여 came Map을 따라 출발지까지 거슬러 올라감
  const path = [];
  let c = goal;

  while (c !== undefined) {
    path.unshift(c); // 경로의 맨 앞에 추가
    c = came.get(c); // 이전 노드로 이동

    // 만약 목적지에 도달했는데 출발지에 연결되지 않았다면 경로가 없는 것으로 판단
    if (c === undefined && path[0] !== start) return [];
  }

  return path; // 최종 경로 반환
}

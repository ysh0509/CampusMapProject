/**
 * 휴리스틱 함수 - 두 노드 간의 예상 비용을 계산함
 * @param {*} aId 
 * @param {*} bId 
 * @param {*} nodeMap 
 * @returns 
 */


export function heuristic(aId, bId, nodeMap) {

  const A = nodeMap.get(Number(aId));
  const B = nodeMap.get(Number(bId));

  if (!A || !B) return 0;

  // indoor node는 lat/lng 없을 수 있음 → fallback
  if (A.lat == null || B.lat == null) {
    return 0;
  }

  const dx = A.lat - B.lat;
  const dy = A.lng - B.lng;

  // 거리 스케일 보정 (실사용 기준)
  return Math.sqrt(dx * dx + dy * dy) * 100000;
}
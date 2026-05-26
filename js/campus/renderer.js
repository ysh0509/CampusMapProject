function getCongestionColor(c) {
  if (c == null) return null;
  if (c < 0.3) return '#22c55e';
  if (c < 0.6) return '#eab308';
  return '#ef4444';
}

function getEdgeColor(edge) {
  const cc = getCongestionColor(edge.congestion);
  if (cc) return cc;
  if (edge.type === 'indoor') return '#f97316';
  if (edge.type === 'transfer') return '#a855f7';
  return '#2563eb';
}

function getSlopeColor(edge) {
  const slope = (edge.elevation_diff ?? 0) / (edge.distance || 1);
  if (slope >= 0.1) return '#ef4444'; // 오르막 급경사
  if (slope > 0.05) return '#f59e0b';
  if (slope < -0.1) return '#22c55e';
  return null;
}

function appendPathPoints(coords, edge, forward) {
  if (!edge.path_points || !edge.path_points.length) return;
  let pts = edge.path_points;
  if (!forward) pts = pts.slice().reverse();

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (Array.isArray(p) && p.length >= 2) {
      coords.push([Number(p[0]), Number(p[1])]);
    } else if (p && typeof p === 'object' && p.lat != null && p.lng != null) {
      coords.push([Number(p.lat), Number(p.lng)]);
    }
  }
}

export function drawPath(map, path, graphObj) {
  const nodeMap = graphObj.nodeMap;
  const edgeMap = graphObj.edgeMap;
  const lines = [];

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];

    let edge = edgeMap.get(a + '-' + b) || edgeMap.get(b + '-' + a);
    if (!edge) continue;

    const from = nodeMap.get(a);
    const to = nodeMap.get(b);
    if (!from || !to) continue;

    const coords = [];
    if (
      from.lat == null || from.lng == null ||
      to.lat == null || to.lng == null
    ) {
      continue;
    }

    coords.push([from.lat, from.lng]);

    appendPathPoints(
      coords,
      edge,
      edge.from === a || edge.to === b
    );

    coords.push([to.lat, to.lng]);

    // 좌표 검증
    if (
      coords.length < 2 ||
      coords.some(p =>
        !Array.isArray(p) ||
        p.length < 2 ||
        Number.isNaN(Number(p[0])) ||
        Number.isNaN(Number(p[1]))
      )
    ) {
      continue;
    }

    // subway는 별도 표시 (다른 엣지 가리지 않도록 투명도/대시 처리)
    if (edge.edgeType === 'subway') {
      const line = L.polyline(coords, {
        color: '#0ea5e9',
        weight: 8,
        opacity: 0.55,
        dashArray: '6,10'
      }).addTo(map);
      lines.push(line);
      continue;
    }

    // escalator는 별도 표시 (다른 엣지 가리지 않도록 투명도/대시 처리)
    if (edge.edgeType === 'escalator') {
      const line = L.polyline(coords, {
        color: '#83e90e',
        weight: 8,
        opacity: 0.55,
        dashArray: '6,10'
      }).addTo(map);
      lines.push(line);
      continue;
    }

    const slopeColor = getSlopeColor(edge);
    const color = slopeColor || getEdgeColor(edge);

    const line = L.polyline(coords, {
      color,
      weight: 6,
      opacity: 0.9,
      dashArray: edge.type === 'transfer' ? '6,6' : null
    }).addTo(map);

    if (edge.type === 'transfer') {
      L.circleMarker([to.lat, to.lng], {
        radius: 8,
        color: '#a855f7',
        fillColor: '#a855f7',
        fillOpacity: 1
      }).addTo(map);
    }

    lines.push(line);
  }

  return lines;
}


export function clearPath(map, lines) {
  for (let i = 0; i < lines.length; i++) {
    map.removeLayer(lines[i]);
  }
}

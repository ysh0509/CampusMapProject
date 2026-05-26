import { supabase } from '../admin/common/adminApi.js';

/* =========================================================
   PATH LENGTH
   path_points 기반 거리 계산
========================================================= */
function pathLength(pathPoints) {

  if (!pathPoints || !pathPoints.length) {
    return null;
  }

  // path_points 포맷 통합
  const toLL = (p) => {

    // [lat, lng]
    if (Array.isArray(p) && p.length >= 2) {
      return {
        lat: Number(p[0]),
        lng: Number(p[1])
      };
    }

    // { lat, lng }
    if (
      p &&
      typeof p === 'object' &&
      p.lat != null &&
      p.lng != null
    ) {
      return {
        lat: Number(p.lat),
        lng: Number(p.lng)
      };
    }

    return null;
  };

  let dist = 0;

  for (let i = 1; i < pathPoints.length; i++) {

    const a = toLL(pathPoints[i - 1]);
    const b = toLL(pathPoints[i]);

    if (!a || !b) continue;

    const dx = a.lat - b.lat;
    const dy = a.lng - b.lng;

    dist += Math.sqrt(dx * dx + dy * dy);
  }

  // 위경도 → 대략 meter 환산
  return dist * 111000;
}

/* =========================================================
   GRAPH LOAD
========================================================= */
export async function loadGraph() {

  const res = await Promise.all([

    supabase
      .from('outdoor_nodes')
      .select('*'),

    supabase
      .from('indoor_nodes')
      .select('*'),

    supabase
      .from('outdoor_edges')
      .select('*'),

    supabase
      .from('indoor_edges')
      .select('*'),

    supabase
      .from('transfer_edges')
      .select('*')

  ]);

  const outN = res[0].data || [];
  const inN  = res[1].data || [];

  const outE = res[2].data || [];
  const inE  = res[3].data || [];

  const trE  = res[4].data || [];

  const nodes = [];
  const edges = [];


  /* =========================================================
     OUTDOOR NODES
  ========================================================= */
  for (let i = 0; i < outN.length; i++) {
    const n = outN[i];
    nodes.push({
      id: 'out_' + n.id,
      raw_id: n.id,
      name: n.name, // ✅ 추가: DB의 name 저장
      type: 'outdoor',
      lat: Number(n.lat),
      lng: Number(n.lng),
      elevation: n.elevation ?? 0
    });
  }

  /* =========================================================
     INDOOR NODES
  ========================================================= */
  for (let i = 0; i < inN.length; i++) {
    const n = inN[i];
    nodes.push({
      id: 'in_' + n.id,
      raw_id: n.id,
      name: n.name, // ✅ 추가: DB의 name 저장
      type: 'indoor',
      x: Number(n.x),
      y: Number(n.y),
      building_id: n.building_id,
      floor_id: n.floor_id
    });
  }


  /* =========================================================
     NODE MAP
  ========================================================= */
  const nodeMap = new Map();

  for (let i = 0; i < nodes.length; i++) {
    nodeMap.set(nodes[i].id, nodes[i]);
  }

  /* =========================================================
     ELEVATION MAP
  ========================================================= */
  const elevationByNode = new Map();

  for (let i = 0; i < nodes.length; i++) {

    const n = nodes[i];

    if (typeof n.elevation === 'number') {
      elevationByNode.set(n.id, n.elevation);
    }
  }

  /* =========================================================
     ELEVATION DIFF 계산
  ========================================================= */
  const calcElevationDiff = (fromId, toId, fallback) => {

    if (fallback != null) {
      return fallback;
    }

    const a = elevationByNode.get(fromId);
    const b = elevationByNode.get(toId);

    if (
      typeof a === 'number' &&
      typeof b === 'number'
    ) {
      return b - a;
    }

    return 0;
  };

  /* =========================================================
     EDGE NORMALIZER
  ========================================================= */
  function norm(e, graphType) {

    const rawDist =
      e.distance != null
        ? Number(e.distance)
        : null;

    const ppDist = pathLength(e.path_points);

    const distance =
      rawDist != null
        ? rawDist
        : (ppDist != null ? ppDist : 1);

    let from;
    let to;

    /* =========================
       OUTDOOR EDGE
    ========================= */
    if (graphType === 'outdoor') {

      from = 'out_' + e.from_node;
      to   = 'out_' + e.to_node;
    }

    /* =========================
       INDOOR EDGE
    ========================= */
    else {

      from = 'in_' + e.from_node;
      to   = 'in_' + e.to_node;
    }

    const elevation_diff =
      calcElevationDiff(
        from,
        to,
        e.elevation_diff
      );

    return {

      from,
      to,

      distance,

      // outdoor / indoor / transfer
      type: graphType,

      // stairs / escalator / subway / walk
      edgeType: e.type ? e.type : 'walk',

      congestion:
        e.congestion != null
          ? e.congestion
          : null,

      direction:
        e.direction
          ? e.direction
          : 'bidirectional',

      path_points:
        e.path_points
          ? e.path_points
          : null,

      elevation_diff
    };
  }

  /* =========================================================
     OUTDOOR EDGES
  ========================================================= */
  for (let i = 0; i < outE.length; i++) {
    edges.push(
      norm(outE[i], 'outdoor')
    );
  }

  /* =========================================================
     INDOOR EDGES
  ========================================================= */
  for (let i = 0; i < inE.length; i++) {
    edges.push(
      norm(inE[i], 'indoor')
    );
  }

  /* =========================================================
     TRANSFER EDGES
     outdoor ↔ indoor 연결
  ========================================================= */
  for (let i = 0; i < trE.length; i++) {

    const e = trE[i];

    edges.push({

      from: 'out_' + e.outdoor_node_id,
      to: 'in_' + e.indoor_node_id,

      distance:
        e.cost != null
          ? Number(e.cost)
          : 1,

      type: 'transfer',

      edgeType:
        e.type
          ? e.type
          : 'walk',

      congestion: null,

      direction:
        e.direction
          ? e.direction
          : 'bidirectional',

      path_points: null,

      elevation_diff:
        e.elevation_diff != null
          ? Number(e.elevation_diff)
          : 0
    });
  }

  /* =========================================================
     GRAPH
  ========================================================= */
  const graph = new Map();

  /* =========================================================
     EDGE MAP
  ========================================================= */
  const edgeMap = new Map();

  /* =========================================================
     GRAPH ADD
  ========================================================= */
  function add(from, to, edge) {

    if (!graph.has(from)) {
      graph.set(from, []);
    }

    graph.get(from).push({
      to,
      edge
    });
  }

  /* =========================================================
     GRAPH BUILD
  ========================================================= */
  for (let i = 0; i < edges.length; i++) {

    const e = edges[i];

    // 정방향
    add(e.from, e.to, e);

    edgeMap.set(
      e.from + '-' + e.to,
      e
    );

    /* =========================
       양방향 처리
    ========================= */
    if (e.direction === 'bidirectional') {

      const rev = {

        ...e,

        from: e.to,
        to: e.from,

        // 경사 반전
        elevation_diff:
          -(e.elevation_diff || 0),

        // 경로 reverse
        path_points:
          e.path_points
            ? e.path_points
                .slice()
                .reverse()
            : null
      };

      add(
        rev.from,
        rev.to,
        rev
      );

      edgeMap.set(
        rev.from + '-' + rev.to,
        rev
      );
    }
  }

  /* =========================================================
     RETURN
  ========================================================= */
  return {

    graph,

    nodeMap,

    edgeMap
  };
}
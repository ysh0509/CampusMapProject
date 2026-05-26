import {
  fetchTable,
  insertRow,
  deleteRow
} from '../common/adminApi.js';
import { logAction } from '../common/adminLogger.js';


export async function getOutdoorEdges() {
  return await fetchTable('outdoor_edges');
}

export async function createOutdoorEdge(edge) {
  return await insertRow('outdoor_edges', {
    from_node: edge.from_node,
    to_node: edge.to_node,

    distance: edge.distance,

    direction: edge.direction || 'bidirectional',

    slope_forward: edge.slope_forward,
    slope_backward: edge.slope_backward,

    elevation_diff: edge.elevation_diff,

    path_points: edge.path_points || []
  });
}

export async function deleteOutdoorEdge(id) {
  return await deleteRow('outdoor_edges', id);
}
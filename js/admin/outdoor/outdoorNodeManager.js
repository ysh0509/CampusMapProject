import {
  fetchTable,
  insertRow,
  updateRow,
  deleteRow
} from '../common/adminApi.js';
import { logAction } from '../common/adminLogger.js';


export async function getOutdoorNodes() {
  return await fetchTable('outdoor_nodes');
}

export async function createOutdoorNode(node) {
  return await insertRow('outdoor_nodes', node);
}

export async function updateOutdoorNode(id, node) {
  return await updateRow('outdoor_nodes', id, node);
}

export async function deleteOutdoorNode(id) {
  return await deleteRow('outdoor_nodes', id);
}
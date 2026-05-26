// =========================
// indoorNodeManager.js
// =========================
import { supabase } from '../common/adminApi.js';

export async function getNodes(buildingId, floorId){
  return supabase.from('indoor_nodes')
    .select('*')
    .eq('building_id', buildingId)
    .eq('floor_id', floorId);
}

export async function createNode(data){
  return supabase.from('indoor_nodes').insert(data);
}


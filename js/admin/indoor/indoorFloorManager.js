// =========================
// indoorFloorManager.js
// =========================
export async function getFloors(buildingId){
  return supabase.from('indoor_floors')
    .select('*')
    .eq('building_id', buildingId);
}


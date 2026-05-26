// =========================
// indoorBuildingManager.js
// =========================
export async function getBuildings(){
  return supabase.from('indoor_buildings').select('*');
}

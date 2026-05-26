// =========================
// indoorEdgeManager.js
// =========================
export async function getEdges(){
  return supabase.from('indoor_edges').select('*');
}

export async function createEdge({from,to}){

  const dx = from.x - to.x;
  const dy = from.y - to.y;

  const dist = Math.sqrt(dx*dx+dy*dy);

  return supabase.from('indoor_edges').insert({
    from_node: from.id,
    to_node: to.id,
    distance: dist,
    direction:'bidirectional',
    type:'walk'
  });
}


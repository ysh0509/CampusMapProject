import { protectPage } from '../common/adminRouterGuard.js';
import { initAdminHeader } from '../common/adminHeader.js';
import { supabase } from '../common/adminApi.js';

await protectPage();
initAdminHeader('indoor');

const map = L.map('map', { crs: L.CRS.Simple, zoomControl:true });
let imageLayer=null;

let mode='floor_new';
let buildings=[];
let floors=[];
let nodes=[];
let edges=[];
let currentFloor=null;

let nodeMarkers=[];
let edgeLines=[];
let selectedNodes=[];

const statusEl=document.getElementById('status');
const views=document.querySelectorAll('.view');

const bName=document.getElementById('bName');
const btnAddBuilding=document.getElementById('btnAddBuilding');

const fBuildingId=document.getElementById('fBuildingSel');
const fFloorNum=document.getElementById('fFloorNum');
const fImageUrl=document.getElementById('fImageUrl');
const btnAddFloor=document.getElementById('btnAddFloor');
const fileInput = document.getElementById('floorImageFile');
const btnUpload = document.getElementById('btnUploadImage');

const searchBuilding=document.getElementById('searchBuilding');
const searchFloor=document.getElementById('searchFloor');
const floorList=document.getElementById('floorList');

const selBuilding=document.getElementById('selBuilding');
const selFloor=document.getElementById('selFloor');
const btnLoadFloor=document.getElementById('btnLoadFloor');

const fBuildingSel = document.getElementById('fBuildingSel');
const selBuildingSel = document.getElementById('selBuildingSel');


// 탭 전환
document.querySelectorAll('.tab').forEach(tab=>{
  tab.onclick=()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    mode=tab.dataset.mode;
    switchView(mode);
  };
});

function switchView(m){
  views.forEach(v=>v.style.display='none');
  document.getElementById(`view-${m}`).style.display='block';
}

function setStatus(t){ statusEl.innerText=t; }

// 건물 추가
btnAddBuilding.onclick = async () => {
  const name = bName.value.trim();
  if (!name) { setStatus('건물 이름 입력'); return; }

  const { data: exists } = await supabase
    .from('buildings')
    .select('id')
    .eq('name', name)
    .maybeSingle();
  if (exists) { setStatus('이미 있는 건물 이름'); return; }

  const { error } = await supabase.from('buildings').insert({ name });
  if (error) { setStatus('건물 추가 실패'); return; }
  setStatus('건물 추가 완료');
  bName.value = '';
  loadBuildings();
};


// 평면도 추가 (floors)
btnAddFloor.onclick = async () => {
  const bid = Number(fBuildingId.value);
  const flr = Number(fFloorNum.value);
  const img = fImageUrl.value.trim();
  if (!bid || !flr || !img) { setStatus('필수 입력 확인'); return; }

  const { data: bExists } = await supabase.from('buildings').select('id').eq('id', bid).maybeSingle();
  if (!bExists) { setStatus('존재하지 않는 건물 ID'); return; }

  const { data: fExists } = await supabase
    .from('floors')
    .select('id')
    .eq('building_id', bid)
    .eq('floor_number', flr)
    .maybeSingle();
  if (fExists) { setStatus('이미 등록된 층'); return; }

  const { error } = await supabase.from('floors').insert({
    building_id: bid,
    floor_number: flr,
    map_image_url: img
  });
  if (error) { setStatus('평면도 추가 실패'); return; }

  setStatus('평면도 추가 완료');
  fBuildingId.value = fFloorNum.value = fImageUrl.value = '';
  loadFloors();
};

btnUploadImage.onclick = async () => {
  try {
    const file = floorImageFile.files?.[0];
    if (!file) {
      alert('이미지 파일을 먼저 선택하세요.');
      return;
    }

    const fileExt = file.name.split('.').pop()?.toLowerCase() || 'png';
    const fileName = `indoor/floor_${Date.now()}.${fileExt}`;

    // 버킷명 꼭 확인: maps
    const { data, error } = await supabase.storage
      .from('maps')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type
      });

    console.log('upload data:', data);
    console.log('upload error:', error);

    if (error) {
      alert(`업로드 실패: ${error.message}`);
      return;
    }

    const { data: pub } = supabase.storage.from('maps').getPublicUrl(fileName);
    if (!pub?.publicUrl) {
      alert('public URL 생성 실패');
      return;
    }

    fImageUrl.value = pub.publicUrl;
    alert('업로드 성공');
  } catch (e) {
    console.error('btnUploadImage error:', e);
    alert(`업로드 예외: ${e.message || e}`);
  }
};




// 목록 필터
searchBuilding.oninput=renderFloorList;
searchFloor.oninput=renderFloorList;

// 데이터 로드
async function loadBuildings(){
  const { data, error } = await supabase.from('buildings').select('*');
  if(!error) buildings = data || [];
  fillBuildingSelect(fBuildingSel);
  fillBuildingSelect(selBuildingSel);
}

function fillBuildingSelect(sel){
  if(!sel) return;
  sel.innerHTML = '<option value="">건물 선택</option>';
  buildings.forEach(b=>{
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = `${b.name || '건물'} (ID ${b.id})`;
    sel.appendChild(opt);
  });
}

async function loadFloors(){
  const { data, error } = await supabase.from('floors').select('*');
  if(!error) floors=data||[];
  renderFloorList();
}
function renderFloorList(){
  const b=searchBuilding.value.trim();
  const f=searchFloor.value.trim();
  floorList.innerHTML='';
  floors
    .filter(x=>!b || String(x.building_id).includes(b))
    .filter(x=>!f || String(x.floor_number).includes(f))
    .forEach(x=>{
      const div=document.createElement('div');
      div.className='item';
      div.innerHTML=`
        건물 ${x.building_id} / 층 ${x.floor_number}
        <div style="margin-top:4px; display:flex; gap:6px;">
          <button class="secondary" style="flex:1;" data-id="${x.id}" data-action="edit">수정</button>
          <button class="secondary" style="flex:1;" data-id="${x.id}" data-action="delete">삭제</button>
        </div>`;
      floorList.appendChild(div);
    });

  floorList.querySelectorAll('button').forEach(btn=>{
    btn.onclick=async()=>{
      const id=btn.dataset.id;
      const action=btn.dataset.action;
      if(action==='delete'){
        if(!confirm('삭제할까요?')) return;
        await supabase.from('floors').delete().eq('id',id);
        loadFloors();
      }else{
        const floor=floors.find(x=>String(x.id)===String(id));
        if(!floor) return;
        const newImg=prompt('이미지 URL', floor.map_image_url||'');
        if(!newImg) return;
        await supabase.from('floors').update({ map_image_url:newImg }).eq('id',id);
        loadFloors();
      }
    };
  });
}

// 편집 대상 로드
btnLoadFloor.onclick = async () => {
  const bid = Number(selBuildingSel.value);
  const flr = Number(selFloor.value);
  if(!bid || !flr){ setStatus('건물/층 선택'); return; }

  const { data: floor, error } = await supabase.from('floors')
    .select('*').eq('building_id', bid).eq('floor_number', flr).single();
  if(error || !floor){ setStatus('평면도 없음'); return; }

  currentFloor = floor;
  await loadNodesEdges(floor.id);
  loadImage(floor);
  setStatus(`불러옴: 건물 ${floor.building_id} / ${floor.floor_number}층`);
};


// 노드/엣지 로드
async function loadNodesEdges(floorId){
  const { data:n } = await supabase.from('indoor_nodes')
    .select('*').eq('floor_id', floorId);
  const { data:e } = await supabase.from('indoor_edges')
    .select('*');
  nodes = n||[];
  edges = (e||[]).filter(ed=>nodes.some(nn=>nn.id===ed.from_node)&&nodes.some(nn=>nn.id===ed.to_node));
  renderMap();
}

// 평면도 이미지
function loadImage(floor){
  if(imageLayer) map.removeLayer(imageLayer);
  const w=1000, h=1000; // width/height 정보 없음 → 기본값
  const bounds=[[0,0],[h,w]];
  imageLayer=L.imageOverlay(floor.map_image_url,bounds).addTo(map);
  map.fitBounds(bounds);
}

// 지도 렌더
function renderMap(){
  nodeMarkers.forEach(m=>map.removeLayer(m));
  edgeLines.forEach(l=>map.removeLayer(l));
  nodeMarkers=[]; edgeLines=[];

  edges.forEach(e=>{
    const from=nodes.find(n=>n.id===e.from_node);
    const to=nodes.find(n=>n.id===e.to_node);
    if(!from||!to) return;
    const line=L.polyline([[from.y,from.x],[to.y,to.x]], styleEdge(e)).addTo(map);
    line.on('click',()=>openEdgeModal(e));
    edgeLines.push(line);
  });

  nodes.forEach(n=>{
    const m=L.circleMarker([n.y,n.x],{
      radius:6, color:'#2563eb', weight:2, draggable:true
    }).addTo(map);
    m.bindTooltip(n.name||`노드 ${n.id}`);
    m.on('dragend',async ev=>{
      const {lat,lng}=ev.target.getLatLng();
      await supabase.from('indoor_nodes').update({x:lng, y:lat}).eq('id', n.id);
      loadNodesEdges(currentFloor.id);
    });
    m.on('click',()=>handleNodeSelect(n));
    nodeMarkers.push(m);
  });
}

function styleEdge(e){
  if(e.type==='stairs') return {color:'red', dashArray:'5,5'};
  if(e.type==='elevator') return {color:'blue', weight:6};
  return {color:'#10b981'};
}

// 노드 선택 → 엣지 생성
async function handleNodeSelect(n){
  if(selectedNodes.includes(n.id)){
    selectedNodes=selectedNodes.filter(id=>id!==n.id);
  }else{
    selectedNodes.push(n.id);
  }
  setStatus(`선택 ${selectedNodes.length}/2`);
  if(selectedNodes.length===2){
    await createEdge(selectedNodes[0], selectedNodes[1]);
    selectedNodes=[];
    loadNodesEdges(currentFloor.id);
  }
}

// 엣지 생성
async function createEdge(a,b){
  const from=nodes.find(n=>n.id===a);
  const to=nodes.find(n=>n.id===b);
  if(!from||!to) return;
  const dist=calcDistance(from,to);
  const type=prompt('type (walk/stairs/elevator)','walk')||'walk';
  const bidir = confirm('양방향이면 확인, 단방향이면 취소');
  const direction = bidir ? 'bidirectional' : 'one-way';
  const is_bidirectional = bidir;
  await supabase.from('indoor_edges').insert({
    from_node:from.id, to_node:to.id,
    distance:dist, type,
    direction, is_bidirectional
  });
  setStatus('엣지 생성 완료');
}

// 엣지 수정/삭제
async function openEdgeModal(e){
  const action=prompt(`EDGE ${e.id}
1: 수정
2: 삭제
type: ${e.type}
dist: ${e.distance}`);
  if(action==='2'){
    await supabase.from('indoor_edges').delete().eq('id', e.id);
    loadNodesEdges(currentFloor.id); return;
  }
  if(action==='1'){
    const dist=parseFloat(prompt('거리', e.distance));
    const type=prompt('type (walk/stairs/elevator)', e.type||'walk');
    const bidir = confirm('양방향이면 확인, 단방향이면 취소');
    const direction = bidir ? 'bidirectional' : 'one-way';
    const is_bidirectional = bidir;
    await supabase.from('indoor_edges').update({distance:dist, type, direction, is_bidirectional}).eq('id', e.id);
    loadNodesEdges(currentFloor.id);
  }
}

// 지도 인터랙션
map.on('dblclick', async e=>{
  if(!currentFloor){ setStatus('먼저 평면도 불러오기'); return; }
  const name=prompt('노드 이름');
  if(!name) return;
  await supabase.from('indoor_nodes').insert({
    name, x:e.latlng.lng, y:e.latlng.lat,
    building_id: currentFloor.building_id,
    floor_id: currentFloor.id,
    type: 'normal'
  });
  loadNodesEdges(currentFloor.id);
});

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    selectedNodes=[];
    setStatus('선택 초기화');
  }
});

// 거리 계산 (px 기준, 축척 정보 없음 → px 그대로)
function calcDistance(a,b){
  const dx=a.x-b.x, dy=a.y-b.y;
  return Math.sqrt(dx*dx+dy*dy);
}

// 초기화
loadBuildings();
loadFloors();

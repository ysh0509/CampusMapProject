import { protectPage } from './common/adminRouterGuard.js';
import { initAdminHeader } from './common/adminHeader.js';

await protectPage();
initAdminHeader('spatial');

const $ = (id) => document.getElementById(id);
const el = {
  apiBase: $('api-base'),
  sourceStream: $('source-stream'),
  topviewStream: $('topview-stream'),
  obstacleOverlay: $('obstacle-overlay'),
  sourceStage: $('source-stage'),
  overlay: $('calibration-overlay'),
  pointList: $('point-list'),
  pointGuide: $('point-guide'),
  videoSource: $('video-source'),
  spaceWidth: $('space-width'),
  spaceHeight: $('space-height'),
  confidence: $('confidence'),
  confidenceValue: $('confidence-value'),
  resetPoints: $('reset-points'),
  saveConfig: $('save-config'),
  message: $('message'),
  stateDot: $('state-dot'),
  stateText: $('state-text'),
  peopleCount: $('people-count'),
  fps: $('fps'),
  calibrationState: $('calibration-state'),
  frameSize: $('frame-size')
  ,
  controlAlert: $('control-alert'),
  alertLevel: $('alert-level'),
  spaceName: $('space-name'),
  alertMessage: $('alert-message'),
  congestionLevel: $('congestion-level'),
  spaceConfigLink: $('space-config-link')
};

let points = [];
let frameSize = [0, 0];
let connectedBase = '';
let configHydrated = false;
const query = new URLSearchParams(location.search);
const navigationId = Number(query.get('navigation_id')) || null;
const requestedCameraId = query.get('camera_id') || '';
let currentCongestion = null;
let currentSpace = null;
let matchedVideoSource = null;
let cameraSourceSynced = false;
let spaceObstacles = [];
let latestServiceStatus = null;

function baseUrl() {
  return el.apiBase.value.trim().replace(/\/+$/, '');
}

function setMessage(text, error = false) {
  el.message.textContent = text;
  el.message.classList.toggle('error', error);
}

function streamUrl(path) {
  return `${baseUrl()}${path}?t=${Date.now()}`;
}

function connectStreams() {
  const base = baseUrl();
  if (!base || base === connectedBase) return;
  connectedBase = base;
  el.sourceStream.src = streamUrl('/stream/source');
  el.topviewStream.src = streamUrl('/stream/topview');
}

function renderPoints() {
  const labels = ['좌상단', '우상단', '우하단', '좌하단'];
  el.pointList.innerHTML = labels.map((label, index) => {
    const point = points[index];
    return `${index + 1}. ${label}: ${point ? `${Math.round(point[0])}, ${Math.round(point[1])}` : '-'}`;
  }).join('<br>');
  el.pointGuide.textContent = latestServiceStatus?.depth_sensor?.active
    ? '깊이 센서 좌표 자동 적용'
    : (points.length < 4 ? `${labels[points.length]} 지점을 선택하세요` : '4개 지점 선택 완료');

  const [width, height] = frameSize;
  if (!width || !height) {
    el.overlay.innerHTML = '';
    return;
  }
  el.overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const pointMarkup = points.map((point, index) => `
    <circle cx="${point[0]}" cy="${point[1]}" r="7" fill="#4776e6" stroke="#fff" stroke-width="2"/>
    <text x="${point[0] + 11}" y="${point[1] - 10}" fill="#fff" font-size="18" font-weight="800">${index + 1}</text>
  `).join('');
  const polygon = points.length > 1
    ? `<polyline points="${points.map((point) => point.join(',')).join(' ')}${points.length === 4 ? ` ${points[0].join(',')}` : ''}" fill="rgba(71,118,230,.13)" stroke="#2ea4ff" stroke-width="3"/>`
    : '';
  el.overlay.innerHTML = polygon + pointMarkup;
}

function applyStatus(data) {
  latestServiceStatus = data;
  frameSize = data.frame_size || [0, 0];
  el.peopleCount.textContent = data.people_count ?? '-';
  el.fps.textContent = data.fps ?? '-';
  el.frameSize.textContent = frameSize[0] ? `${frameSize[0]} × ${frameSize[1]}` : '-';
  el.calibrationState.textContent = data.depth_sensor?.active
    ? '깊이 자동 좌표'
    : (data.calibrated ? '보정 완료' : '미보정');
  el.stateDot.classList.toggle('online', Boolean(data.camera_online));
  el.stateText.textContent = data.camera_online
    ? '카메라 프레임 수신 중'
    : '카메라 미연결 · 실시간 분석 중지';

  if (data.config && !configHydrated) {
    el.videoSource.value = matchedVideoSource ?? data.config.video_source;
    el.spaceWidth.value = data.config.space_width_m;
    el.spaceHeight.value = data.config.space_height_m;
    el.confidence.value = data.config.confidence;
    el.confidenceValue.textContent = Number(data.config.confidence).toFixed(2);
    points = data.config.source_points || [];
    configHydrated = true;
  }
  renderPoints();
  renderControlAlert(data);
  syncMatchedCameraSource(data);
}

async function syncMatchedCameraSource(data) {
  if (cameraSourceSynced || matchedVideoSource === null || !data.config) return;
  cameraSourceSynced = true;
  if (String(data.config.video_source) === String(matchedVideoSource)) return;
  try {
    const response = await fetch(`${baseUrl()}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_source: String(matchedVideoSource),
        confidence: Number(data.config.confidence),
        output_width: Number(data.config.output_width),
        output_height: Number(data.config.output_height),
        space_width_m: Number(data.config.space_width_m),
        space_height_m: Number(data.config.space_height_m),
        source_points: data.config.source_points || []
      })
    });
    if (!response.ok) throw new Error(await response.text());
    connectedBase = '';
    connectStreams();
    setMessage('매칭된 카메라 영상 소스로 실시간 분석을 연결했습니다.');
  } catch (error) {
    cameraSourceSynced = false;
    setMessage(`카메라 영상 소스 연결 실패: ${error.message}`, true);
  }
}

function renderControlAlert(serviceStatus = {}) {
  const level = String(currentCongestion?.last_congestion_level || 'UNKNOWN').toUpperCase();
  el.congestionLevel.textContent = level === 'UNKNOWN' ? '-' : level;
  el.spaceName.textContent = currentSpace?.space_name || (navigationId ? `Navigation ${navigationId}` : '공간 매칭 정보 없음');
  el.controlAlert.classList.toggle('high', level === 'HIGH');
  el.controlAlert.classList.toggle('offline', !serviceStatus.camera_online);
  if (level === 'HIGH' && serviceStatus.camera_online) {
    el.alertLevel.textContent = 'HIGH · 실시간 관제 필요';
    el.alertMessage.textContent = '혼잡도가 높고 카메라가 연결되어 있습니다. 탑뷰와 원본 영상을 즉시 확인하세요.';
  } else if (level === 'HIGH') {
    el.alertLevel.textContent = 'HIGH · 카메라 확인 필요';
    el.alertMessage.textContent = '혼잡도가 높지만 카메라 프레임이 수신되지 않습니다. 현장 또는 송출 상태를 확인하세요.';
  } else if (!serviceStatus.camera_online) {
    el.alertLevel.textContent = '실시간 분석 대기';
    el.alertMessage.textContent = '카메라가 켜지고 프레임이 연결된 경우에만 사람 위치 분석이 진행됩니다.';
  } else {
    el.alertLevel.textContent = level === 'UNKNOWN' ? '혼잡 정보 없음' : `${level} · 정상 관제`;
    el.alertMessage.textContent = '카메라가 연결되어 실시간 사람 위치를 탑뷰에 표시하고 있습니다.';
  }
}

function renderObstacles() {
  el.obstacleOverlay.innerHTML = spaceObstacles.map((obstacle) => {
    const points = (obstacle.polygon || []).map((point) => point.join(',')).join(' ');
    return `<polygon points="${points}" fill="rgba(245,158,11,.24)" stroke="#f59e0b" stroke-width="7">
      <title>${obstacle.label || 'obstacle'}</title>
    </polygon>`;
  }).join('');
}

async function loadSpaceContext() {
  if (!navigationId) {
    renderControlAlert({});
    return;
  }
  const [spaceResult, statusResult, cameraMapResult, obstacleResult] = await Promise.all([
    supabase.from('indoor_spatial_spaces').select('*').eq('navigation_element_id', navigationId).maybeSingle(),
    supabase.from('node_status').select('*').eq('node_id', navigationId).maybeSingle(),
    supabase.from('camera_node_map').select('camera_id,node_status_id').eq('node_status_id', navigationId).maybeSingle(),
    supabase.from('indoor_obstacle_maps').select('obstacles').eq('navigation_element_id', navigationId).maybeSingle()
  ]);
  currentSpace = spaceResult.data || null;
  currentCongestion = statusResult.data || null;
  spaceObstacles = obstacleResult.data?.obstacles || [];
  renderObstacles();
  const cameraId = requestedCameraId || cameraMapResult.data?.camera_id || currentSpace?.camera_id;
  if (cameraId && !configHydrated) {
    const { data: camera } = await supabase
      .from('camera_profiles')
      .select('camera_id,video_source')
      .eq('camera_id', cameraId)
      .maybeSingle();
    if (camera?.video_source !== undefined) {
      matchedVideoSource = String(camera.video_source);
      el.videoSource.value = matchedVideoSource;
    }
  }
  el.spaceConfigLink.href = `/html/admin/indoor/admin_indoor_reconstruction.html?navigation_id=${navigationId}`;
}

function subscribeCongestion() {
  if (!navigationId) return;
  supabase
    .channel(`spatial-monitor-${navigationId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'node_status',
      filter: `node_id=eq.${navigationId}`
    }, (payload) => {
      currentCongestion = payload.new || currentCongestion;
      renderControlAlert({
        camera_online: el.stateDot.classList.contains('online')
      });
    })
    .subscribe();
}

async function refreshStatus() {
  connectStreams();
  try {
    const response = await fetch(`${baseUrl()}/api/health`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    applyStatus(await response.json());
  } catch (error) {
    el.stateDot.classList.remove('online');
    el.stateText.textContent = '분석 서비스 오프라인';
    setMessage(`연결 실패: ${error.message}`, true);
    renderControlAlert({});
  }
}

el.sourceStage.addEventListener('click', (event) => {
  if (points.length >= 4 || !frameSize[0]) return;
  const imageRect = el.sourceStream.getBoundingClientRect();
  const naturalRatio = frameSize[0] / frameSize[1];
  const elementRatio = imageRect.width / imageRect.height;
  let drawnWidth = imageRect.width;
  let drawnHeight = imageRect.height;
  let offsetX = 0;
  let offsetY = 0;
  if (elementRatio > naturalRatio) {
    drawnWidth = imageRect.height * naturalRatio;
    offsetX = (imageRect.width - drawnWidth) / 2;
  } else {
    drawnHeight = imageRect.width / naturalRatio;
    offsetY = (imageRect.height - drawnHeight) / 2;
  }
  const x = event.clientX - imageRect.left - offsetX;
  const y = event.clientY - imageRect.top - offsetY;
  if (x < 0 || y < 0 || x > drawnWidth || y > drawnHeight) return;
  points.push([x * frameSize[0] / drawnWidth, y * frameSize[1] / drawnHeight]);
  renderPoints();
});

el.resetPoints.onclick = () => {
  points = [];
  renderPoints();
  setMessage('보정 지점을 초기화했습니다.');
};

el.confidence.oninput = () => {
  el.confidenceValue.textContent = Number(el.confidence.value).toFixed(2);
};

el.apiBase.onchange = () => {
  connectedBase = '';
  configHydrated = false;
  points = [];
  refreshStatus();
};

el.saveConfig.onclick = async () => {
  if (!latestServiceStatus?.depth_sensor?.active && points.length !== 4) {
    setMessage('원본 영상에서 바닥 기준점 4개를 먼저 선택하세요.', true);
    return;
  }
  const payload = {
    video_source: el.videoSource.value.trim(),
    confidence: Number(el.confidence.value),
    output_width: 720,
    output_height: 480,
    space_width_m: Number(el.spaceWidth.value),
    space_height_m: Number(el.spaceHeight.value),
    source_points: points
  };
  try {
    const response = await fetch(`${baseUrl()}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await response.text());
    applyStatus(await response.json());
    connectedBase = '';
    connectStreams();
    setMessage('공간 보정과 영상 소스 설정을 저장했습니다.');
  } catch (error) {
    setMessage(`저장 실패: ${error.message}`, true);
  }
};

renderPoints();
await loadSpaceContext();
subscribeCongestion();
refreshStatus();
setInterval(refreshStatus, 2000);
setInterval(loadSpaceContext, 3000);

import os
import cv2
import time
import torch
import threading
import numpy as np
import socket

from datetime import datetime, timezone
from collections import deque, defaultdict
from dotenv import load_dotenv
from ultralytics import YOLO
from supabase import create_client

# =========================================================
# ENV LOAD
# =========================================================
load_dotenv()

# =========================================================
# SUPABASE
# =========================================================
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# =========================================================
# YOLO
# =========================================================
YOLO_MODEL = os.getenv("YOLO_MODEL", "yolov8n.pt")
CONF_THRESH = float(os.getenv("CONF_THRESH", "0.35"))
IOU_THRESH = float(os.getenv("IOU_THRESH", "0.45"))

# =========================================================
# STABILIZATION
# =========================================================
SETTLE_SEC = float(os.getenv("SETTLE_SEC", "0.3"))
SMOOTH_FRAMES = int(os.getenv("SMOOTH_FRAMES", "3"))

# =========================================================
# PERFORMANCE
# =========================================================
SHOW_WINDOW = os.getenv("SHOW_WINDOW", "1") == "1"
INFER_W = int(os.getenv("INFER_W", "640"))
INFER_H = int(os.getenv("INFER_H", "360"))
FRAME_SKIP = int(os.getenv("FRAME_SKIP", "1"))

# =========================================================
# DATABASE
# =========================================================
SEND_INTERVAL_SEC = float(os.getenv("SEND_INTERVAL_SEC", "1.0"))
HEARTBEAT_SEC = float(os.getenv("HEARTBEAT_SEC", "30"))
DB_RETRY = int(os.getenv("DB_RETRY", "1"))
UPDATE_NODE_STATUS = (os.getenv("UPDATE_NODE_STATUS", "1") == "1")

# =========================================================
# BRIDGE (UDP Control & Sensor)
# =========================================================
CONTROL_BRIDGE_IP = "127.0.0.1" 
CONTROL_BRIDGE_PORT = 5005      
bridge_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
bridge_sock.setblocking(False) 

# =========================================================
# ROI BASE RESOLUTION
# =========================================================
ROI_BASE_W = 640
ROI_BASE_H = 360

# =========================================================
# VALIDATION
# =========================================================
if not SUPABASE_URL: raise ValueError("SUPABASE_URL 누락")
if not SUPABASE_KEY: raise ValueError("SUPABASE_SERVICE_ROLE_KEY 누락")

# =========================================================
# SUPABASE CLIENT
# =========================================================
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# =========================================================
# CUDA
# =========================================================
device = "cuda:0" if torch.cuda.is_available() else "cpu"

# =========================================================
# LOG
# =========================================================
def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

# =========================================================
# RETRY
# =========================================================
def retry(fn, n=1):
    err = None
    for _ in range(max(1, n + 1)):
        try:
            return fn(), None
        except Exception as e:
            err = e
            time.sleep(0.15)
    return None, err

# =========================================================
# UTC ISO
# =========================================================
def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# =========================================================
# VIDEO SOURCE & OPEN (수정된 핵심 로직)
# =========================================================
def parse_video_source(raw):
    """
    raw: database에서 가져온 video_source 값 (문자열 형태)
    반환값: (소스, 타입) -> (int 또는 str, 'camera' | 'stream' | 'file')
    """
    s = str(raw).strip()
    
    # 1. 숫자로만 이루어진 경우 (예: "0", "1", "2") -> 로컬 카메라 인덱스
    if s.isdigit():
        return int(s), "camera"
    
    # 2. URL 프로토콜로 시작하는 경우 -> 스트리밍 주소
    low = s.lower()
    if low.startswith(("rtsp://", "http://", "https://")):
        return s, "stream"
    
    # 3. 그 외의 경우 -> 로컬 파일 경로
    return s, "file"

def open_capture(src, src_type):
    # camera 타입일 경우 src는 이미 int로 변환되어 들어옴
    if src_type == "camera":
        # 로컬 웹캠(인덱스 방식) 오픈
        cap = cv2.VideoCapture(src)
    elif src_type == "stream":
        # RTSP/HTTP 스트림 오픈
        cap = cv2.VideoCapture(src)
    else:
        # 파일 오픈
        cap = cv2.VideoCapture(src)

    if not cap.isOpened():
        return None

    # 성능 최적화 설정
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    # 스트림의 경우 FPS 설정이 무시될 수 있으나 안정성을 위해 유지
    cap.set(cv2.CAP_PROP_FPS, 30)
    return cap

# =========================================================
# CONGESTION LEVEL
# =========================================================
def level_from_count(c, low_lt, mid_lt):
    if c < low_lt: return "LOW"
    if c < mid_lt: return "MID"
    return "HIGH"

# =========================================================
# BUILD ROI MASKS
# =========================================================
def build_masks(zones, w, h):
    masks = {}
    for z in zones:
        zid = str(z["id"])
        scaled_points = [[int(px * w / ROI_BASE_W), int(py * h / ROI_BASE_H)] for px, py in z["points"]]
        m = np.zeros((h, w), dtype=np.uint8)
        cv2.fillPoly(m, [np.array(scaled_points, dtype=np.int32)], 1)
        masks[zid] = m
    return masks

def validate_roi_json(roi):
    if not isinstance(roi, dict) or "zones" not in roi or not isinstance(roi["zones"], list) or len(roi["zones"]) == 0:
        raise ValueError("roi_json.zones 오류")

def load_camera_profiles():
    q = sb.table("camera_profiles").select("*").eq("is_active", True).execute()
    arr = q.data or []
    if not arr: raise ValueError("활성 카메라 없음")
    return arr

# =========================================================
# DATABASE OPERATIONS
# =========================================================
def insert_events(rows):
    def _i(): return sb.table("occupancy_events").insert(rows).execute()
    _, e = retry(_i, DB_RETRY)
    if e: log(f"insert error: {e}"); return False
    return True

def upsert_status(rows):
    def _u(): return sb.table("node_status").upsert(rows).execute()
    _, e = retry(_u, DB_RETRY)
    if e: log(f"status error: {e}")

# =========================================================
# CAMERA WORKER (Core Engine)
# =========================================================
def run_camera(profile):
    cam_id = profile["camera_id"]
    video_source_raw = profile["video_source"]
    node_scope = str(profile.get("node_scope", "indoor")).lower()
    roi_cfg = profile["roi_json"]
    height_status = profile.get("height_status", "UNKNOWN") 
    
    validate_roi_json(roi_cfg)
    zones = roi_cfg["zones"]

    # [핵심 수정부] parse_video_source를 통해 정확한 타입과 값 추출
    src, src_type = parse_video_source(video_source_raw)
    log(f"[{cam_id}] Source: {src} ({src_type})")

    cap = open_capture(src, src_type)
    if cap is None:
        log(f"[{cam_id}] 비디오 열기 실패: {src}"); return

    model = YOLO(YOLO_MODEL)
    model.to(device)
    use_half = device.startswith("cuda")
    if use_half: model.model.half()

    w, h, masks = None, None, None
    smooth = defaultdict(lambda: deque(maxlen=max(1, SMOOTH_FRAMES)))
    stable, changed_at = {}, {}
    last_sent, last_heartbeat, last_sig = 0.0, 0.0, None
    fps_t, fps_n, fps = time.time(), 0, 0.0
    frame_idx = 0

    sensor_data = {"dist_up": 0.0, "dist_down": 0.0, "temp": 25.0} 

    log(f"[{cam_id}] START ({height_status} MODE)")

    try:
        while True:
            # 1. UDP 데이터 수신 (Non-blocking)
            try:
                data, addr = bridge_sock.recvfrom(1024)
                msg = data.decode().strip()
                parts = dict(item.split(":") for item in msg.split(","))
                
                if "D_UP" in parts: sensor_data["dist_up"] = float(parts["D_UP"])
                if "D_DOWN" in parts: sensor_data["dist_down"] = float(parts["D_DOWN"])
                if "T" in parts: sensor_data["temp"] = float(parts["T"])
            except (BlockingIOError, ValueError, KeyError):
                pass 
            except Exception as e:
                log(f"[{cam_id}] UDP Parse Error: {e}")

            ret, frame = cap.read()
            if not ret or frame is None:
                if src_type == "file":
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0); continue
                log(f"[{cam_id}] reconnecting..."); cap.release(); time.sleep(1.0)
                cap = open_capture(src, src_type); continue

            if w is None:
                h, w = frame.shape[:2]
                masks = build_masks(zones, w, h)
                for z in zones:
                    zid = str(z["id"])
                    stable[zid], changed_at[zid] = "LOW", 0.0
                dummy = np.zeros((INFER_H, INFER_W, 3), dtype=np.uint8)
                model.predict(source=dummy, conf=CONF_THRESH, iou=IOU_THRESH, imgsz=INFER_W, device=device, half=use_half, verbose=False)

            frame_idx += 1
            if FRAME_SKIP > 1 and (frame_idx % FRAME_SKIP != 0): continue

            small = cv2.resize(frame, (INFER_W, INFER_H), interpolation=cv2.INTER_AREA)
            result = model.predict(source=small, conf=CONF_THRESH, iou=IOU_THRESH, imgsz=INFER_W, device=device, half=use_half, verbose=False)[0]

            sx, sy = w / INFER_W, h / INFER_H
            centers = []
            for b in result.boxes:
                if int(b.cls[0].item()) != 0: continue
                x1, y1, x2, y2 = b.xyxy[0].tolist()
                x1, y1, x2, y2 = int(x1*sx), int(y1*sy), int(x2*sx), int(y2*sy)
                cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
                if 0 <= cx < w and 0 <= cy < h: centers.append((cx, cy))
                if SHOW_WINDOW: cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 220, 0), 2)

            now = time.time()
            iso = now_iso()
            events, status_rows = [], []

            for z in zones:
                zid = str(z["id"])
                low_lt, mid_lt = int(z.get("low_lt", 3)), int(z.get("mid_lt", 7))
                capc = float(z.get("capacity", 10))
                if mid_lt <= low_lt: mid_lt = low_lt + 1

                cnt = sum(1 for cx, cy in centers if masks[zid][cy, cx] == 1)
                smooth[zid].append(cnt)
                c = int(round(sum(smooth[zid]) / len(smooth[zid])))
                
                if height_status == 'MEASURED':
                    total_h = sensor_data["dist_up"] + sensor_data["dist_down"]
                    if total_h > 0:
                        dynamic_capc = capc * (total_h / 3.0) 
                        ratio = min(c / dynamic_capc, 1.0)
                    else:
                        ratio = min(c / capc, 1.0)
                else:
                    ratio = min(c / capc, 1.0)

                cand = level_from_count(c, low_lt, mid_lt)
                if cand != stable[zid]:
                    if changed_at[zid] == 0: changed_at[zid] = now
                    elif (now - changed_at[zid] >= SETTLE_SEC):
                        stable[zid], changed_at[zid] = cand, 0.0
                else: 
                    changed_at[zid] = 0.0

                events.append({
                    "node_id": int(zid), "node_scope": node_scope, "occupancy_ratio": ratio,
                    "congestion_level": stable[zid], "people_count": c, "camera_angle": 0,
                    "roi_id": zid, "captured_at": iso, "raw_meta": {
                        "camera_id": cam_id, 
                        "fps": round(fps, 2),
                        "mode": height_status,
                        "dist_total": sensor_data["dist_up"] + sensor_data["dist_down"]
                    }
                })
                status_rows.append({
                    "node_id": int(zid), "node_scope": node_scope, "last_occupancy_ratio": ratio,
                    "last_congestion_level": stable[zid], "last_people_count": c, "last_camera_angle": 0,
                    "last_roi_id": zid, "updated_at": iso
                })

                if SHOW_WINDOW:
                    pts = np.array([[int(px*w/ROI_BASE_W), int(py*h/ROI_BASE_H)] for px, py in z["points"]], dtype=np.int32)
                    cv2.polylines(frame, [pts], True, (255, 80, 80), 2)
                    cv2.putText(frame, f"id:{zid} c:{c} {stable[zid]}", (pts[0][0], max(22, pts[0][1]-6)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 80, 80), 2)

            sig = tuple((e["node_id"], e["people_count"], e["congestion_level"]) for e in events)
            due_send = ((now - last_sent) >= SEND_INTERVAL_SEC) and (sig != last_sig)
            due_hb = (now - last_heartbeat >= HEARTBEAT_SEC)

            if events and (due_send or due_hb):
                ok = insert_events(events)
                if ok and UPDATE_NODE_STATUS: upsert_status(status_rows)

                if ok:
                    last_sig, last_sent, last_heartbeat = sig, now, now
                    for e in events:
                        udp_msg = f"P:{e['people_count']},T:{sensor_data['temp']},L:{e['congestion_level']},D_UP:{sensor_data['dist_up']},D_DOWN:{sensor_data['dist_down']}"
                        try:
                            bridge_sock.sendto(udp_msg.encode(), (CONTROL_BRIDGE_IP, CONTROL_BRIDGE_PORT))
                        except Exception:
                            pass

            fps_n += 1
            if now - fps_t >= 1.0:
                fps = fps_n / (now - fps_t); fps_t = now; fps_n = 0
            if SHOW_WINDOW:
                cv2.putText(frame, f"{cam_id} | FPS:{fps:.1f} | MODE:{height_status}", (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (40, 220, 255), 2)
                cv2.imshow(f"frame-{cam_id}", frame)
                cv2.waitKey(1)

    finally:
        cap.release()

# =========================================================
# MAIN
# =========================================================
if __name__ == "__main__":
    profiles = load_camera_profiles()
    threads = []
    log(f"ACTIVE CAMERAS: {len(profiles)}")

    for profile in profiles:
        t = threading.Thread(target=run_camera, args=(profile,), daemon=True)
        t.start()
        threads.append(t)
        log(f"THREAD START: {profile['camera_id']} (Status: {profile.get('height_status', 'UNKNOWN')})")

    while True:
        time.sleep(1)

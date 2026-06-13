"""Single-camera 2D spatial analysis and bird's-eye-view streaming service."""

from __future__ import annotations

import argparse
import base64
import json
import math
import threading
import time
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from ultralytics import YOLO


BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "spatial_topview_config.json"


def load_config() -> dict[str, Any]:
    defaults = {
        "video_source": "0",
        "model_path": "../yolov8n.pt",
        "confidence": 0.35,
        "output_width": 720,
        "output_height": 480,
        "space_width_m": 12.0,
        "space_height_m": 8.0,
        "source_points": [],
    }
    if CONFIG_PATH.exists():
        defaults.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    return defaults


def save_config(config: dict[str, Any]) -> None:
    CONFIG_PATH.write_text(
        json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def parse_source(value: str) -> int | str:
    value = str(value).strip()
    return int(value) if value.isdigit() else value


def decode_data_url(data_url: str) -> np.ndarray:
    encoded = data_url.split(",", 1)[1] if "," in data_url else data_url
    raw = base64.b64decode(encoded)
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Unable to decode one of the uploaded images")
    return image


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def detect_depth_sensor() -> dict[str, Any]:
    try:
        import pyrealsense2 as rs

        devices = rs.context().query_devices()
        if len(devices) > 0:
            names = [device.get_info(rs.camera_info.name) for device in devices]
            return {
                "available": True,
                "active": False,
                "mode": "depth",
                "devices": names,
                "confirmation_required": False,
            }
    except (ImportError, RuntimeError):
        pass
    return {
        "available": False,
        "active": False,
        "mode": "monocular",
        "devices": [],
        "confirmation_required": True,
    }


class SpatialEngine:
    def __init__(self) -> None:
        self.config = load_config()
        model_path = Path(self.config["model_path"])
        if not model_path.is_absolute():
            model_path = (BASE_DIR / model_path).resolve()
        self.model = YOLO(str(model_path))
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.capture: cv2.VideoCapture | None = None
        self.depth_pipeline = None
        self.depth_align = None
        self.depth_frame = None
        self.depth_intrinsics = None
        self.rs = None
        self.worker: threading.Thread | None = None
        self.source_jpeg: bytes | None = None
        self.topview_jpeg: bytes | None = None
        self.frame_size = [0, 0]
        self.people_count = 0
        self.fps = 0.0
        self.last_error = ""
        self.last_frame_at = ""
        self.last_frame_monotonic = 0.0
        self.depth_sensor = detect_depth_sensor()
        self.trails: dict[int, deque[tuple[int, int]]] = {}

    def start(self) -> None:
        if self.worker and self.worker.is_alive():
            return
        self.stop_event.clear()
        self.worker = threading.Thread(target=self._run, daemon=True)
        self.worker.start()

    def restart_capture(self) -> None:
        with self.lock:
            if self.capture and hasattr(self.capture, "release"):
                self.capture.release()
            if self.depth_pipeline:
                try:
                    self.depth_pipeline.stop()
                except RuntimeError:
                    pass
            self.depth_pipeline = None
            self.depth_align = None
            self.depth_frame = None
            self.depth_intrinsics = None
            self.depth_sensor["active"] = False
            self.capture = None
            self.trails.clear()

    def update_config(self, incoming: dict[str, Any]) -> None:
        required = {
            "video_source",
            "confidence",
            "output_width",
            "output_height",
            "space_width_m",
            "space_height_m",
            "source_points",
        }
        if not required.issubset(incoming):
            raise ValueError("Missing one or more required configuration fields")
        points = incoming["source_points"]
        if points and len(points) != 4:
            raise ValueError("source_points must be empty or contain exactly four points")
        if not 0.05 <= float(incoming["confidence"]) <= 1.0:
            raise ValueError("confidence must be between 0.05 and 1.0")
        if not 320 <= int(incoming["output_width"]) <= 1920:
            raise ValueError("output_width must be between 320 and 1920")
        if not 240 <= int(incoming["output_height"]) <= 1080:
            raise ValueError("output_height must be between 240 and 1080")
        if float(incoming["space_width_m"]) <= 0 or float(incoming["space_height_m"]) <= 0:
            raise ValueError("space dimensions must be greater than zero")
        validated = {
            "video_source": str(incoming["video_source"]),
            "confidence": float(incoming["confidence"]),
            "output_width": int(incoming["output_width"]),
            "output_height": int(incoming["output_height"]),
            "space_width_m": float(incoming["space_width_m"]),
            "space_height_m": float(incoming["space_height_m"]),
            "source_points": [
                [float(point[0]), float(point[1])] for point in points
            ],
        }
        with self.lock:
            model_path = self.config["model_path"]
            self.config = {**validated, "model_path": model_path}
            save_config(self.config)
        self.restart_capture()

    def status(self) -> dict[str, Any]:
        with self.lock:
            frame_age = (
                time.monotonic() - self.last_frame_monotonic
                if self.last_frame_monotonic
                else None
            )
            return {
                "running": bool(self.worker and self.worker.is_alive()),
                "camera_online": frame_age is not None and frame_age <= 3.0,
                "analysis_active": frame_age is not None and frame_age <= 3.0,
                "last_frame_at": self.last_frame_at or None,
                "frame_age_sec": round(frame_age, 2) if frame_age is not None else None,
                "people_count": self.people_count,
                "fps": round(self.fps, 1),
                "frame_size": self.frame_size,
                "calibrated": len(self.config.get("source_points", [])) == 4,
                "last_error": self.last_error,
                "depth_sensor": self.depth_sensor,
                "config": self.config,
            }

    def create_obstacle_draft(
        self, images: list[dict[str, Any]], plan_width: int, plan_height: int
    ) -> dict[str, Any]:
        if len(images) < 2:
            raise ValueError("At least two room images are required")
        if len(images) > 12:
            raise ValueError("A maximum of 12 images can be processed at once")

        ignored_classes = {"person", "bird", "cat", "dog"}
        candidates: list[dict[str, Any]] = []
        total = len(images)

        for image_index, item in enumerate(images):
            frame = decode_data_url(str(item.get("data_url", "")))
            frame_height, frame_width = frame.shape[:2]
            angle = float(item.get("angle", image_index * 360 / total))
            result = self.model.predict(
                frame,
                conf=max(0.2, float(self.config["confidence"])),
                verbose=False,
            )[0]

            for box_index, box in enumerate(result.boxes):
                class_id = int(box.cls[0].item())
                label = str(self.model.names[class_id])
                if label in ignored_classes:
                    continue
                confidence = float(box.conf[0].item())
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                center_x = ((x1 + x2) / 2) / frame_width
                foot_y = min(1.0, y2 / frame_height)

                # A perspective-based draft only: lower detections are nearer to
                # the camera; horizontal image position offsets the bearing.
                depth = 0.12 + (1.0 - foot_y) * 0.72
                bearing = math.radians(angle + (center_x - 0.5) * 70)
                center_plan_x = plan_width / 2 + math.sin(bearing) * depth * plan_width / 2
                center_plan_y = plan_height / 2 - math.cos(bearing) * depth * plan_height / 2
                size_ratio = max(0.025, min(0.14, (x2 - x1) / frame_width * 0.18))
                half_width = plan_width * size_ratio
                half_height = plan_height * size_ratio
                polygon = [
                    [max(0, center_plan_x - half_width), max(0, center_plan_y - half_height)],
                    [min(plan_width, center_plan_x + half_width), max(0, center_plan_y - half_height)],
                    [min(plan_width, center_plan_x + half_width), min(plan_height, center_plan_y + half_height)],
                    [max(0, center_plan_x - half_width), min(plan_height, center_plan_y + half_height)],
                ]
                candidates.append(
                    {
                        "id": f"{image_index + 1}-{box_index + 1}",
                        "label": label,
                        "confidence": round(confidence, 3),
                        "source_image": str(item.get("name", f"image-{image_index + 1}")),
                        "view_angle": angle,
                        "polygon": polygon,
                        "enabled": True,
                    }
                )

        return {
            "plan_width": plan_width,
            "plan_height": plan_height,
            "method": "multi-view-object-draft",
            "warning": "Draft coordinates require review because monocular photos do not provide absolute depth.",
            "candidates": candidates,
        }

    def _open_capture(self) -> Any:
        source = parse_source(self.config["video_source"])
        if self.depth_sensor["available"] and isinstance(source, int):
            import pyrealsense2 as rs

            pipeline = rs.pipeline()
            pipeline_config = rs.config()
            pipeline_config.enable_stream(rs.stream.depth, 640, 480, rs.format.z16, 30)
            pipeline_config.enable_stream(rs.stream.color, 640, 480, rs.format.bgr8, 30)
            pipeline.start(pipeline_config)
            self.rs = rs
            self.depth_pipeline = pipeline
            self.depth_align = rs.align(rs.stream.color)
            self.depth_sensor["active"] = True
            self.depth_sensor["confirmation_required"] = False
            return pipeline
        if self.depth_sensor["available"]:
            self.depth_sensor["active"] = False
            self.depth_sensor["confirmation_required"] = True
        capture = cv2.VideoCapture(source)
        if not capture.isOpened():
            raise RuntimeError(f"Unable to open video source: {source}")
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return capture

    def _read_frame(self) -> tuple[bool, np.ndarray | None]:
        if self.depth_pipeline:
            frames = self.depth_pipeline.wait_for_frames(timeout_ms=3000)
            aligned = self.depth_align.process(frames)
            color_frame = aligned.get_color_frame()
            depth_frame = aligned.get_depth_frame()
            if not color_frame or not depth_frame:
                return False, None
            self.depth_frame = depth_frame
            self.depth_intrinsics = depth_frame.profile.as_video_stream_profile().intrinsics
            return True, np.asanyarray(color_frame.get_data())
        return self.capture.read()

    def _homography(self) -> np.ndarray | None:
        points = self.config.get("source_points", [])
        if len(points) != 4:
            return None
        width = int(self.config["output_width"])
        height = int(self.config["output_height"])
        src = np.asarray(points, dtype=np.float32)
        dst = np.asarray(
            [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
            dtype=np.float32,
        )
        return cv2.getPerspectiveTransform(src, dst)

    @staticmethod
    def _encode(frame: np.ndarray) -> bytes | None:
        ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 82])
        return encoded.tobytes() if ok else None

    def _draw_grid(self, canvas: np.ndarray) -> None:
        height, width = canvas.shape[:2]
        for index in range(1, 12):
            x = round(width * index / 12)
            cv2.line(canvas, (x, 0), (x, height), (43, 61, 81), 1)
        for index in range(1, 8):
            y = round(height * index / 8)
            cv2.line(canvas, (0, y), (width, y), (43, 61, 81), 1)
        cv2.rectangle(canvas, (0, 0), (width - 1, height - 1), (71, 118, 230), 2)

    def _run(self) -> None:
        frame_counter = 0
        fps_started = time.perf_counter()
        while not self.stop_event.is_set():
            try:
                if self.capture is None:
                    self.capture = self._open_capture()
                    self.last_error = ""

                ok, frame = self._read_frame()
                if not ok:
                    self.restart_capture()
                    time.sleep(1)
                    continue

                frame_height, frame_width = frame.shape[:2]
                result = self.model.track(
                    frame,
                    persist=True,
                    classes=[0],
                    conf=float(self.config["confidence"]),
                    verbose=False,
                )[0]
                homography = self._homography()
                top_height = int(self.config["output_height"])
                top_width = int(self.config["output_width"])
                topview = np.full((top_height, top_width, 3), (18, 29, 43), np.uint8)
                self._draw_grid(topview)

                active_ids: set[int] = set()
                detections = 0
                boxes = result.boxes
                if boxes is not None:
                    ids = boxes.id.int().cpu().tolist() if boxes.id is not None else []
                    for index, box in enumerate(boxes.xyxy.cpu().numpy()):
                        x1, y1, x2, y2 = map(int, box)
                        foot = np.asarray([[[float((x1 + x2) / 2), float(y2)]]], np.float32)
                        track_id = ids[index] if index < len(ids) else index + 1
                        active_ids.add(track_id)
                        detections += 1
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (52, 211, 153), 2)
                        cv2.circle(frame, tuple(foot[0, 0].astype(int)), 5, (46, 164, 255), -1)
                        cv2.putText(
                            frame,
                            f"ID {track_id}",
                            (x1, max(22, y1 - 7)),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.55,
                            (255, 255, 255),
                            2,
                        )

                        px = py = -1
                        if self.depth_frame is not None and self.depth_intrinsics is not None:
                            depth_m = self.depth_frame.get_distance(
                                max(0, min(frame_width - 1, int(foot[0, 0, 0]))),
                                max(0, min(frame_height - 1, int(foot[0, 0, 1]))),
                            )
                            if depth_m > 0:
                                point_3d = self.rs.rs2_deproject_pixel_to_point(
                                    self.depth_intrinsics,
                                    [float(foot[0, 0, 0]), float(foot[0, 0, 1])],
                                    depth_m,
                                )
                                width_m = float(self.config["space_width_m"])
                                height_m = float(self.config["space_height_m"])
                                px = int(top_width / 2 + point_3d[0] / width_m * top_width)
                                py = int(top_height - point_3d[2] / height_m * top_height)
                        elif homography is not None:
                            projected = cv2.perspectiveTransform(foot, homography)[0, 0]
                            px, py = map(int, projected)
                        if 0 <= px < top_width and 0 <= py < top_height:
                            trail = self.trails.setdefault(track_id, deque(maxlen=30))
                            trail.append((px, py))
                            if len(trail) > 1:
                                cv2.polylines(
                                    topview,
                                    [np.asarray(trail, np.int32)],
                                    False,
                                    (46, 164, 255),
                                    2,
                                )
                            cv2.circle(topview, (px, py), 13, (52, 211, 153), -1)
                            cv2.circle(topview, (px, py), 13, (255, 255, 255), 2)
                            cv2.putText(
                                topview,
                                str(track_id),
                                (px - 8, py + 5),
                                cv2.FONT_HERSHEY_SIMPLEX,
                                0.45,
                                (8, 20, 30),
                                2,
                            )

                for track_id in list(self.trails):
                    if track_id not in active_ids:
                        del self.trails[track_id]

                if homography is None and not self.depth_sensor["active"]:
                    cv2.putText(
                        topview,
                        "Select four floor points to calibrate",
                        (35, top_height // 2),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.7,
                        (120, 150, 180),
                        2,
                    )
                else:
                    width_m = float(self.config["space_width_m"])
                    height_m = float(self.config["space_height_m"])
                    cv2.putText(
                        topview,
                        f"{width_m:.1f} m x {height_m:.1f} m",
                        (18, 30),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.65,
                        (255, 255, 255),
                        2,
                    )

                points = self.config.get("source_points", [])
                if points:
                    polygon = np.asarray(points, np.int32)
                    cv2.polylines(frame, [polygon], len(points) == 4, (46, 164, 255), 3)
                    for index, point in enumerate(polygon):
                        cv2.circle(frame, tuple(point), 8, (71, 118, 230), -1)
                        cv2.putText(
                            frame,
                            str(index + 1),
                            (int(point[0]) + 10, int(point[1]) - 8),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.6,
                            (255, 255, 255),
                            2,
                        )

                frame_counter += 1
                elapsed = time.perf_counter() - fps_started
                if elapsed >= 1:
                    measured_fps = frame_counter / elapsed
                    frame_counter = 0
                    fps_started = time.perf_counter()
                else:
                    measured_fps = self.fps

                source_jpeg = self._encode(frame)
                topview_jpeg = self._encode(topview)
                with self.lock:
                    self.source_jpeg = source_jpeg
                    self.topview_jpeg = topview_jpeg
                    self.frame_size = [frame_width, frame_height]
                    self.people_count = detections
                    self.fps = measured_fps
                    self.last_frame_at = utc_now_iso()
                    self.last_frame_monotonic = time.monotonic()
            except Exception as error:
                with self.lock:
                    self.last_error = str(error)
                self.restart_capture()
                time.sleep(2)

    def mjpeg(self, view: str):
        while True:
            with self.lock:
                frame = self.source_jpeg if view == "source" else self.topview_jpeg
            if frame:
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
            time.sleep(0.04)


engine = SpatialEngine()


class SpatialRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, message_format: str, *args: Any) -> None:
        print(f"[HTTP] {self.address_string()} {message_format % args}")

    def _cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            self._send_json(engine.status())
            return
        if path in {"/stream/source", "/stream/topview"}:
            view = "source" if path.endswith("source") else "topview"
            self.send_response(200)
            self.send_header(
                "Content-Type", "multipart/x-mixed-replace; boundary=frame"
            )
            self.send_header("Cache-Control", "no-store")
            self._cors_headers()
            self.end_headers()
            try:
                for frame in engine.mjpeg(view):
                    self.wfile.write(frame)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        self._send_json({"error": "Not found"}, 404)

    def do_PUT(self) -> None:
        path = self.path.split("?", 1)[0]
        if path != "/api/config":
            self._send_json({"error": "Not found"}, 404)
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            engine.update_config(payload)
            self._send_json(engine.status())
        except (ValueError, TypeError, KeyError, IndexError, json.JSONDecodeError) as error:
            self._send_json({"error": str(error)}, 400)

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path != "/api/indoor/obstacle-draft":
            self._send_json({"error": "Not found"}, 404)
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            result = engine.create_obstacle_draft(
                payload.get("images", []),
                int(payload.get("plan_width", 1000)),
                int(payload.get("plan_height", 1000)),
            )
            self._send_json(result)
        except (
            ValueError,
            TypeError,
            KeyError,
            IndexError,
            json.JSONDecodeError,
            base64.binascii.Error,
        ) as error:
            self._send_json({"error": str(error)}, 400)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    engine.start()
    server = ThreadingHTTPServer((args.host, args.port), SpatialRequestHandler)
    print(f"Spatial 2D service listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        engine.stop_event.set()
        server.server_close()

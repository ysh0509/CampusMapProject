# Single-camera Spatial 2D

This service detects people in one camera feed and projects each person's
floor-contact point into a calibrated bird's-eye-view plane.
It uses Python's standard HTTP server, so no additional web framework is
required beyond the existing OpenCV and Ultralytics environment.

## Run

From the project root:

```powershell
.\vision\.venv\Scripts\python.exe .\vision\spatial_topview.py
```

Then serve the project's static files and open:

```text
/html/admin/admin_spatial_analysis.html
```

The page expects the analysis API at `http://127.0.0.1:8765`.

## Calibration

Click four floor points on the source image in this order:

1. Top-left
2. Top-right
3. Bottom-right
4. Bottom-left

Enter the real floor width and height in metres, then save. Detection positions
and trails are projected onto the 2D plane. This homography assumes people walk
on one approximately flat floor plane.

## Indoor multi-view obstacle draft

Open:

```text
/html/admin/indoor/admin_indoor_reconstruction.html
```

Select an existing Indoor building and floor, then upload photos captured in
order while turning around the room. The service assigns the photos evenly from
0 to 360 degrees, detects non-person objects, and places obstacle candidates on
the floor plan for review.

Before saving obstacle maps, apply:

```text
sql/indoor_spatial_schema.sql
```

For scale calibration, select two points on the floor plan whose real distance
is known and enter that one measured length. The resulting pixels-per-metre
value is saved to `floors.scale` and is shared by Indoor nodes and edges.

The generated obstacle coordinates are a draft, not a metric 3D
reconstruction. Monocular photos do not contain reliable absolute depth, so
candidates must be reviewed on the floor plan before confirmation.

Each Indoor space is keyed by `navigation_elements.id`. This lets one identifier
connect the original Indoor node or edge, `camera_node_map.node_status_id`,
`node_status.node_id`, obstacle data, and the live monitoring page.

Photo mode remains available when no camera is connected. Live mode is enabled
only while the Python service has received a camera frame within the last three
seconds.

When an aligned RealSense color/depth stream is available, person foot points
are deprojected into metric 3D coordinates automatically. A depth device that
cannot be aligned with the selected RGB source, or a system without depth, is
treated as monocular and requires an explicit confirmation.

`HIGH` congestion from `node_status` is shown as a real-time monitoring alert.
If the camera is online, the operator is directed to inspect the source and
top-view streams. If it is offline, the alert asks for a camera or field check.

## Floor-plan and room coordinates

The existing Indoor editor stores Leaflet Simple CRS coordinates with the
vertical origin at the bottom. The reconstruction page uses an SVG/image
coordinate system with its origin at the top. It renders existing nodes and
edges with `svgY = 1000 - indoorNode.y`; the original routing coordinates are
not modified.

The uploaded `floors.map_image_url` remains the floor-level 2D base. A doorway
node is only a routing and entrance point. The actual room is stored separately
in `indoor_room_spaces` as a polygon and linked to the doorway through
`entrance_navigation_element_id`. Obstacle drafts can then be attached to that
room using `indoor_obstacle_maps.room_space_id`.

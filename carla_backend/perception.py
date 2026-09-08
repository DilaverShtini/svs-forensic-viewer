import math
from carla_backend.config import TRACKING_THRESHOLD_M
import numpy as np

class RadarPerception:
    def __init__(self, eps_m=3.0, min_points=2):
        self.eps = eps_m
        self.min_points = min_points
        self.detected_clusters_local = []
        self.persistent_tracks = {}
        self.next_track_id = 0

    def update(self, raw_radar_data):
        points = []
        for det in raw_radar_data:
            x = det.depth * math.cos(det.azimuth) * math.cos(det.altitude)
            y = det.depth * math.sin(det.azimuth) * math.cos(det.altitude)
            z = det.depth * math.sin(det.altitude)

            if -1.0 < z < 2.0:
                points.append(np.array([x, y]))

        if len(points) < self.min_points:
            self.detected_clusters_local = []
            return

        pts = np.array(points)
        clusters = []
        visited = set()
        
        for i, p in enumerate(pts):
            if i in visited: continue
            dists = np.linalg.norm(pts - p, axis=1)
            neighbors = np.where(dists < self.eps)[0]
            
            if len(neighbors) >= self.min_points:
                visited.update(neighbors)
                cluster_pts = pts[neighbors]
                
                cx = np.mean(cluster_pts[:, 0])
                cy = np.mean(cluster_pts[:, 1])
                
                length = np.ptp(cluster_pts[:, 0])
                width = np.ptp(cluster_pts[:, 1])
                
                length = max(length, 0.8)
                width = max(width, 0.8)
                
                clusters.append((cx, cy, width, length))
                
        self.detected_clusters_local = clusters

    def get_tracked_targets(self, ego_tf):
        def local_to_global(lx, ly):
            yaw = math.radians(ego_tf.rotation.yaw)
            lx_compensated = lx + 2.7
            gx = ego_tf.location.x + lx_compensated * math.cos(yaw) - ly * math.sin(yaw)
            gy = ego_tf.location.y + lx_compensated * math.sin(yaw) + ly * math.cos(yaw)
            return gx, gy

        radar_clusters_global = [
            (local_to_global(cx, cy), w, l) 
            for cx, cy, w, l in self.detected_clusters_local
        ]

        unmatched_clusters = list(radar_clusters_global)
        new_tracks = {}
        current_actors = []

        for track_id, last_pos in self.persistent_tracks.items():
            best_match = None
            best_dist = TRACKING_THRESHOLD_M

            for cluster in unmatched_clusters:
                (gx, gy), w, l = cluster
                dist = math.hypot(gx - last_pos[0], gy - last_pos[1])
                if dist < best_dist:
                    best_dist = dist
                    best_match = cluster

            if best_match:
                (gx, gy), w, l = best_match
                new_tracks[track_id] = (gx, gy)
                unmatched_clusters.remove(best_match)
                current_actors.append({
                    "id": f"radar_target_{track_id}",
                    "x": round(gx, 2),
                    "y": round(gy, 2),
                    "w": round(w, 2),
                    "l": round(l, 2)
                })

        for cluster in unmatched_clusters:
            (gx, gy), w, l = cluster
            new_tracks[self.next_track_id] = (gx, gy)
            current_actors.append({
                "id": f"radar_target_{self.next_track_id}",
                "x": round(gx, 2),
                "y": round(gy, 2),
                "w": round(w, 2),
                "l": round(l, 2)
            })
            self.next_track_id += 1

        self.persistent_tracks = new_tracks
        return current_actors

class FrontRadarTracker:
    def __init__(self, azimuth_limit_deg=40.0, altitude_limit_deg=4.0, min_depth_m=0.2):
        self.min_depth_m = min_depth_m
        self.distance_m = None
        self.closing_speed_mps = None
        self.ttc_s = None
        self.front_count = 0

    # Update the tracker with new radar points
    def update(self, filtered_radar_points):
        self.front_count = len(filtered_radar_points)

        if not filtered_radar_points:
            self.distance_m = None
            self.closing_speed_mps = None
            self.ttc_s = None
            return

        depths = np.array([p["x"] for p in filtered_radar_points if p["x"] >= self.min_depth_m], dtype=np.float32)
        velocities = np.array([abs(p["rel_velocity"]) for p in filtered_radar_points if p["x"] >= self.min_depth_m], dtype=np.float32)

        if len(depths) == 0:
            self.distance_m = None
            self.closing_speed_mps = None
            self.ttc_s = None
            return

        d_raw = float(np.percentile(depths, 15))
        v_raw = float(np.median(velocities))

        if self.distance_m is None:
            self.distance_m = d_raw
        else:
            self.distance_m = 0.78 * self.distance_m + 0.22 * d_raw

        if self.closing_speed_mps is None:
            self.closing_speed_mps = v_raw
        else:
            self.closing_speed_mps = 0.70 * self.closing_speed_mps + 0.30 * v_raw

        if self.closing_speed_mps > 0.25:
            self.ttc_s = self.distance_m / self.closing_speed_mps
        else:
            self.ttc_s = float("inf")

# Filter radar detections to only include those within the lane boundaries, depth and height
def filter_detections_in_lane(radar_data, half_lane_width=1.75, sensor_height_m=1.2, max_depth_m=100.0):
    filtered_points = []
    for det in radar_data:
        x_front = det.depth * math.cos(det.azimuth) * math.cos(det.altitude)
        if x_front > max_depth_m:
            continue

        y_lateral = det.depth * math.sin(det.azimuth) * math.cos(det.altitude)
        z_height = det.depth * math.sin(det.altitude)

        if z_height < -(sensor_height_m - 0.2) or z_height > 1.0:
            continue

        if abs(y_lateral) <= half_lane_width:
            filtered_points.append({
                "x": x_front,
                "y": y_lateral,
                "z": z_height,
                "rel_velocity": det.velocity
            })
    return filtered_points

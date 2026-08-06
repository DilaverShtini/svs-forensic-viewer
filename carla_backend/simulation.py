import carla
import math
import random
import time
import numpy as np
import os
import json
import threading
import queue as image_queue_module
import paho.mqtt.client as mqtt
import ssl
import shutil

# Connect to the CARLA server
client = carla.Client("localhost", 2000)
client.set_timeout(10.0)
world = client.get_world()

traffic_manager = client.get_trafficmanager(8000)
traffic_manager.set_synchronous_mode(True)

original_settings = world.get_settings()
settings = world.get_settings()
settings.synchronous_mode = True
settings.fixed_delta_seconds = 0.05
settings.substepping = True
settings.max_substep_delta_time = 0.01
settings.max_substeps = 10
settings.no_rendering_mode = False
world.apply_settings(settings)


# Clear any existing actors from the world
for _ in range(2):
    actors_to_destroy = []
    actors_to_destroy.extend(world.get_actors().filter('sensor.*'))   
    actors_to_destroy.extend(world.get_actors().filter('vehicle.*'))
    actors_to_destroy.extend(world.get_actors().filter('walker.*'))
    
    for actor in actors_to_destroy:
        if actor is not None and actor.is_alive:
            try:
                actor.destroy()
            except RuntimeError:
                pass
            
    world.tick()
    world.tick()

time.sleep(0.5)

carla_map = world.get_map()
spectator = world.get_spectator()


# MQTT client setup
v2x_event     = threading.Event()
v2x_sent_flag = threading.Event()
v2x_time_sent = 0.0
NETWORK_DELAY = 1.5

unique_client_id = f"Tesla_Ego_{random.randint(10000, 99999)}"

mqtt_client = mqtt.Client(
    callback_api_version=mqtt.CallbackAPIVersion.VERSION2, 
    client_id=unique_client_id,
    transport="websockets"
)

if 'mqtt_client' in globals():
    try:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()
    except Exception:
        pass

# MQTT callback function
def on_mqtt_message(client, userdata, msg, properties = None):
    if msg.topic == "carla/svs/8/v2x/warning":
        if msg.payload.decode("utf-8") == "PEDESTRIAN_DETECTED":
            v2x_event.set()

mqtt_client.on_message = on_mqtt_message

mqtt_client.tls_set(cert_reqs=ssl.CERT_REQUIRED)
mqtt_client.on_message = on_mqtt_message

# Connect to the MQTT broker and subscribe to the topic
try:
    mqtt_client.connect("test.mosquitto.org", 8081, 60)
    mqtt_client.subscribe("carla/svs/8/v2x/warning")
    mqtt_client.loop_start()
    
    connection_timeout = 50
    while connection_timeout > 0:
        if mqtt_client.is_connected():
            break
        time.sleep(0.1)
        connection_timeout -= 1
        
    if mqtt_client.is_connected():
        print(f"Connected at test.mosquitto.org: {unique_client_id}")
    else:
        print("[WARN] Timeout MQTT — V2X simulated")
        
except Exception as e:
    print(f"Error MQTT: {e}. V2X simulated.")


# Safely destroy a list of actors
def safe_destroy(actors):
    for actor in actors:
        if actor is None:
            continue
        try:
            actor.destroy()
        except RuntimeError:
            pass

# Calculate the speed of a vehicle in km/h
def speed_kmh(vehicle):
    v = vehicle.get_velocity()
    return 3.6 * math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)

# Move the spectator camera to a position behind the given transform
def move_spectator_to(transform, spectator, distance=14.0, z=4.5, pitch=-16.0):
    yaw = math.radians(transform.rotation.yaw)
    back = carla.Location(x=-distance * math.cos(yaw), y=-distance * math.sin(yaw), z=z)
    spectator.set_transform(
        carla.Transform(
            transform.location + back,
            carla.Rotation(pitch=pitch, yaw=transform.rotation.yaw),
        )
    )

# Spawn a camera sensor attached to a vehicle
def spawn_camera(world, attach_to, transform):
    bp = world.get_blueprint_library().find('sensor.camera.rgb')
    bp.set_attribute('image_size_x', '800')
    bp.set_attribute('image_size_y', '600')
    
    bp.set_attribute('sensor_tick', '0.2') 

    if bp.has_attribute("role_name"):
        bp.set_attribute("role_name", "forensic_dashcam")
        
    return world.spawn_actor(bp, transform, attach_to=attach_to)

# Spawn a radar sensor attached to a vehicle
def spawn_radar(
    world,
    attach_to,
    transform,
    horizontal_fov=80.0,
    vertical_fov=5.0,
    points_per_second=10000,
    range_m=100.0,
    tick=0.05,
):
    bp = world.get_blueprint_library().find("sensor.other.radar")
    bp.set_attribute("horizontal_fov", str(horizontal_fov))
    bp.set_attribute("vertical_fov", str(vertical_fov))
    bp.set_attribute("points_per_second", str(points_per_second))
    bp.set_attribute("range", str(range_m))
    bp.set_attribute("sensor_tick", str(tick))
    if bp.has_attribute("role_name"):
        bp.set_attribute("role_name", "forensic_mrr_radar")
    return world.spawn_actor(bp, transform, attach_to=attach_to)


# Class to track the closest object detected by the radar
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


# Filter radar detections to only include those within the lane boundaries and within a certain height range
def filter_detections_in_lane(radar_data, half_lane_width=1.75, sensor_height_m=1.2):
    
    filtered_points = []
    
    for det in radar_data:
        x_front = det.depth * math.cos(det.azimuth) * math.cos(det.altitude)
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


# Class to log events and telemetry data for forensic analysis
class FastCausalLogger:
    def __init__(self):
        self.events = []
        self.telemetry = []

    # Log an event with its ID, simulation time, description, and causes
    def log_event(self, event_id, time_sim, description, causes):
        event = {
            "id": event_id,
            "t": round(time_sim, 2),
            "desc": description,
            "causes": causes  
        }
        self.events.append(event)
        return event_id

    # Log telemetry data for a given frame
    def log_telemetry(self, frame, time_sim, speed, brake, ego_tf, steer, actors_data, active_events=None):
        frame_data = {
            "f": frame,
            "t": round(time_sim, 2),
            "v": round(speed, 2),
            "b": round(brake, 2),
            "s": round(steer, 2),
            "e": {
                "x": round(ego_tf.location.x, 2),
                "y": round(ego_tf.location.y, 2),
                "yaw": round(ego_tf.rotation.yaw, 2)
            },
            "a": actors_data  
        }
        
        if active_events:
            frame_data["active"] = active_events
            
        self.telemetry.append(frame_data)

    # Save the logged events and telemetry data to a JSON file
    def save(self, filepath):
        with open(filepath, 'w') as f:
            json.dump({"events": self.events, "telemetry": self.telemetry}, f, indent=4)


actors = []
ego = None
target = None
radar = None
camera = None

# Simulation parameters
RADAR_PARAMS = {
    "horizontal_fov": 80.0,      
    "vertical_fov": 5.0,
    "points_per_second": 10000,  
    "range_m": 100.0,            
    "tick": 0.05,              
}

DURATION_SECONDS = 45.0
DT = world.get_settings().fixed_delta_seconds

CRUISE_SPEED_KMH = 30.0
CRUISE_THROTTLE = 0.50

SOFT_DIST_M = 5.0
HARD_DIST_M = 2.8
SOFT_TTC_S = 2.0
HARD_TTC_S = 1.0
AUDI_RESTART_TIME = 20.0

SOFT_TTC_S_OFF = 3.5 
SOFT_DIST_OFF  = 8.0 
HARD_DIST_OFF = 3.5 
HARD_TTC_S_OFF = 1.5

MAX_SWIVEL_DEG = 45.0

tracker = FrontRadarTracker(azimuth_limit_deg=40.0, altitude_limit_deg=4.0, min_depth_m=0.2)

v2x_event.clear()
v2x_sent_flag.clear()
v2x_time_sent = 0.0

# Initialize control variables
throttle            = 0.0
brake               = 0.0
hold_brake_mode     = False
audi_restarted      = False
hold_counter        = 0
dist_ped            = float('inf')
ped_triggered       = False
ped_fallen          = False
dist_dec_logged = False
soft_brake_logged = False
hard_brake_logged = False
v2x_logged          = False
hard_condition      = False
soft_condition      = False
save_queue          = None
saver_thread        = None
output_folder       = "forensic_viewer/dashcam_records"

logger = FastCausalLogger()
event_memory = {}

if os.path.exists(output_folder):
    shutil.rmtree(output_folder)

os.makedirs(output_folder, exist_ok=True)
LOG_INTERVAL = 4 
V2X_ACTIVE_DURATION = 5.0

try:
    spawn_tf = carla.Transform(
        carla.Location(x=-60.63, y=140.97, z=0.6),
        carla.Rotation(pitch=0.0, yaw=0.32, roll=0.0)
    )

    ego_bp = world.get_blueprint_library().find('vehicle.tesla.model3')
    ego = world.spawn_actor(ego_bp, spawn_tf)
    actors.append(ego)

    fwd = spawn_tf.get_forward_vector()
    side = spawn_tf.get_right_vector()

    van_loc = spawn_tf.location + fwd * 30.0 + side * 2.8 
    van_bp = world.get_blueprint_library().find('vehicle.volkswagen.t2')
    target = world.spawn_actor(van_bp, carla.Transform(van_loc + carla.Location(z=0.5), spawn_tf.rotation))
    actors.append(target)
    

    ped_spawn_loc = van_loc + fwd * 2.8 + side * 1.5
    ped_bp = world.get_blueprint_library().find('walker.pedestrian.0001')
    ped = world.spawn_actor(ped_bp, carla.Transform(ped_spawn_loc + carla.Location(z=1.0), spawn_tf.rotation))
    actors.append(ped)

    stopped_car_loc = spawn_tf.location + fwd * 70.0 + side * 0.0 
    stopped_car_bp = world.get_blueprint_library().find('vehicle.audi.tt')
    stopped_car = world.spawn_actor(stopped_car_bp, carla.Transform(stopped_car_loc + carla.Location(z=0.5), spawn_tf.rotation))
    actors.append(stopped_car)
    
    stopped_car.set_autopilot(False)
    stopped_car.apply_control(carla.VehicleControl(throttle=0.0, brake=1.0, hand_brake=True))

    radar_tf = carla.Transform(carla.Location(x=2.7, z=1.2))
    radar = spawn_radar(world, ego, radar_tf, **RADAR_PARAMS)
    actors.append(radar)

    radar_state = {"raw": 0, "filtered": 0}
    lane_width_state = {"value": 1.75,
                        "max_depth_m": 100.0,
                        "swivel_rad": 0.0}

    # Callback function to process radar measurements
    def on_radar(measurement):
        radar_state["raw"] = len(measurement)
        
        lane_points = filter_detections_in_lane(measurement, half_lane_width=lane_width_state["value"])
        
        current_max_depth = lane_width_state["max_depth_m"]
        depth_filtered_points = []
        
        for p in lane_points:
            if isinstance(p, dict):
                p_depth = p.get('depth', p.get('x', 0.0))
            else:
                p_depth = p.depth
            if p_depth <= current_max_depth:
                depth_filtered_points.append(p)
        
        radar_state["filtered"] = len(depth_filtered_points)
        tracker.update(depth_filtered_points)

    radar.listen(on_radar)

    cam_tf = carla.Transform(carla.Location(x=1.5, z=2.4), carla.Rotation(pitch=-5.0))
    camera = spawn_camera(world, ego, cam_tf)
    actors.append(camera)

    save_queue = image_queue_module.Queue(maxsize=100)

    # Worker thread to save images from the queue to disk
    def image_saver_worker():
        while True:
            item = save_queue.get()
            if item is None:
                save_queue.task_done()
                break
            image, path = item
            try:
                image.save_to_disk(path)
            except Exception as e:
                print(f"[ImageSaver] Saving error {path}: {e}")
            finally:
                save_queue.task_done()

    saver_thread = threading.Thread(target=image_saver_worker, daemon=False)
    saver_thread.start()

    total_steps = int(DURATION_SECONDS / DT)
    print_step = max(1, int(1.0 / DT))
    
    traffic_manager.ignore_vehicles_percentage(ego, 100.0)
    traffic_manager.ignore_walkers_percentage(ego, 100.0)
    traffic_manager.vehicle_percentage_speed_difference(ego, 2.0)

    ego.set_autopilot(True)
    autopilot_active    = True
    last_known_steer    = 0.0

    obstacles = [{"id": "van_volkswagen", "actor": target, "passed": False},
                 {"id": "car_audi", "actor": stopped_car, "passed": False}]

    for _ in range(20):
        world.tick()

    target_tf = target.get_transform()
    target_loc = target.get_location()

    camera_state = {"local_frame": 0}

    # Callback function to process camera images
    def on_camera(image):
        try:
            current_frame = camera_state["local_frame"]
            save_queue.put_nowait(
                (image, f'{output_folder}/frame_{current_frame:06d}.jpg')
            )
            camera_state["local_frame"] += 1
        except Exception as e:
            pass

    camera.listen(on_camera)

    # Main simulation loop
    for step in range(total_steps):

        time_sim_s = step * DT
        d = tracker.distance_m
        ttc = tracker.ttc_s
        v_kmh = speed_kmh(ego)
        current_frame_events = []

        ego_loc = ego.get_location()
        ped_current_loc = ped.get_location()

        raw_steer = ego.get_control().steer
        steer_abs = abs(raw_steer)
        
        if steer_abs > 0.04:
            dynamic_width = 1.50 - (steer_abs * 3.5)
            dynamic_depth = 60.0 - (steer_abs * 95.0) 
            swivel_deg = raw_steer * MAX_SWIVEL_DEG 
        else:
            dynamic_width = 1.75
            dynamic_depth = 100.0
            swivel_deg = 0.0

        lane_width_state["value"] = float(np.clip(dynamic_width, 0.6, 1.75))
        lane_width_state["max_depth_m"]  = float(np.clip(dynamic_depth, 15.0, 100.0))
        lane_width_state["swivel_rad"]   = math.radians(swivel_deg)

        for obs in obstacles:
            if not obs["passed"]:
                ego_to_obs = obs["actor"].get_location() - ego_loc
                longitudinal = ego_to_obs.x * fwd.x + ego_to_obs.y * fwd.y
                if longitudinal < -3.0:
                    obs["passed"] = True

        active_obstacle = next((o for o in obstacles if not o["passed"]), None)

        if active_obstacle:
            current_target_id = active_obstacle["id"]
            current_target_loc = active_obstacle["actor"].get_location()
            dist_active_target = ego_loc.distance(current_target_loc)
        else:
            current_target_id = "None"
            current_target_loc = None
            dist_active_target = float('inf')

        dist_ped = ego_loc.distance(ped_current_loc)

        # Pedestrian crossing logic
        if dist_ped < 15.0 and dist_ped > 1.0 and not ped_triggered:
            cross_dir = side * -1.0
            cross_dir.z = 0.0
            control = carla.WalkerControl(direction=cross_dir, speed=3.5)
            ped.apply_control(control)
            ped_triggered = True

            evt_id1 = "e_ped_cross"
            logger.log_event(evt_id1, time_sim_s, "Pedestrian enters the street in front of the van", [])
            event_memory["ped_cross"] = evt_id1
            current_frame_events.append(evt_id1)

            # V2X message sending logic
            if not v2x_sent_flag.is_set():
                published = False
                try:
                    mqtt_client.publish("carla/svs/8/v2x/warning", "PEDESTRIAN_DETECTED")
                    published = True
                except Exception:
                    pass
                if published:
                    v2x_sent_flag.set()
                    v2x_time_sent = time_sim_s
                    
                    evt_id2 = "e_v2x_sent"
                    logger.log_event(evt_id2, time_sim_s, "Van sends V2X message", [event_memory.get("ped_cross")])
                    event_memory["v2x_sent"] = evt_id2
                    current_frame_events.append(evt_id2)

        # Pedestrian collision logic
        if dist_ped <= 4.0 and not ped_fallen and ped_triggered:
            control.speed = 0.0
            ped.apply_control(control)
            current_transform = ped.get_transform()
            new_rotation = carla.Rotation(pitch=-90.0, yaw=current_transform.rotation.yaw, roll=0.0)
            new_location = current_transform.location
            new_location.z -= 0.8 
            ped.set_transform(carla.Transform(new_location, new_rotation))
            ped.set_collisions(False)
            ped_fallen = True

            evt_id_crash = "e_collision_ped"
            causes = []
            
            if "ped_cross" in event_memory:
                causes.append(event_memory["ped_cross"])
                
            if "aeb_active" in event_memory:
                causes.append(event_memory["aeb_active"])
            elif "hard_brake" in event_memory: 
                causes.append(event_memory["hard_brake"])

            impact_kmh = round(v_kmh, 1)
            desc = f"Collision with pedestrian recorded. Impact speed: {impact_kmh} km/h"
            
            logger.log_event(evt_id_crash, time_sim_s, desc, causes)
            event_memory["collision"] = evt_id_crash
            current_frame_events.append(evt_id_crash)

        target_name = current_target_id if current_target_id != "None" else "Unknown Object"

        # Adjust the Audi's speed limit and restart it after a certain time
        if time_sim_s >= AUDI_RESTART_TIME and not audi_restarted:
            audi_speed_limit = stopped_car.get_speed_limit()
            if audi_speed_limit > 0.0:
                audi_diff_percent = max(-300.0, 30.0)
                traffic_manager.vehicle_percentage_speed_difference(stopped_car, audi_diff_percent)
            stopped_car.apply_control(carla.VehicleControl(throttle=0.0, brake=0.0, hand_brake=False))
            stopped_car.set_autopilot(True)
            audi_restarted = True

        # Update braking conditions based on distance and time-to-collision
        if not hard_condition:
            hard_condition = (d is not None and d < HARD_DIST_M) or (ttc is not None and ttc < HARD_TTC_S)
        else:
            hard_condition = not (
                (d is None or d > HARD_DIST_OFF) and
                (ttc is None or not math.isfinite(ttc) or ttc > HARD_TTC_S_OFF)
            )

        # Update soft braking conditions based on distance and time-to-collision
        if not soft_condition:
            soft_condition = (d is not None and d < SOFT_DIST_M) or (ttc is not None and ttc < SOFT_TTC_S)
        else:
            soft_condition = not (
                (d is None or d > SOFT_DIST_OFF) and
                (ttc is None or not math.isfinite(ttc) or ttc > SOFT_TTC_S_OFF)
            )

        # Log events for distance decrease, soft braking, and hard braking
        if soft_condition and not dist_dec_logged:
            evt_dist = "e_dist_dec"
            logger.log_event(evt_dist, time_sim_s, f"Radar detects a significant decrease in distance from the {target_name}", causes=[])
            event_memory["dist_dec"] = evt_dist
            current_frame_events.append(evt_dist)
            dist_dec_logged = True

        if soft_condition and not hard_condition and not soft_brake_logged:
            evt_soft = "e_soft_brake"
            causes = [event_memory.get("dist_dec")] if "dist_dec" in event_memory else []
            logger.log_event(evt_soft, time_sim_s, "System applies soft braking", causes)
            event_memory["soft_brake"] = evt_soft
            current_frame_events.append(evt_soft)
            soft_brake_logged = True

        if hard_condition and not hard_brake_logged:
            evt_hard = "e_hard_brake"
            causes = [event_memory.get("dist_dec")] if "dist_dec" in event_memory else []
            logger.log_event(evt_hard, time_sim_s, "System applies emergency braking", causes)
            event_memory["hard_brake"] = evt_hard
            current_frame_events.append(evt_hard)
            hard_brake_logged = True

        if not soft_condition:
            dist_dec_logged = False
            soft_brake_logged = False
        if not hard_condition:
            hard_brake_logged = False

        # Check if V2X warning conditions are met and log the event
        v2x_condition = (
            v2x_event.is_set() and
            v2x_sent_flag.is_set() and
            v2x_time_sent > 0.0 and
            (time_sim_s - v2x_time_sent) >= NETWORK_DELAY and
            (time_sim_s - v2x_time_sent) <= (NETWORK_DELAY + V2X_ACTIVE_DURATION)
        )

        if v2x_condition and not v2x_logged:
            evt_id_rx = "e_v2x_rx"
            causes_rx = [event_memory.get("v2x_sent")] if "v2x_sent" in event_memory else []
            logger.log_event(evt_id_rx, time_sim_s, "V2X Warning received", causes_rx)
            event_memory["v2x_rx"] = evt_id_rx
            current_frame_events.append(evt_id_rx)

            evt_id_aeb = "e_aeb_v2x"
            causes_aeb = [evt_id_rx]
            logger.log_event(evt_id_aeb, time_sim_s, "System applies emergency braking", causes_aeb)
            event_memory["aeb_active"] = evt_id_aeb
            current_frame_events.append(evt_id_aeb)
            
            v2x_logged = True

        # Determine target throttle and brake values based on the current conditions
        tgt_throttle = CRUISE_THROTTLE
        tgt_brake    = 0.0
        if hold_brake_mode:
            if d is None or d > 12.0:
                hold_brake_mode = False
                hold_counter = 0
                tgt_throttle = CRUISE_THROTTLE
                tgt_brake = 0.0
            else:
                tgt_throttle = 0.0
                tgt_brake = 1.0
        else:
            if hard_condition or v2x_condition:
                tgt_throttle = 0.0
                tgt_brake = 1.0
            elif soft_condition :  
                tgt_throttle = 0.0
                tgt_brake = 0.20
            else:
                tgt_throttle = CRUISE_THROTTLE if v_kmh < CRUISE_SPEED_KMH else 0.0
                tgt_brake = 0.0

        throttle = 0.86 * throttle + 0.14 * tgt_throttle
        brake = 0.80 * brake + 0.20 * tgt_brake

        if brake > 0.20:
            throttle = 0.0

        if d is not None and d < 5.30 and v_kmh < 0.30:
            hold_counter += 1
        else:
            hold_counter = 0
        if hold_counter > int(2.0 / DT):
            hold_brake_mode = True
            throttle = 0.0
            brake = max(brake, 0.95)

        # Update the vehicle's control based on whether ADAS is acting and whether autopilot is active
        adas_is_acting = hold_brake_mode or hard_condition or soft_condition or v2x_condition
        last_known_steer = ego.get_control().steer
        if adas_is_acting and autopilot_active:
            ego.set_autopilot(False)
            autopilot_active = False
        elif not adas_is_acting and not autopilot_active:
            ego.set_autopilot(True)
            autopilot_active = True
            throttle = 0.0
            brake    = 0.0 

        if not autopilot_active:
            ego.apply_control(carla.VehicleControl(
                throttle=float(np.clip(throttle, 0.0, 1.0)),
                brake=float(np.clip(brake, 0.0, 1.0)), 
                steer=last_known_steer,
                hand_brake=False
            ))

        ego_tf = ego.get_transform()

        # Log telemetry data at specified intervals
        if step % LOG_INTERVAL == 0:
            current_actors = []
            
            for obs in obstacles:
                loc = obs["actor"].get_location()
                current_actors.append({
                    "id": obs["id"], 
                    "x": round(loc.x, 2), 
                    "y": round(loc.y, 2)
                })
                
            current_actors.append({
                "id": "pedestrian", 
                "x": round(ped_current_loc.x, 2), 
                "y": round(ped_current_loc.y, 2)
            })

            logger.log_telemetry(
                frame=step,
                time_sim=time_sim_s,
                speed=v_kmh,
                brake=brake, 
                steer=last_known_steer,
                ego_tf=ego_tf,
                actors_data=current_actors,
                active_events=current_frame_events if current_frame_events else None
            )

        move_spectator_to(ego_tf, spectator, distance=14.0, z=4.5, pitch=-16.0)
        world.tick()

finally:
        # Restore original world settings and perform cleanup
        print("\n[Cleanup] starting the cleanup and saving process...")
        try:
            logger.save('forensic_viewer/forensic_data.json')
            print(f"[Cleanup] File 'forensic_data.json' successfully saved.")
        except Exception as e:
            print(f"[Cleanup Error] unable to save causal JSON: {e}")

        if save_queue is not None:
            save_queue.put(None)
        if saver_thread is not None:
            saver_thread.join(timeout=3.0)
            print("[Cleanup] Image saving thread stopped.")

        try:
            mqtt_client.loop_stop()
            mqtt_client.disconnect()
            print("[Cleanup] MQTT disconnected.")
        except:
            pass
        
        if radar is not None:
            try: radar.stop()
            except Exception: pass
        if camera is not None:
            try: camera.stop()
            except Exception: pass
        if ego is not None and ego.is_alive:
            try:
                ego.set_autopilot(False)
            except Exception:
                pass

        try:
            safe_destroy(actors)
            print("[Cleanup] All actors and sensors destroyed.")
        except Exception as e:
            print(f"[Cleanup Error] Failed to destroy actors: {e}")
        try:
            world.tick()
            world.tick()
        except Exception:
            pass

        try:
            traffic_manager.set_synchronous_mode(False)
            settings = world.get_settings()
            settings.synchronous_mode = False
            settings.fixed_delta_seconds = None
            world.apply_settings(settings)
            print("[Cleanup] CARLA server restored to asynchronous mode.")
        except Exception as e:
            print(f"[CRITICAL ERROR] Unable to restore async mode — restart CARLA manually: {e}")




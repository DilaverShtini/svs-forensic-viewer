import carla
import math

# Safely destroy a list of actors
def safe_destroy(actors):
    for actor in actors:
        if actor is not None and actor.is_alive:
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
    world, attach_to, transform,
    horizontal_fov=80.0, vertical_fov=5.0,
    points_per_second=10000, range_m=100.0, tick=0.05
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

# Spawn a collision sensor attached to a vehicle
def spawn_collision(world, attach_to):
    bp = world.get_blueprint_library().find('sensor.other.collision')
    if bp.has_attribute("role_name"):
        bp.set_attribute("role_name", "forensic_collision")
    return world.spawn_actor(bp, carla.Transform(), attach_to=attach_to)

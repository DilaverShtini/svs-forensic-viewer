import json

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

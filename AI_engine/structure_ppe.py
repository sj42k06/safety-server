def structure_data(results_data):
    structured = []
    for frame_data in results_data:
        persons, helmets, vests, machines = [], [], [], []
        
        for det in frame_data["detections"]:
            label = det["type"]
            obj_data = {
                "bbox": det["bbox"], "fx": det["fx"], "fy": det["fy"], "conf": det["confidence"]
            }

            if label == "person":
                persons.append(obj_data)
            elif label in ["hardhat", "no-hardhat"]:
                obj_data["type"] = label
                helmets.append(obj_data)
            elif label in ["safety vest", "no-safety vest"]:
                obj_data["type"] = label
                vests.append(obj_data)
            elif label in ["machinery", "vehicle"]:
                machines.append(obj_data)

        structured.append({
            "frame": frame_data["frame"], "width": frame_data["width"], "height": frame_data["height"],
            "persons": persons, "helmets": helmets, "vests": vests, "machines": machines
        })
    return structured
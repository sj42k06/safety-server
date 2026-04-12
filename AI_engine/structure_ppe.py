def structure_ppe_data(results_data):
    structured = []

    for frame_data in results_data:
        helmets = []
        vests = []
        machines = []

        for det in frame_data["detections"]:

            obj_data = {
                "id": None,
                "type": det["type"],
                "confidence": det["confidence"],
                "bbox": det["bbox"],
                "cx": det["cx"],
                "cy": det["cy"]
            }

            # 카테고리 분류
            if det["type"] in ["Hardhat", "NO-Hardhat"]:
                helmets.append(obj_data)

            elif det["type"] in ["Safety Vest", "NO-Safety Vest"]:
                vests.append(obj_data)

            elif det["type"] in ["machinery", "vehicle"]:
                machines.append(obj_data)

        structured.append({
            "frame": frame_data["frame"],
            "width": frame_data["width"],
            "height": frame_data["height"],
            "helmets": helmets,
            "vests": vests,
            "machines": machines
        })

    return structured
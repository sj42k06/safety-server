def structure_data(results_data):
    structured = []

    for frame_data in results_data:
        persons = []
        objects = []

        for det in frame_data["detections"]:

            # 단순화된 category 분류
            if det["type"] == "person":
                category = "person"
            else:
                category = "object"

            obj_data = {
                "id": None,  # Tracking 대비
                "type": det["type"],
                "category": category,
                "confidence": det["confidence"],
                "bbox": det["bbox"],
                "cx": det["cx"],
                "cy": det["cy"]
            }

            # person / object 분리
            if category == "person":
                persons.append(obj_data)
            else:
                objects.append(obj_data)

        structured.append({
            "frame": frame_data["frame"],
            "width": frame_data["width"],
            "height": frame_data["height"],
            "persons": persons,
            "objects": objects
        })

    return structured
def is_inside(person_bbox, obj_bbox):
    px1, py1, px2, py2 = person_bbox
    ox1, oy1, ox2, oy2 = obj_bbox
    cx = (ox1 + ox2) // 2
    cy = (oy1 + oy2) // 2
    return (px1 <= cx <= px2) and (py1 <= cy <= py2)

def analyze_ppe(structured_data, ppe_data):
    results = []

    for frame, ppe_frame in zip(structured_data, ppe_data):
        frame_result = {
            "frame": frame["frame"],
            "workers": []
        }

        persons = frame.get("persons", [])
        helmets = ppe_frame.get("helmets", [])
        vests = ppe_frame.get("vests", [])

        for person in persons:
            has_helmet = False
            no_helmet = False
            has_vest = False
            no_vest = False

            for h in helmets:
                if is_inside(person["bbox"], h["bbox"]):
                    if h["type"] == "Hardhat":
                        has_helmet = True
                    elif h["type"] == "NO-Hardhat":
                        no_helmet = True

            for v in vests:
                if is_inside(person["bbox"], v["bbox"]):
                    if v["type"] == "Safety Vest":
                        has_vest = True
                    elif v["type"] == "NO-Safety Vest":
                        no_vest = True

            if no_helmet:
                helmet_status = "NO_HELMET"
            elif has_helmet:
                helmet_status = "HELMET"
            else:
                helmet_status = "UNKNOWN"

            if no_vest:
                vest_status = "NO_VEST"
            elif has_vest:
                vest_status = "VEST"
            else:
                vest_status = "UNKNOWN"

            if helmet_status == "NO_HELMET":
                risk = "HIGH"
            elif vest_status == "NO_VEST":
                risk = "MEDIUM"
            elif helmet_status == "UNKNOWN":
                risk = "MEDIUM"
            else:
                risk = "LOW"

            frame_result["workers"].append({
                "bbox": person["bbox"],
                "helmet": helmet_status,
                "vest": vest_status,
                "risk": risk,
                "has_helmet": has_helmet,
                "has_vest": has_vest
            })

        results.append(frame_result)

    return results

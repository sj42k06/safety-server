#보호구 착용여부
def is_inside(person_bbox, obj_bbox, margin=15):
    px1, py1, px2, py2 = person_bbox
    ox1, oy1, ox2, oy2 = obj_bbox
    ocx, ocy = (ox1 + ox2) // 2, (oy1 + oy2) // 2
    return (px1 - margin <= ocx <= px2 + margin) and (py1 - margin <= ocy <= py2 + margin)

def analyze_ppe(structured_frames):
    results = []
    for frame in structured_frames:
        frame_result = {"frame": frame["frame"], "workers": []}
        
        for person in frame["persons"]:
            has_helmet = any(h["type"] == "hardhat" for h in frame["helmets"] if is_inside(person["bbox"], h["bbox"]))
            # No-Hardhat이 감지되면 착용하지 않은 것으로 강제 간주
            no_helmet = any(h["type"] == "no-hardhat" for h in frame["helmets"] if is_inside(person["bbox"], h["bbox"]))
            
            has_vest = any(v["type"] == "safety vest" for v in frame["vests"] if is_inside(person["bbox"], v["bbox"]))
            no_vest = any(v["type"] == "no-safety vest" for v in frame["vests"] if is_inside(person["bbox"], v["bbox"]))

            helmet_status = "HELMET" if (has_helmet and not no_helmet) else "NO_HELMET"
            vest_status = "VEST" if (has_vest and not no_vest) else "NO_VEST"
            
            # 위험도 산정
            risk = "LOW"
            if helmet_status == "NO_HELMET": risk = "HIGH"
            elif vest_status == "NO_VEST": risk = "MEDIUM"

            frame_result["workers"].append({
                "bbox": person["bbox"], "fx": person["fx"], "fy": person["fy"],
                "helmet": helmet_status, "vest": vest_status, "risk": risk
            })
        results.append(frame_result)
    return results
# 낙하 발생 가능성 감지에 따른 위험도 판단로직
# 구조물 정의 (PPE 기반)
PPE_STRUCTURES = ["machinery", "vehicle"]
# -------------------------
# 구조물 가장자리 판단
def is_on_structure_edge(obj, structures, threshold=20):
    ox1, oy1, ox2, oy2 = obj["bbox"]
    for s in structures:
        sx1, sy1, sx2, sy2 = s["bbox"]
        # 1️⃣ 물체 중심이 구조물 내부에 있는지
        if (sx1 <= obj["cx"] <= sx2) and (sy1 <= obj["cy"] <= sy2):
            # 2️⃣ 구조물 경계와 거리 비교
            near_left = abs(ox1 - sx1) < threshold
            near_right = abs(ox2 - sx2) < threshold
            near_top = abs(oy1 - sy1) < threshold
            if near_left or near_right or near_top:
                return True
    return False
# -------------------------
# 사람 아래 여부
def is_person_below(obj, persons):
    for p in persons:
        px1, py1, px2, py2 = p["bbox"]
        # 물체 중심 x가 사람 범위 안 + 사람이 더 아래 있음
        if (px1 <= obj["cx"] <= px2) and (p["cy"] > obj["cy"]):
            return True
    return False
# -------------------------
# 고소 작업 여부
def is_high_work(person, height):
    return person["cy"] < height * 0.4
# -------------------------
# 큰 물체 판단
def is_large_object(obj):
    x1, y1, x2, y2 = obj["bbox"]
    return (x2 - x1) * (y2 - y1) > 5000
# -------------------------
# 낙하 위험 분석
def analyze_fall_risk(structured_data, ppe_data):
    results = []
    for frame, ppe_frame in zip(structured_data, ppe_data):
        height = frame["height"]
        frame_result = {
            "frame": frame["frame"],
            "risks": []
        }
        # -------------------------
        # ppe_frame 구조 방어적 처리 (detections / objects 키 모두 대응)
        ppe_detections = (
            ppe_frame.get("detections")
            or ppe_frame.get("objects")
            or []
        )
        # 구조물 추출 (PPE 기반)
        structures = [
            {"bbox": det["bbox"]}
            for det in ppe_detections
            if det.get("type") in PPE_STRUCTURES
        ]
        # -------------------------
        # 고소 작업자
        high_workers = [
            p for p in frame["persons"]
            if is_high_work(p, height)
        ]
        # -------------------------
        # 객체별 분석
        for obj in frame["objects"]:
            cy = obj["cy"]
            # ① 높은 위치
            is_high = cy < height * 0.3
            # ② 구조물 가장자리
            edge_risk = is_on_structure_edge(obj, structures)
            # ③ 사람 아래 여부
            person_below = is_person_below(obj, frame["persons"])
            # ④ 고소 작업 여부
            high_work = len(high_workers) > 0
            # ⑤ 큰 물체 여부
            large_object = is_large_object(obj)
            # -------------------------
            # 최종 위험도 판단
            if is_high and edge_risk and person_below:
                risk = "CRITICAL"
            elif is_high and edge_risk:
                risk = "HIGH"
            elif is_high and person_below:
                risk = "HIGH"
            elif is_high and large_object:
                risk = "HIGH"
            elif is_high and high_work:
                risk = "MEDIUM"
            elif is_high:
                risk = "MEDIUM"
            else:
                risk = "LOW"
            # -------------------------
            # 위험 객체만 기록
            if risk != "LOW":
                frame_result["risks"].append({
                    "object": obj["type"],
                    "bbox": obj["bbox"],
                    "risk": risk,
                    "is_high": is_high,
                    "edge_risk": edge_risk,
                    "person_below": person_below,
                    "high_work": high_work,
                    "large_object": large_object
                })
        results.append(frame_result)
    return results

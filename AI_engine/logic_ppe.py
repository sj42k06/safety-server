#보호구 착용여부에 따른 위험도 판단로직
#1. bbox 포함 여부

def is_inside(person_bbox, obj_bbox):
    px1, py1, px2, py2 = person_bbox
    ox1, oy1, ox2, oy2 = obj_bbox

    # 완전 포함이 아니라 "중심점 기준"으로 완화
    cx = (ox1 + ox2) // 2
    cy = (oy1 + oy2) // 2

    return (px1 <= cx <= px2) and (py1 <= cy <= py2)


# -------------------------
# 2. PPE 분석 + 위험도 판단

def analyze_ppe(structured_data, ppe_data):
    results = []

    for frame, ppe_frame in zip(structured_data, ppe_data):

        frame_result = {
            "frame": frame["frame"],
            "workers": []
        }

        for person in frame["persons"]:

            has_helmet = False
            no_helmet = False
            has_vest = False
            no_vest = False

            # -------------------------
            # PPE 매칭

            for det in ppe_frame["detections"]:
                if is_inside(person["bbox"], det["bbox"]):

                    if det["type"] == "Hardhat":
                        has_helmet = True

                    elif det["type"] == "NO-Hardhat":
                        no_helmet = True

                    elif det["type"] == "Safety Vest":
                        has_vest = True

                    elif det["type"] == "NO-Safety Vest":
                        no_vest = True

            # -------------------------
            # 보호구 상태 판단 (우선순위 적용)

            # 헬멧
            if no_helmet:
                helmet_status = "NO_HELMET"
            elif has_helmet:
                helmet_status = "HELMET"
            else:
                helmet_status = "UNKNOWN"

            # 조끼
            if no_vest:
                vest_status = "NO_VEST"
            elif has_vest:
                vest_status = "VEST"
            else:
                vest_status = "UNKNOWN"

            # -------------------------
            # 위험도 판단

            # 최고 위험
            if helmet_status == "NO_HELMET":
                risk = "HIGH"

            # 중간 위험
            elif vest_status == "NO_VEST":
                risk = "MEDIUM"

            # 정보 부족 (카메라 문제 등)
            elif helmet_status == "UNKNOWN":
                risk = "MEDIUM"

            # 안전
            else:
                risk = "LOW"

            # -------------------------
            # 상세 정보 추가 (보고서용)

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
"""
detect_quick.py
빠른 바운딩박스 전용 스크립트 - DB 저장 없이 좌표만 반환
웹캠 실시간 분석용
"""
import sys
import os
import json
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from detect_ppe import model, MODEL_NAMES, CONF_THRESHOLD

def detect_quick(image_path):
    """이미지에서 객체 탐지 후 바운딩박스 좌표 반환 (0~1 정규화)"""
    img = cv2.imread(image_path)
    if img is None:
        print(json.dumps({"boxes": [], "danger": False}))
        return

    h, w = img.shape[:2]

    # 위험 구역 (오른쪽 절반) x > 0.5
    DANGER_ZONE_X = 0.5

    results = model([img], conf=CONF_THRESHOLD, stream=False)
    boxes = []
    danger_detected = False
    ppe_violation   = False
    has_heavy       = False
    has_person      = False
    person_count    = 0

    for r in results:
        for box in r.boxes:
            conf    = float(box.conf[0])
            cls_idx = int(box.cls[0])
            if cls_idx not in MODEL_NAMES:
                continue
            label = MODEL_NAMES[cls_idx]

            x1, y1, x2, y2 = map(int, box.xyxy[0])
            cx = (x1 + x2) / 2 / w  # 중심 x (정규화)

            # 정규화 좌표
            nx  = x1 / w
            ny  = y1 / h
            nw  = (x2 - x1) / w
            nh  = (y2 - y1) / h

            # 위험 구역 진입 여부 (사람이 오른쪽에 있음)
            in_danger_zone = (label == 'person') and (cx > DANGER_ZONE_X)
            if in_danger_zone:
                danger_detected = True

            # PPE 위반 여부
            if label in ['no-hardhat', 'no-safety vest']:
                ppe_violation   = True
                danger_detected = True

            # 중장비 감지
            if label in ['machinery', 'forklift', 'excavator', 'vehicle']:
                has_heavy = True

            # 사람 감지
            if label == 'person':
                has_person = True
                person_count += 1

            boxes.append({
                "label":      label,
                "confidence": round(conf, 2),
                "x": round(nx, 4),
                "y": round(ny, 4),
                "w": round(nw, 4),
                "h": round(nh, 4),
                "in_danger_zone": in_danger_zone
            })

    # 중장비 + 사람 있으면 위험
    if has_heavy and has_person:
        danger_detected = True

    # 사람 5명 이상이면 밀집 위험
    if person_count >= 5:
        danger_detected = True

    print(json.dumps({
        "boxes":         boxes,
        "danger":        danger_detected,
        "ppe_violation": ppe_violation
    }, ensure_ascii=False))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"boxes": [], "danger": False}))
        sys.exit(0)
    detect_quick(sys.argv[1])

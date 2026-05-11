"""
app.py - Flask AI 서버
YOLO 모델을 한 번만 로드하고 요청마다 재사용
포트: 5001
"""
from flask import Flask, request, jsonify
import os
import sys
import cv2
import json
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from detect_ppe import model, MODEL_NAMES, CONF_THRESHOLD

app = Flask(__name__)

DANGER_ZONE_X = 0.5  # 오른쪽 절반이 위험구역

print("[AI 서버] YOLO 모델 로드 완료!", file=sys.stderr)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"})

@app.route('/analyze-quick', methods=['POST'])
def analyze_quick():
    """바운딩박스 좌표만 빠르게 반환 (DB 저장 없음)"""
    if 'image' not in request.files:
        return jsonify({"boxes": [], "danger": False, "ppe_violation": False})

    file = request.files['image']

    # 임시 파일로 저장
    with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name

    try:
        img = cv2.imread(tmp_path)
        if img is None:
            return jsonify({"boxes": [], "danger": False, "ppe_violation": False})

        h, w = img.shape[:2]
        results = model([img], conf=CONF_THRESHOLD, stream=False)

        boxes          = []
        danger         = False
        ppe_violation  = False

        for r in results:
            for box in r.boxes:
                conf    = float(box.conf[0])
                cls_idx = int(box.cls[0])
                if cls_idx not in MODEL_NAMES:
                    continue

                label = MODEL_NAMES[cls_idx]
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                cx = (x1 + x2) / 2 / w

                in_danger_zone = (label == 'person') and (cx > DANGER_ZONE_X)
                if in_danger_zone:
                    danger = True
                if label in ['no-hardhat', 'no-safety vest']:
                    ppe_violation = True
                    danger        = True

                boxes.append({
                    "label":          label,
                    "confidence":     round(conf, 2),
                    "x":              round(x1 / w, 4),
                    "y":              round(y1 / h, 4),
                    "w":              round((x2 - x1) / w, 4),
                    "h":              round((y2 - y1) / h, 4),
                    "in_danger_zone": in_danger_zone
                })

        return jsonify({
            "boxes":         boxes,
            "danger":        danger,
            "ppe_violation": ppe_violation
        })

    except Exception as e:
        print(f"[AI 서버] 오류: {e}", file=sys.stderr)
        return jsonify({"boxes": [], "danger": False, "ppe_violation": False})
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.route('/detect-all', methods=['POST'])
def detect_all_endpoint():
    """pipeline.py용 - 이미지 탐지 결과 반환"""
    if 'image' not in request.files:
        return jsonify({"frame": "", "width": 640, "height": 480, "detections": []})

    file = request.files['image']
    filename = file.filename or 'frame.jpg'

    with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name

    try:
        import cv2
        img = cv2.imread(tmp_path)
        if img is None:
            return jsonify({"frame": filename, "width": 640, "height": 480, "detections": []})

        h, w = img.shape[:2]
        results = model([img], conf=CONF_THRESHOLD, stream=False)
        detections = []

        for r in results:
            for box in r.boxes:
                conf    = float(box.conf[0])
                cls_idx = int(box.cls[0])
                if cls_idx not in MODEL_NAMES:
                    continue
                label = MODEL_NAMES[cls_idx]
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                fx = (x1 + x2) // 2
                fy = y2
                detections.append({
                    "type":       label,
                    "confidence": round(conf, 2),
                    "bbox":       [x1, y1, x2, y2],
                    "fx": fx,
                    "fy": fy
                })

        return jsonify({
            "frame":      filename,
            "width":      w,
            "height":     h,
            "detections": detections
        })

    except Exception as e:
        print(f"[AI 서버] detect-all 오류: {e}", file=sys.stderr)
        return jsonify({"frame": filename, "width": 640, "height": 480, "detections": []})
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


if __name__ == '__main__':
    port = int(os.environ.get('AI_PORT', 5001))
    print(f"[AI 서버] 포트 {port}에서 시작", file=sys.stderr)
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True, processes=1)

from ultralytics import YOLO
import os

# 설정

MODEL_PATH = "yolov8n.pt"   # 가벼운 모델 
CONF_THRESHOLD = 0.3        # 최소 신뢰도

# 모델 로드
model = YOLO(MODEL_PATH)

# 객체 탐지 함수
def detect_objects(input_folder):
    results_data = []

    # 폴더 존재 확인
    if not os.path.exists(input_folder):
        print("입력 폴더가 존재하지 않습니다.")
        return []

    files = os.listdir(input_folder)

    for filename in files:
        if not filename.lower().endswith((".jpg", ".jpeg", ".png")):
            continue

        image_path = os.path.join(input_folder, filename)

        try:
            results = model(image_path)

            detections = []

            for r in results:
                for box in r.boxes:
                    conf = float(box.conf[0])

                    # 신뢰도 필터링
                    if conf < CONF_THRESHOLD:
                        continue

                    cls = int(box.cls[0])
                    label = model.names[cls]

                    x1, y1, x2, y2 = map(int, box.xyxy[0])

                    detections.append({
                        "class": label,
                        "confidence": round(conf, 2),
                        "bbox": [x1, y1, x2, y2]
                    })

            results_data.append({
                "frame": filename,
                "detections": detections
            })

        except Exception as e:
            print(f"오류 발생 ({filename}):", e)

    return results_data


# =========================
# 테스트 실행
if __name__ == "__main__":
    input_folder = "input_images"  # 통합 폴더(프레임+업로드 이미지)

    results = detect_objects(input_folder)

    for r in results:
        print(r)
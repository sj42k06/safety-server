from ultralytics import YOLO
import os
import sys
# 설정
MODEL_PATH = "yolov8n.pt"
CONF_THRESHOLD = 0.3
# 모델 로드
model = YOLO(MODEL_PATH)
# 객체 탐지 함수
def detect_objects(input_folder):
    results_data = []
    if not os.path.exists(input_folder):
        os.makedirs(input_folder, exist_ok=True)
        print("감지된 객체 없음")
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
# 실행
if __name__ == "__main__":
    # server.js에서 폴더 경로 전달받기
    if len(sys.argv) > 1:
        input_folder = sys.argv[1]
    else:
        input_folder = "input_images"
    # 폴더 없으면 자동 생성
    if not os.path.exists(input_folder):
        os.makedirs(input_folder, exist_ok=True)
    results = detect_objects(input_folder)
    if not results:
        print("감지된 객체 없음")
    else:
        for r in results:
            print(r)

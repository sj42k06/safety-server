from ultralytics import YOLO
import os
import cv2

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "yolov8n.pt")
CONF_THRESHOLD = 0.3

#  위험 분석용 객체 필터
VALID_OBJECTS = [
    "person",      # 작업자

    # 소형 낙하물 (공구 대체)
    "bottle",
    "cup",
    "backpack",
    "handbag",

    # 자재 느낌(중형)
    "chair",
    "suitcase",

    # 대형 보완
    "tv", "laptop", "keyboard"

]

model = YOLO(MODEL_PATH)

def detect_objects(input_folder):
    results_data = []

    if not os.path.exists(input_folder):
        print("입력 폴더가 존재하지 않습니다.")
        return []

    files = os.listdir(input_folder)

    for filename in files:
        if not filename.lower().endswith((".jpg", ".jpeg", ".png")):
            continue

        image_path = os.path.join(input_folder, filename)

        try:
            img = cv2.imread(image_path)
            if img is None:
                continue

            h, w, _ = img.shape

            results = model(img)

            detections = []

            for r in results:
                for box in r.boxes:
                    conf = float(box.conf[0])

                    #  신뢰도 필터
                    if conf < CONF_THRESHOLD:
                        continue

                    cls = int(box.cls[0])
                    label = model.names[cls]

                    #  객체 필터링 
                    if label not in VALID_OBJECTS:
                        continue

                    x1, y1, x2, y2 = map(int, box.xyxy[0])

                    cx = (x1 + x2) // 2
                    cy = (y1 + y2) // 2

                    detections.append({
                        "type": label,
                        "confidence": round(conf, 2),
                        "bbox": [x1, y1, x2, y2],
                        "cx": cx,
                        "cy": cy
                    })

            results_data.append({
                "frame": filename,
                "width": w,
                "height": h,
                "detections": detections
            })

        except Exception as e:
            print(f"오류 발생 ({filename}):", e)

    return results_data

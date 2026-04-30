from ultralytics import YOLO
import os
import cv2

MODEL_PATH = "helmet_model.pt"
CONF_THRESHOLD = 0.3
# 모델에서 제공하는 클래스 리스트 반영
VALID_CLASSES = ["Hardhat", "NO-Hardhat", "Safety Vest", "NO-Safety Vest", 
                 "Person", "Safety Cone", "machinery", "vehicle", "Mask", "NO-Mask"]

model = YOLO(MODEL_PATH)

def detect_all(input_folder):
    results_data = []
    for filename in os.listdir(input_folder):
        if not filename.lower().endswith((".jpg", ".jpeg", ".png")): continue
        path = os.path.join(input_folder, filename)
        try:
            img = cv2.imread(path)
            if img is None: continue
            h, w, _ = img.shape
            results = model(img)
            detections = []

            for r in results:
                for box in r.boxes:
                    conf = float(box.conf[0])
                    if conf < CONF_THRESHOLD: continue
                    
                    label = model.names[int(box.cls[0])]
                    if label not in VALID_CLASSES: continue

                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    # 발바닥(중앙 하단) 좌표: 거리 계산용
                    fx, fy = (x1 + x2) // 2, y2 

                    detections.append({
                        "type": label.lower(), 
                        "confidence": round(conf, 2),
                        "bbox": [x1, y1, x2, y2], "fx": fx, "fy": fy
                    })
            results_data.append({"frame": filename, "width": w, "height": h, "detections": detections})
        except Exception as e: print(f"Error ({filename}): {e}")
    return results_data
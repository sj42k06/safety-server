from ultralytics import YOLO
import os
import cv2

# 1. 모델 설정 및 경로
MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "best.pt")
CONF_THRESHOLD = 0.3

# 2. best.pt의 실제 클래스 리스트 
VALID_CLASSES = [
    'Excavator', 'Hardhat', 'NO-Hardhat', 'NO-Safety Vest', 
    'Person', 'Safety Vest', 'board', 'brick', 'hook', 
    'machinery', 'rebar', 'wood'
]

# 모델 로드
model = YOLO(MODEL_PATH)

def detect_all(input_folder):
    results_data = []
    
    if not os.path.exists(input_folder):
        print(f"경고: 폴더를 찾을 수 없습니다. -> {input_folder}")
        return results_data

    for filename in os.listdir(input_folder):
        if not filename.lower().endswith((".jpg", ".jpeg", ".png")): 
            continue
            
        path = os.path.join(input_folder, filename)
        
        try:
            img = cv2.imread(path)
            if img is None: continue
            
            h, w, _ = img.shape
            results = model(img)
            detections = []

            for r in results:
                names = r.names
                
                for box in r.boxes:
                    conf = float(box.conf[0])
                    if conf < CONF_THRESHOLD: 
                        continue
                    
                    cls_idx = int(box.cls[0])
                    label = names[cls_idx]
                    
                    if label not in VALID_CLASSES: 
                        continue

                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    fx, fy = (x1 + x2) // 2, y2 

                    detections.append({
                        "type": label.lower(),
                        "confidence": round(conf, 2),
                        "bbox": [x1, y1, x2, y2], 
                        "fx": fx, 
                        "fy": fy
                    })
            
            results_data.append({
                "frame": filename, 
                "width": w, 
                "height": h, 
                "detections": detections
            })
            
        except Exception as e: 
            print(f"파일 처리 중 오류 발생 ({filename}): {e}")
            
    return results_data

from ultralytics import YOLO
import os
import cv2

# 1. 설정
MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "safety2.pt")
CONF_THRESHOLD = 0.3
BATCH_SIZE = 16

# 모델 로드
model = YOLO(MODEL_PATH)

# 모델의 클래스 정보를 자동으로 가져와 소문자로 변환
MODEL_NAMES = {k: v.lower() for k, v in model.names.items()}

def detect_all(input_folder):
    results_data = []
    
    if not os.path.exists(input_folder):
        print(f"경고: 폴더를 찾을 수 없습니다. -> {input_folder}")
        return results_data

    valid_extensions = (".jpg", ".jpeg", ".png")
    image_files = [f for f in os.listdir(input_folder) if f.lower().endswith(valid_extensions)]
    
    for i in range(0, len(image_files), BATCH_SIZE):
        batch_files = image_files[i : i + BATCH_SIZE]
        batch_imgs = []
        batch_paths = []

        for filename in batch_files:
            path = os.path.join(input_folder, filename)
            img = cv2.imread(path)
            if img is not None:
                batch_imgs.append(img)
                batch_paths.append(filename)

        if not batch_imgs:
            continue

        try:
            results = model(batch_imgs, conf=CONF_THRESHOLD, stream=False)
            for idx, r in enumerate(results):
                filename = batch_paths[idx]
                h, w, _ = batch_imgs[idx].shape
                detections = []

                for box in r.boxes:
                    conf = float(box.conf[0])
                    cls_idx = int(box.cls[0])
                    
                    if cls_idx not in MODEL_NAMES:
                        continue
                        
                    label = MODEL_NAMES[cls_idx]
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    fx, fy = (x1 + x2) // 2, y2 

                    detections.append({
                        "type": label,
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
            print(f"배치 처리 중 오류 발생: {e}")
            
    return results_data


def analyze_trip(structured_data):
    """
    통로 자재 방치 / 걸림 위험 분석
    safety_engine.py의 integrate_analysis에서 요구하는 형식으로 반환:
    [{"frame": "...", "trip_events": [{"type": ..., "elapsed_sec": ..., "bbox": ...}]}, ...]
    """
    # 걸림/방치 위험으로 분류할 클래스 키워드
    TRIP_KEYWORDS = [
        "material", "object", "obstacle", "pipe", "wood", "cable",
        "자재", "장애물", "파이프", "목재", "케이블", "방치"
    ]

    results = []
    for frame in structured_data:
        trip_events = []
        for det in frame.get("detections", []):
            label = det.get("type", "").lower()
            # 키워드 포함 여부 확인
            is_trip = any(kw in label for kw in TRIP_KEYWORDS)
            if is_trip:
                trip_events.append({
                    "type": det.get("type"),
                    "elapsed_sec": 10.0,  # 방치 시간 (기본값)
                    "bbox": det.get("bbox", [0, 0, 0, 0])
                })

        results.append({
            "frame": frame.get("frame", ""),
            "trip_events": trip_events
        })

    return results

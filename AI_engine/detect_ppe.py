from ultralytics import YOLO
import os
import cv2

# 1. 모델 설정 및 경로
MODEL_PATH = "best.pt"  
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

    #지정된 폴더 내의 이미지를 분석하여 12종의 클래스를 탐지합니다.
    results_data = []
    
    # 폴더 존재 확인
    if not os.path.exists(input_folder):
        print(f"경고: 폴더를 찾을 수 없습니다. -> {input_folder}")
        return results_data

    for filename in os.listdir(input_folder):
        # 이미지 파일만 필터링
        if not filename.lower().endswith((".jpg", ".jpeg", ".png")): 
            continue
            
        path = os.path.join(input_folder, filename)
        
        try:
            img = cv2.imread(path)
            if img is None: continue
            
            h, w, _ = img.shape
            
            # 모델 추론 
            results = model(img)
            detections = []

            for r in results:
                # 모델에 내장된 클래스 이름 사전 가져오기
                names = r.names
                
                for box in r.boxes:
                    conf = float(box.conf[0])
                    
                    # 설정한 신뢰도보다 낮은 결과는 무시
                    if conf < CONF_THRESHOLD: 
                        continue
                    
                    # 인덱스를 통해 클래스 이름 확인
                    cls_idx = int(box.cls[0])
                    label = names[cls_idx]
                    
                    # 12개 유효 클래스에 포함되는지 확인
                    if label not in VALID_CLASSES: 
                        continue

                    # 바운딩 박스 좌표 추출
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    
                    # 중심 하단 좌표 (발바닥 위치 등 거리 계산용)
                    fx, fy = (x1 + x2) // 2, y2 

                    detections.append({
                        "type": label.lower(), # 분석 편의를 위해 소문자로 저장
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
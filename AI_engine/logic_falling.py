#낙하물 사고예방
import numpy as np
from shapely.geometry import Point

# 거리 계산을 위한 스케일 행렬 생성
def get_scale_matrix(pixel_per_meter=100):
    scale = 1.0 / pixel_per_meter
    return np.array([[scale, 0, 0], [0, scale, 0], [0, 0, 1]], dtype='float32')

# 픽셀 좌표를 실제 미터(m) 단위로 변환
def transform_point(x, y, matrix):
    p = np.array([x, y, 1], dtype='float32')
    tp = np.dot(matrix, p)
    if tp[2] != 0: tp /= tp[2]
    return tp[0], tp[1]

def analyze_falling(structured_frames, ppe_analysis, pixel_per_meter=100):
    
    #후크 및 공중 판정된 자재의 수직 하부 위험을 분석합니다.
    
    H_matrix = get_scale_matrix(pixel_per_meter)
    falling_results = []
    
    # [중요 설정] 해당 카메라 뷰에서 '지면'으로 간주되는 Y축 임계값 (m)
    # 이미지의 아래쪽일수록 값이 크고, 위쪽(공중)일수록 값이 작습니다.
    # 예: 지면이 7.5m 지점이라면, 이보다 작은 값(예: 5.0m)은 공중으로 판단합니다.
    GROUND_LEVEL_THRESHOLD_M = 7.5 

    for frame, ppe_frame in zip(structured_frames, ppe_analysis):
        frame_data = {"frame": frame["frame"], "falling_alerts": []}
        
        # --- 1단계: 실시간 위험원(Active Hazards) 선별 ---
        active_hazards = []
        
        # 1-1. 후크 파악: 후크는 발견되는 즉시 공중 위험원으로 등록
        for h in frame["hooks"]:
            hx, hy = transform_point(h["fx"], h["fy"], H_matrix)
            active_hazards.append({
                "pos": Point(hx, hy), 
                "type": "hook", 
                "bbox": h["bbox"]
            })
            
        # 1-2. 자재 공중 상태 판정: 지면 고도(my)를 기준으로 선별
        for mat in frame["materials"]:
            mx, my = transform_point(mat["fx"], mat["fy"], H_matrix)
            
            # 자재의 바닥면(my)이 지면 높이보다 높게(값이 작게) 있다면 공중으로 간주
            if my < GROUND_LEVEL_THRESHOLD_M:
                active_hazards.append({
                    "pos": Point(mx, my), 
                    "type": mat.get("sub_type", "material"), 
                    "bbox": mat["bbox"]
                })

        # --- 2단계: 선별된 위험원과 작업자 간 거리 계산 ---
        for worker in ppe_frame["workers"]:
            wx, wy = transform_point(worker["fx"], worker["fy"], H_matrix)
            worker_pos = Point(wx, wy)

            for hazard in active_hazards:
                dist = worker_pos.distance(hazard["pos"])
                
                # 모든 거리를 기록하여 safety_engine에서 2.0m 기준으로 필터링
                frame_data["falling_alerts"].append({
                    "worker_bbox": worker["bbox"],
                    "hazard_source": hazard["type"],
                    "dist": round(dist, 2)
                })

        falling_results.append(frame_data)
        
    return falling_results
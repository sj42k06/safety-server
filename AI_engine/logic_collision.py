#중장비 접근(스케일 행렬 이용)
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

def analyze_collision(structured_frames, ppe_analysis, pixel_per_meter=100, safe_distance_m=3.0):
    H_matrix = get_scale_matrix(pixel_per_meter)
    collision_results = []

    # ppe_analysis 결과의 workers 키를 사용하여 순회
    for frame, ppe_frame in zip(structured_frames, ppe_analysis):
        frame_collision = {"frame": frame["frame"], "alerts": []}
        
        for worker in ppe_frame["workers"]:
            # 작업자 발바닥 위치 변환
            wx, wy = transform_point(worker["fx"], worker["fy"], H_matrix)
            worker_pos = Point(wx, wy)

            # machines(중장비)와의 거리 계산
            for machine in frame["machines"]:
                mx, my = transform_point(machine["fx"], machine["fy"], H_matrix)
                dist = worker_pos.distance(Point(mx, my))
                
                if dist <= safe_distance_m:
                    frame_collision["alerts"].append({
                        "worker_bbox": worker["bbox"],
                        "dist": round(dist, 2)
                    })
        collision_results.append(frame_collision)
    return collision_results
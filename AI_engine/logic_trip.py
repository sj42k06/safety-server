# 통로영역 내에 자재방치
import time
from shapely.geometry import Point, Polygon

# 통로 ROI 설정(임의로 지정한 상태 -> 후에 변경 필요*)
PATHWAY_COORDS = [(100, 500), (400, 500), (450, 800), (50, 800)]
PATHWAY_ZONE = Polygon(PATHWAY_COORDS)

# 자재별 방치 시간을 추적하기 위한 전역 딕셔너리
material_timers = {}

def analyze_trip(structured_frames):
    
    #통로 ROI 내 자재가 머문 시간을 분석하여 반환합니다.
    
    trip_results = []

    for frame in structured_frames:
        frame_id = frame["frame"]
        frame_data = {"frame": frame_id, "trip_events": []}
        current_material_ids = []

        for material in frame["materials"]:
            mat_id = material.get("id", f"mat_{int(material['fx'])}_{int(material['fy'])}")
            current_material_ids.append(mat_id)
            
            mat_point = Point(material["fx"], material["fy"])
            
            if PATHWAY_ZONE.contains(mat_point):
                if mat_id not in material_timers:
                    material_timers[mat_id] = time.time()
                
                elapsed = time.time() - material_timers[mat_id]
                
                # 경과 시간 데이터만 기록하여 전달[cite: 1]
                frame_data["trip_events"].append({
                    "mat_id": mat_id,
                    "type": material.get("sub_type", "material"),
                    "bbox": material["bbox"],
                    "elapsed_sec": round(elapsed, 1)
                })
            else:
                material_timers.pop(mat_id, None)

        # 화면에서 사라진 자재 타이머 정리
        for stored_id in list(material_timers.keys()):
            if stored_id not in current_material_ids:
                material_timers.pop(stored_id, None)

        trip_results.append(frame_data)
        
    return trip_results
import math

# AI/데이터 분석 환경에서 널리 쓰이는 scikit-learn 탐지 시 클러스터링 활용
try:
    import numpy as np
    from sklearn.cluster import DBSCAN
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False

def analyze_crowd_dbscan(persons, distance_threshold, min_people_limit):
    """
    DBSCAN 알고리즘을 사용해 밀집 그룹을 정확하게 식별합니다.
    """
    num_persons = len(persons)
    if num_persons < min_people_limit:
        return False, 0, [-1] * num_persons

    # detect_ppe.py에서 생성하고 structure_ppe.py가 전달한 fx, fy 좌표 활용
    coordinates = np.array([[p["fx"], p["fy"]] for p in persons])
    
    # eps: 같은 밀집 그룹으로 판단할 최대 픽셀 거리
    # min_samples: 하나의 밀집 그룹을 형성하기 위한 최소 인원수
    db = DBSCAN(eps=distance_threshold, min_samples=min_people_limit).fit(coordinates)
    labels = db.labels_  # 각 사람별 그룹 ID 할당 (-1은 밀집되지 않은 노이즈)
    
    unique_labels = set(labels)
    if -1 in unique_labels:
        unique_labels.remove(-1)
        
    crowd_alert = len(unique_labels) > 0
    crowd_groups_count = len(unique_labels)
    
    # JSON 직렬화 호환성을 위해 정수형으로 변환하여 반환
    return crowd_alert, crowd_groups_count, [int(x) for x in labels]

def analyze_crowd_pure_python(persons, distance_threshold, min_people_limit):
    """
    scikit-learn 라이브러리가 없을 때 작동하는 기하 거리 연산 백업 함수입니다.
    """
    num_persons = len(persons)
    crowd_status_list = []
    
    # 각 사람 간의 유클리드 거리를 전수조사
    for i, p1 in enumerate(persons):
        close_people_count = 0
        for j, p2 in enumerate(persons):
            if i == j:
                continue
            dist = math.sqrt((p1["fx"] - p2["fx"])**2 + (p1["fy"] - p2["fy"])**2)
            if dist <= distance_threshold:
                close_people_count += 1
        
        # 본인을 포함하여 설정한 기준 인원 이상이 근접해 있다면 밀집으로 판단
        is_crowded = (close_people_count + 1) >= min_people_limit
        crowd_status_list.append(is_crowded)
        
    crowd_alert = any(crowd_status_list)
    return crowd_alert, crowd_status_list

def analyze_crowd_density(structured_frames, distance_threshold=100, min_people_limit=5):
    """
    structure_ppe.py의 출력 데이터 포맷을 입력받아 프레임별 인원 밀집 상황을 분석합니다.
    
    Args:
        structured_frames (list): structure_data() 함수가 반환한 구조화 데이터
        distance_threshold (int): 밀집 상황으로 판단할 작업자 간의 최대 거리 (픽셀 단위 단위)
        min_people_limit (int): 경보(Alert)를 발령할 최소 밀집 인원수 기준
    """
    results = []
    
    for frame in structured_frames:
        frame_result = {
            "frame": frame["frame"],
            "crowd_alert": False,       # 해당 프레임에 밀집 경보가 발생했는지 여부
            "crowd_groups_count": 0,    # 발견된 밀집 그룹의 총 개수
            "workers": []
        }
        
        persons = frame.get("persons", [])
        
        if HAS_SKLEARN:
            # 1. 고성능 알고리즘 모드 (scikit-learn 장착 시 그룹핑 ID까지 완벽 산출)
            alert, groups_count, labels = analyze_crowd_dbscan(persons, distance_threshold, min_people_limit)
            frame_result["crowd_alert"] = alert
            frame_result["crowd_groups_count"] = groups_count
            
            for idx, person in enumerate(persons):
                is_crowded = labels[idx] != -1
                frame_result["workers"].append({
                    "bbox": person["bbox"],
                    "fx": person["fx"],
                    "fy": person["fy"],
                    "is_crowded": is_crowded,
                    "crowd_group_id": labels[idx] if is_crowded else None
                })
        else:
            # 2. 호환성 모드 (수학 라이브러리 없을 때)
            alert, crowd_status_list = analyze_crowd_pure_python(persons, distance_threshold, min_people_limit)
            frame_result["crowd_alert"] = alert
            
            for idx, person in enumerate(persons):
                frame_result["workers"].append({
                    "bbox": person["bbox"],
                    "fx": person["fx"],
                    "fy": person["fy"],
                    "is_crowded": crowd_status_list[idx],
                    "crowd_group_id": None
                })
                
        results.append(frame_result)
        
    return results
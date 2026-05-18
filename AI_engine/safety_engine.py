import math

def calculate_precise_risk(possibility, severity):
    """
    위험성평가 기준  
    공식: 위험도 = ((가능성 * 중대성) / 25) * 100
    - 가능성(1~5) * 중대성(1~5) 체계로 최대값은 25점이며, 25로 나누어 % 점수를 산출합니다.
    """
    score = (possibility * severity) / 25.0 * 100
    return round(score, 1)

def get_risk_level(score):
    """
    변경된 정밀 위험 등급 기준 반영
    - 즉각조치 (60 ~ 100%) : EMERGENCY (또는 "즉각조치")
    - 위험     (30% 초과 ~ 60% 미만) : WARNING (또는 "위험")
    - 주의     (0 ~ 30%)   : CAUTION (또는 "주의")
    """
    if score >= 60.0:
        return "EMERGENCY"  # 즉각조치
    elif score > 30.0:     # 경계선 빈틈 방지를 위해 30% 초과로 설정
        return "WARNING"    # 위험
    else:
        return "CAUTION"    # 주의

def integrate_analysis(ppe_analysis_results, collision_results, trip_results, crowd_results):
    """
    보호구(PPE), 중장비 충돌, 통로 자재 방치, 인원 밀집 분석 결과를 통합하여
    현장의 프레임별 최종 위험도 및 리포트를 생성합니다.
    """
    final_dashboard = []
    
    # 데이터 매핑의 유연성을 위해 프레임명(파일명)을 키로 하는 딕셔너리로 변환
    coll_map = {f["frame"]: f for f in collision_results}
    trip_map = {f["frame"]: f for f in trip_results}
    crowd_map = {f["frame"]: f for f in crowd_results}
    
    for ppe_f in ppe_analysis_results:
        frame_name = ppe_f["frame"]
        
        # 종합 대시보드 구조 선언
        summary = {
            "frame": frame_name,
            "frame_crowd_alert": False,
            "frame_crowd_groups": 0,
            "worker_reports": [],
            "site_reports": []
        }
        
        # 매핑 데이터 획득 (해당 프레임 데이터가 없을 시 기본 구조 대입으로 Crash 방지)
        coll_f = coll_map.get(frame_name, {"alerts": []})
        trip_f = trip_map.get(frame_name, {"trip_events": []})
        crowd_f = crowd_map.get(frame_name, {"crowd_alert": False, "crowd_groups_count": 0, "workers": []})
        
        # 1. 현장 전체 인원 밀집도 반영
        summary["frame_crowd_alert"] = crowd_f.get("crowd_alert", False)
        summary["frame_crowd_groups"] = crowd_f.get("crowd_groups_count", 0)
        
        # 밀집 인원 탐색 속도 향상을 위해 bbox 기반 맵 생성
        crowd_worker_map = {w["bbox"]: w for w in crowd_f.get("workers", [])}
        
        # 2. 작업자 중심 위험 분석 (PPE 불량, 중장비 충돌 근접, 인원 밀집 지역 포함)
        for worker in ppe_f["workers"]:
            worker_bbox = worker["bbox"]
            
            # 해당 작업자의 중장비 충돌 거리 검출
            dist_info = next((a["dist"] for a in coll_f.get("alerts", []) if a["worker_bbox"] == worker_bbox), None)
            # 해당 작업자의 밀집 구역 포함 여부 검출
            crowd_worker_info = crowd_worker_map.get(worker_bbox, {"is_crowded": False, "crowd_group_id": None})
            
            report = {
                "bbox": worker_bbox,
                "ppe_status": {"helmet": worker["helmet"], "vest": worker["vest"]},
                "collision_dist": dist_info,
                "is_crowded": crowd_worker_info["is_crowded"],
                "crowd_group_id": crowd_worker_info["crowd_group_id"],
                "detailed_risk_scores": [],
                "final_risk_score": 0.0,
                "final_risk_level": "CAUTION"
            }

            max_score = 0.0

            # 2-1. 안전모 미착용 (가능성: 4, 중대성: 3) -> 48% (위험)
            if worker["helmet"] == "NO_HELMET":
                score = calculate_precise_risk(possibility=4, severity=3)
                report["detailed_risk_scores"].append({"case": "NO_HELMET", "score": score})
                max_score = max(max_score, score)

            # 2-2. 안전조끼 미착용 (가능성: 4, 중대성: 3) -> 48% (위험)
            if worker["vest"] == "NO_VEST":
                score = calculate_precise_risk(possibility=4, severity=3)
                report["detailed_risk_scores"].append({"case": "NO_VEST", "score": score})
                max_score = max(max_score, score)

            # 2-3. 중장비 협착 위험 (가능성: 3, 중대성: 5) -> 60% (즉각조치)
            if dist_info is not None and dist_info < 2.0:
                score = calculate_precise_risk(possibility=3, severity=5)
                report["detailed_risk_scores"].append({"case": "HEAVY_MACHINERY_PROXIMITY", "score": score})
                max_score = max(max_score, score)

            # 2-4. 작업자 밀집 (가능성: 3, 중대성: 2) -> 24% (주의)
            if crowd_worker_info["is_crowded"]:
                score = calculate_precise_risk(possibility=3, severity=2)
                report["detailed_risk_scores"].append({"case": "HAZARDOUS_ZONE_CROWD", "score": score})
                max_score = max(max_score, score)

            # 복합 위험 요소 결합
            if len(report["detailed_risk_scores"]) > 1:
                total_combined_score = sum(item["score"] for item in report["detailed_risk_scores"])
                report["final_risk_score"] = min(100.0, round(total_combined_score, 1))
            else:
                report["final_risk_score"] = max_score
                
            report["final_risk_level"] = get_risk_level(report["final_risk_score"])
            summary["worker_reports"].append(report)
        
        # 3. 현장 환경 위험 분석 (통로 내 자재물 10초 이상 적치 방치)
        # 통로 자재 방치 (가능성: 4, 중대성: 2) -> 32% (위험)
        for event in trip_f.get("trip_events", []):
            if event["elapsed_sec"] >= 10.0:
                trip_score = calculate_precise_risk(possibility=4, severity=2)
                
                summary["site_reports"].append({
                    "type": "TRIP_HAZARD",
                    "object": event["type"],
                    "elapsed": event["elapsed_sec"],
                    "bbox": event["bbox"],
                    "risk_score": trip_score,
                    "risk_level": get_risk_level(trip_score)
                })
        
        final_dashboard.append(summary)
        
    return final_dashboard
def integrate_analysis(ppe_analysis_results, collision_results, falling_results, trip_results):
    
    #PPE, 중장비, 낙하물, 통로 자재 방치 결과를 결합하여 최종 위험 등급을 결정합니다.
    
    final_dashboard = []
    
    # 네 가지 분석 결과를 프레임별로 매칭하여 순회합니다.
    for ppe_f, coll_f, fall_f, trip_f in zip(ppe_analysis_results, collision_results, falling_results, trip_results):
        summary = {"frame": ppe_f["frame"], "worker_reports": [], "site_reports": []}
        
        # --- 1. 작업자 중심 위험 분석 (PPE, 충돌, 낙하) ---
        for worker in ppe_f["workers"]:
            worker_bbox = worker["bbox"]
            dist_info = next((a["dist"] for a in coll_f["alerts"] if a["worker_bbox"] == worker_bbox), None)
            fall_info = next((a["dist"] for a in fall_f["falling_alerts"] if a["worker_bbox"] == worker_bbox), None)
            
            report = {
                "bbox": worker_bbox,
                "ppe_status": {"helmet": worker["helmet"], "vest": worker["vest"]},
                "collision_dist": dist_info,
                "falling_dist": fall_info,
                "final_risk": "NORMAL"
            }

            score = 0
            if worker["helmet"] == "NO_HELMET": score += 50
            if worker["vest"] == "NO_VEST": score += 30
            if dist_info is not None and dist_info < 2.0: score += 50 # 중장비 근접[cite: 7]
            if fall_info is not None and fall_info < 2.0: score += 60 # 낙하 위험[cite: 1]

            if score >= 100: report["final_risk"] = "EMERGENCY"
            elif score >= 50: report["final_risk"] = "WARNING"
            
            summary["worker_reports"].append(report)
        
        # --- 2. 현장 환경 위험 분석 (통로 자재 방치) ---
        for event in trip_f["trip_events"]:
            # 10초 이상 방치 시 사이트 경보 생성
            if event["elapsed_sec"] >= 10.0:
                summary["site_reports"].append({
                    "type": "TRIP_HAZARD",
                    "object": event["type"],
                    "elapsed": event["elapsed_sec"],
                    "bbox": event["bbox"],
                    "risk_level": "WARNING"
                })
        
        final_dashboard.append(summary)
        
    return final_dashboard
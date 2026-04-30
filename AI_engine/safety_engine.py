# 위험도 종합 점수
def integrate_analysis(ppe_results, collision_results):
    final_dashboard = []
    for ppe, coll in zip(ppe_results, collision_results):
        summary = {"frame": ppe["frame"], "reports": []}
        
        for worker in ppe["workers"]:
            # 충돌 위험 확인[cite: 9]
            dist_info = next((a["dist"] for a in coll["alerts"] if a["worker_bbox"] == worker["bbox"]), None)
            
            report = {
                "bbox": worker["bbox"],
                "ppe_status": {"helmet": worker["helmet"], "vest": worker["vest"]},
                "distance_m": dist_info,
                "final_risk": "NORMAL"
            }

            # 점수 기반 판정[cite: 9]
            score = 0
            if worker["risk"] == "HIGH": score += 50
            if dist_info is not None: score += 50 # 안전거리 미확보

            if score >= 100: report["final_risk"] = "EMERGENCY"
            elif score >= 50: report["final_risk"] = "WARNING"
            
            summary["reports"].append(report)
        final_dashboard.append(summary)
    return final_dashboard
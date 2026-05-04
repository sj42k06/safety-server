def structure_data(results_data):
    
    #detect_all에서 반환된 데이터를 12종 클래스 체계에 맞춰 
    #인원, 보호구, 기계, 갈고리, 자재 카테고리로 상세 분류합니다.
    
    structured = []
    
    for frame_data in results_data:
        # 카테고리별 리스트 초기화
        persons = []    # 사람
        helmets = []    # 안전모 관련 (Hardhat, NO-Hardhat)
        vests = []      # 조끼 관련 (Safety Vest, NO-Safety Vest)
        machines = []   # 중장비 및 기계 (Excavator, machinery)
        hooks = []      # 갈고리 (hook) 
        materials = []  # 건설 자재 (board, brick, rebar, wood)
        
        for det in frame_data["detections"]:
            label = det["type"]  # detect_ppe.py에서 소문자로 처리된 라벨
            obj_data = {
                "bbox": det["bbox"], 
                "fx": det["fx"], 
                "fy": det["fy"], 
                "conf": det["confidence"]
            }

            # 1. 인원 분류
            if label == "person":
                persons.append(obj_data)
                
            # 2. 안전모 착용 여부 분류
            elif label in ["hardhat", "no-hardhat"]:
                obj_data["status"] = label 
                helmets.append(obj_data)
                
            # 3. 안전조끼 착용 여부 분류
            elif label in ["safety vest", "no-safety vest"]:
                obj_data["status"] = label
                vests.append(obj_data)
                
            # 4. 기계 장비 분류
            elif label in ["excavator", "machinery"]:
                obj_data["sub_type"] = label
                machines.append(obj_data)

            # 5. 갈고리 분류
            elif label == "hook":
                hooks.append(obj_data)
                
            # 6. 건설 자재 분류
            elif label in ["board", "brick", "rebar", "wood"]:
                obj_data["sub_type"] = label
                materials.append(obj_data)

        # 프레임별로 구조화된 데이터 생성
        structured.append({
            "frame": frame_data["frame"], 
            "width": frame_data["width"], 
            "height": frame_data["height"],
            "persons": persons, 
            "helmets": helmets, 
            "vests": vests, 
            "machines": machines, 
            "hooks": hooks,       
            "materials": materials
        })
        
    return structured
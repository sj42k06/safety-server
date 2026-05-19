import sys
print("pipeline.py 시작!", file=sys.stderr)
print("import 시작", file=sys.stderr)
import os
import json
import cv2
print("cv2 완료", file=sys.stderr)
import pymysql
print("pymysql 완료", file=sys.stderr)
import cloudinary
import cloudinary.uploader
import urllib.request
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
print("모듈 import 시작", file=sys.stderr)
import requests as http_requests
AI_SERVER = os.getenv('AI_SERVER_URL', 'http://localhost:5001')

def detect_all(input_folder):
    """Flask AI 서버에 탐지 요청 (YOLO 직접 로드 안 함)"""
    results_data = []
    if not os.path.exists(input_folder):
        return results_data
    valid_extensions = (".jpg", ".jpeg", ".png")
    image_files = [f for f in os.listdir(input_folder) if f.lower().endswith(valid_extensions)]
    for filename in image_files:
        filepath = os.path.join(input_folder, filename)
        try:
            with open(filepath, 'rb') as f:
                response = http_requests.post(
                    AI_SERVER + '/detect-all',
                    files={'image': (filename, f, 'image/jpeg')},
                    timeout=30
                )
            if response.status_code == 200:
                data = response.json()
                results_data.append(data)
        except Exception as e:
            print(f"Flask 탐지 오류 ({filename}): {e}", file=sys.stderr)
    return results_data

print("detect_ppe 완료 (Flask 모드)", file=sys.stderr)
from structure_ppe import structure_data
print("structure_ppe 완료", file=sys.stderr)
from logic_ppe import analyze_ppe
print("logic_ppe 완료", file=sys.stderr)
from logic_crowd import analyze_crowd_density
print("logic_crowd 완료", file=sys.stderr)
from logic_collision import analyze_collision
print("logic_collision 완료", file=sys.stderr)
from logic_falling import analyze_falling
print("logic_falling 완료", file=sys.stderr)
from logic_trip import analyze_trip
print("logic_trip 완료", file=sys.stderr)
from safety_engine import calculate_precise_risk, get_risk_level, integrate_analysis
print("safety_engine 완료", file=sys.stderr)

cloudinary.config(
    cloud_name=os.getenv('CLOUDINARY_CLOUD_NAME', 'dxxaiv5ii'),
    api_key=os.getenv('CLOUDINARY_API_KEY', '771944593733371'),
    api_secret=os.getenv('CLOUDINARY_API_SECRET', 'AUVfLy-K6Q4CjRo9zno2P7kOoa8')
)

OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', '')

def get_db_connection():
    return pymysql.connect(
        host=os.getenv('MYSQLHOST', 'junction.proxy.rlwy.net'),
        user=os.getenv('MYSQLUSER', 'root'),
        password=os.getenv('MYSQLPASSWORD', 'uXLlzlUcfWYHaSXqVihQFxzhGnjcxbZR'),
        db=os.getenv('MYSQLDATABASE', 'railway'),
        port=int(os.getenv('MYSQLPORT', 50160)),
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor
    )

def upload_to_cloudinary(image_path):
    try:
        result = cloudinary.uploader.upload(image_path, folder="safety_frames")
        return result.get('secure_url', '')
    except Exception as e:
        print(f"Cloudinary 업로드 실패: {e}", file=sys.stderr)
        return ''

def call_openai(prompt):
    try:
        url = "https://api.openai.com/v1/chat/completions"
        body = json.dumps({
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7
        }).encode('utf-8')
        req = urllib.request.Request(url, data=body, headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENAI_API_KEY}"
        }, method="POST")
        with urllib.request.urlopen(req, timeout=30) as res:
            data = json.loads(res.read().decode('utf-8'))
            return data['choices'][0]['message']['content']
    except Exception as e:
        print(f"OpenAI 호출 실패: {e}", file=sys.stderr)
        return None

def draw_bounding_boxes_all(image_path, frame_structured, ppe_frame, output_path):
    img = cv2.imread(image_path)
    if img is None:
        return image_path

    # 작업자 PPE 박스
    for worker in ppe_frame.get('workers', []):
        x1, y1, x2, y2 = worker['bbox']
        color = (0,0,255) if worker['risk']=='HIGH' else (0,165,255) if worker['risk']=='MEDIUM' else (0,255,0)
        cv2.rectangle(img, (x1,y1), (x2,y2), color, 2)
        label = f"{worker['helmet']} | {worker['vest']}"
        cv2.putText(img, label, (x1, y1-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

    # 중장비 (노란색)
    for machine in frame_structured.get('machines', []):
        x1, y1, x2, y2 = machine['bbox']
        cv2.rectangle(img, (x1,y1), (x2,y2), (0,255,255), 2)
        cv2.putText(img, machine.get('sub_type','machinery'), (x1,y1-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,255,255), 2)

    # 자재 (보라색)
    for mat in frame_structured.get('materials', []):
        x1, y1, x2, y2 = mat['bbox']
        cv2.rectangle(img, (x1,y1), (x2,y2), (255,0,255), 2)
        cv2.putText(img, 'material', (x1,y1-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255,0,255), 2)

    # 후크 (하늘색)
    for hook in frame_structured.get('hooks', []):
        x1, y1, x2, y2 = hook['bbox']
        cv2.rectangle(img, (x1,y1), (x2,y2), (255,255,0), 2)
        cv2.putText(img, 'hook', (x1,y1-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255,255,0), 2)

    cv2.imwrite(output_path, img)
    return output_path

def create_annotated_video(frames_folder, structured, ppe_risks, output_path):
    frames = sorted([f for f in os.listdir(frames_folder) if f.endswith('.jpg') and '_boxed' not in f])
    if not frames:
        return None
    first = cv2.imread(os.path.join(frames_folder, frames[0]))
    if first is None:
        return None
    h, w = first.shape[:2]
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, 1.0, (w, h))
    ppe_map    = {r['frame']: r for r in ppe_risks}
    struct_map = {s['frame']: s for s in structured}

    for frame_file in frames:
        img = cv2.imread(os.path.join(frames_folder, frame_file))
        if img is None:
            continue
        ppe_frame    = ppe_map.get(frame_file, {'workers': []})
        struct_frame = struct_map.get(frame_file, {})

        for worker in ppe_frame.get('workers', []):
            x1,y1,x2,y2 = worker['bbox']
            color = (0,0,255) if worker['risk']=='HIGH' else (0,165,255) if worker['risk']=='MEDIUM' else (0,255,0)
            cv2.rectangle(img, (x1,y1),(x2,y2), color, 2)
            cv2.putText(img, f"{worker['helmet']}|{worker['vest']}", (x1,y1-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
        for machine in struct_frame.get('machines', []):
            x1,y1,x2,y2 = machine['bbox']
            cv2.rectangle(img, (x1,y1),(x2,y2), (0,255,255), 2)
        for mat in struct_frame.get('materials', []):
            x1,y1,x2,y2 = mat['bbox']
            cv2.rectangle(img, (x1,y1),(x2,y2), (255,0,255), 2)
        for hook in struct_frame.get('hooks', []):
            x1,y1,x2,y2 = hook['bbox']
            cv2.rectangle(img, (x1,y1),(x2,y2), (255,255,0), 2)
        out.write(img)
    out.release()
    return output_path

def get_rule_id(cursor, case_name):
    """safety_rules에서 case_name으로 rule_id 조회"""
    cursor.execute("SELECT rule_id FROM safety_rules WHERE case_name = %s", (case_name,))
    row = cursor.fetchone()
    return row['rule_id'] if row else None

def generate_ai_report(structured, ppe_risks, collision_risks, falling_risks, trip_risks, final_result, video_name):
    helmet_violated    = False
    vest_violated      = False
    collision_detected = False
    falling_detected   = False
    trip_detected      = False
    machine_detected   = False
    material_detected  = False
    hook_detected      = False
    emergency_exists   = False
    warning_exists     = False

    for frame in ppe_risks:
        for worker in frame.get('workers', []):
            if 'NO' in str(worker.get('helmet','')).upper(): helmet_violated = True
            if 'NO' in str(worker.get('vest','')).upper():   vest_violated   = True

    for frame in collision_risks:
        if frame.get('alerts'): collision_detected = True

    for frame in falling_risks:
        if frame.get('falling_alerts'): falling_detected = True

    for frame in trip_risks:
        if frame.get('trip_events'): trip_detected = True

    for frame in structured:
        if frame.get('machines'):  machine_detected  = True
        if frame.get('materials'): material_detected = True
        if frame.get('hooks'):     hook_detected     = True

    for frame in final_result:
        for report in frame.get('worker_reports', []):
            if report.get('final_risk') == 'EMERGENCY': emergency_exists = True
            elif report.get('final_risk') == 'WARNING': warning_exists   = True
        for report in frame.get('site_reports', []):
            if report.get('risk_level') == 'WARNING': warning_exists = True

    # 위험도 판단
    if emergency_exists:
        risk_grade = "고위험"; risk_score = 95
    elif warning_exists or helmet_violated:
        risk_grade = "고위험"; risk_score = 85
    elif vest_violated or collision_detected or falling_detected or trip_detected or machine_detected or hook_detected:
        risk_grade = "관찰"; risk_score = 55
    elif material_detected:
        risk_grade = "관찰"; risk_score = 40
    else:
        risk_grade = "정상"; risk_score = 15

    # 감지된 사고 케이스 목록
    detected_cases = []
    if helmet_violated or vest_violated: detected_cases.append("안전복 미착용")
    if machine_detected or collision_detected: detected_cases.append("중장비 작업 반경 내 인원 접근 감지")
    if falling_detected or hook_detected: detected_cases.append("출입 금지 구역 또는 낙하물 위험 구역 무단 진입 감지")
    if trip_detected or material_detected: detected_cases.append("작업 통로 및 비상 통로 자재물 적치 감지")

    # 웹캠에서 전달된 위험 타입 추가 (위험구역 진입 등)
    extra_danger_types = []
    danger_types_env = os.environ.get('DANGER_TYPES', '')
    if danger_types_env:
        import json as _json
        try:
            extra_danger_types = _json.loads(danger_types_env)
        except: pass
    for dt in extra_danger_types:
        if dt not in detected_cases and dt not in ['보호구 미착용', '위험 감지']:
            detected_cases.append(dt)

    prompt = f"""
당신은 산업현장 안전관리 전문가입니다. 아래 AI 분석 결과를 바탕으로 안전 보고서를 작성해주세요.

[분석 결과]
- 분석 영상: {video_name}
- 감지된 사고 케이스: {', '.join(detected_cases) if detected_cases else '없음'}
- 안전모 미착용: {"있음" if helmet_violated else "없음"}
- 안전조끼 미착용: {"있음" if vest_violated else "없음"}
- 중장비/차량 감지: {"있음" if machine_detected else "없음"}
- 중장비 근접 접근: {"있음" if collision_detected else "없음"}
- 낙하물/후크 위험: {"있음" if (falling_detected or hook_detected) else "없음"}
- 자재 방치 감지: {"있음" if (trip_detected or material_detected) else "없음"}
- 위험도: {risk_score}%
- 위험 등급: {risk_grade}

반드시 아래 JSON 형식으로만 응답하세요. 마크다운 없이 순수 JSON만:
{{
  "law_references": "위반된 산업안전보건법 조항 및 내용을 구체적으로 작성",
  "recommendations": [
    "구체적인 권고사항 1",
    "구체적인 권고사항 2",
    "구체적인 권고사항 3"
  ],
  "summary_eval": "3~4문장으로 종합평가 작성",
  "report_title": "날짜와 감지 내용을 포함한 보고서 제목 (예: 2026-05-10 보호구 미착용 감지 보고서)"
}}
"""

    openai_result = call_openai(prompt)

    if openai_result:
        try:
            clean = openai_result.strip()
            if "```" in clean:
                clean = clean.split("```")[1]
                if clean.startswith("json"): clean = clean[4:]
            parsed = json.loads(clean.strip())
            return {
                "risk_grade": risk_grade, "risk_score": risk_score,
                "helmet_violated": helmet_violated, "vest_violated": vest_violated,
                "machine_detected": machine_detected, "collision_detected": collision_detected,
                "falling_detected": falling_detected or hook_detected,
                "trip_detected": trip_detected or material_detected,
                "detected_cases": detected_cases,
                "law_references": parsed.get("law_references", ""),
                "recommendations": parsed.get("recommendations", []),
                "summary_eval": parsed.get("summary_eval", ""),
                "report_title": parsed.get("report_title", f"{datetime.now().strftime('%Y-%m-%d')} 안전 분석 보고서")
            }
        except: pass

    # OpenAI 실패 시 기본 보고서
    law_refs = []
    if helmet_violated or vest_violated: law_refs.append("산업안전보건법 제38조제1항 - 보호구 착용 의무 위반")
    if machine_detected or collision_detected: law_refs.append("산업안전보건법 제38조 - 중장비 작업 반경 안전 의무 위반")
    if falling_detected or hook_detected: law_refs.append("산업안전보건법 제38조 - 낙하물 위험 방지 의무 위반")
    if trip_detected or material_detected: law_refs.append("산업안전보건법 제38조 - 통로 안전 확보 의무 위반")

    recommendations = []
    if helmet_violated: recommendations.append("안전모 미착용 감지 — 즉시 작업 중지 후 착용 확인")
    if vest_violated: recommendations.append("안전조끼 미착용 감지 — 현장 출입 통제 조치")
    if machine_detected: recommendations.append("중장비 감지 — 작업 반경 내 안전 거리 확보")
    if collision_detected: recommendations.append("중장비 근접 접근 감지 — 즉시 작업 반경 이탈")
    if falling_detected or hook_detected: recommendations.append("낙하물/후크 위험 감지 — 즉시 해당 구역 대피")
    if trip_detected or material_detected: recommendations.append("자재 방치 감지 — 즉시 자재 정리 및 통로 확보")
    if not recommendations: recommendations.append("현재 특이사항 없음. 지속적 모니터링 유지")

    case_str = ', '.join(detected_cases) if detected_cases else '이상없음'
    report_title = f"{datetime.now().strftime('%Y-%m-%d')} {case_str} 보고서"

    return {
        "risk_grade": risk_grade, "risk_score": risk_score,
        "helmet_violated": helmet_violated, "vest_violated": vest_violated,
        "machine_detected": machine_detected, "collision_detected": collision_detected,
        "falling_detected": falling_detected or hook_detected,
        "trip_detected": trip_detected or material_detected,
        "detected_cases": detected_cases,
        "law_references": " | ".join(law_refs) if law_refs else "해당 없음",
        "recommendations": recommendations,
        "summary_eval": f"위험등급: {risk_grade} ({risk_score}%). 감지: {case_str}",
        "report_title": report_title
    }

def is_image_file(path):
    return os.path.splitext(path)[1].lower() in ['.jpg', '.jpeg', '.png', '.bmp']

def extract_frames_cv2(video_path, frames_folder):
    if is_image_file(video_path):
        frame_path = os.path.join(frames_folder, "frame_0001.jpg")
        img = cv2.imread(video_path)
        if img is None:
            raise RuntimeError(f"이미지 열기 실패: {video_path}")
        cv2.imwrite(frame_path, cv2.resize(img, (640, 480)))
        return 1

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"영상 열기 실패: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    interval = max(1, int(fps))
    count = 0; saved = 0
    while True:
        ret, frame = cap.read()
        if not ret: break
        if count % interval == 0:
            frame_path = os.path.join(frames_folder, f"frame_{saved+1:04d}.jpg")
            cv2.imwrite(frame_path, cv2.resize(frame, (640, 480)))
            saved += 1
        count += 1
    cap.release()
    return saved

def run_pipeline(video_path, user_id=1):
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        video_name = os.path.splitext(os.path.basename(video_path))[0]
        frames_folder = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..", "frames", video_name
        )
        os.makedirs(frames_folder, exist_ok=True)

        print(f"프레임 추출 시작", file=sys.stderr)
        extract_frames_cv2(video_path, frames_folder)
        print(f"프레임 추출 완료", file=sys.stderr)

        print(f"PPE 탐지 시작", file=sys.stderr)
        raw_ppe = detect_all(frames_folder)
        print(f"PPE 탐지 완료: {len(raw_ppe)}프레임", file=sys.stderr)

        structured      = structure_data(raw_ppe)
        ppe_risks       = analyze_ppe(structured)
        collision_risks = analyze_collision(structured, ppe_risks)
        falling_risks   = analyze_falling(structured, ppe_risks)
        trip_risks      = analyze_trip(structured)
        final_result    = integrate_analysis(ppe_risks, collision_risks, falling_risks, trip_risks)
        ai_report       = generate_ai_report(structured, ppe_risks, collision_risks, falling_risks, trip_risks, final_result, video_name)

        print(f"보고서 생성 완료: {ai_report['risk_grade']}", file=sys.stderr)

        # ── 바운딩박스 영상 생성 ──
        annotated_video_path = os.path.join(frames_folder, "annotated.mp4")
        create_annotated_video(frames_folder, structured, ppe_risks, annotated_video_path)

        # ── 대표 이미지 선택 및 업로드 ──
        image_url = ''
        struct_map = {s['frame']: s for s in structured}

        for ppe_frame in ppe_risks:
            frame_filename = ppe_frame['frame']
            struct_frame   = struct_map.get(frame_filename, {})

            has_violation = any(w['risk'] in ['HIGH','MEDIUM'] for w in ppe_frame.get('workers',[]))
            has_machine   = bool(struct_frame.get('machines'))
            has_material  = bool(struct_frame.get('materials'))
            has_hook      = bool(struct_frame.get('hooks'))

            if not (has_violation or has_machine or has_material or has_hook):
                continue

            f_path     = os.path.join(frames_folder, frame_filename)
            boxed_path = f_path.replace('.jpg', '_boxed.jpg')
            draw_bounding_boxes_all(f_path, struct_frame, ppe_frame, boxed_path)

            if os.path.exists(boxed_path):
                image_url = upload_to_cloudinary(boxed_path)
            elif os.path.exists(f_path):
                image_url = upload_to_cloudinary(f_path)

            if image_url:
                break  # 대표 이미지 1장만

        # ── 위험도 계산 (safety_engine 공식) ──
        detected_cases = ai_report['detected_cases']

        # 케이스별 rule_id 및 위험도 저장
        case_rule_map = {
            '안전복 미착용': {'rule_id': 3, 'possibility': 4, 'severity': 3},
            '출입 금지 구역 또는 낙하물 위험 구역 무단 진입 감지': {'rule_id': 1, 'possibility': 3, 'severity': 5},
            '중장비 작업 반경 내 인원 접근 감지': {'rule_id': 5, 'possibility': 3, 'severity': 5},
            '작업 통로 및 비상 통로 자재물 적치 감지': {'rule_id': 2, 'possibility': 4, 'severity': 2},
            '작업자 밀집 위험 감지': {'rule_id': 4, 'possibility': 3, 'severity': 2},
        }

        # 현재 세션 찾기
        import pytz
        korea_tz = pytz.timezone('Asia/Seoul')
        now = datetime.now(korea_tz)
        hour = now.hour
        if 6 <= hour < 14: shift_type = '오전'
        elif 14 <= hour < 22: shift_type = '오후'
        else: shift_type = '야간'

        cursor.execute("""
            SELECT session_id FROM monitoring_sessions
            WHERE session_date = %s AND shift_type = %s
            ORDER BY session_id DESC LIMIT 1
        """, (now.date(), shift_type))
        session_row = cursor.fetchone()
        session_id = session_row['session_id'] if session_row else None

        last_risk_id = None
        for case_name in detected_cases:
            case_info = case_rule_map.get(case_name, {'rule_id': 3, 'possibility': 4, 'severity': 3})
            risk_percent = calculate_precise_risk(case_info['possibility'], case_info['severity'])
            risk_level = get_risk_level(risk_percent)
            risk_level_kr = {'EMERGENCY': '즉각조치', 'WARNING': '위험', 'CAUTION': '주의'}.get(risk_level, '주의')

            cursor.execute("""
                INSERT INTO risk_events
                (session_id, rule_id, detected_time, risk_case, accident_type,
                 likelihood_score, severity_score, risk_score, risk_percent, risk_level,
                 description, image_path, bbox_image_path, created_at)
                SELECT %s, rule_id, %s, case_name, accident_type,
                       %s, %s, %s, %s, %s,
                       %s, %s, %s, %s
                FROM safety_rules WHERE rule_id = %s
            """, (
                session_id, now,
                case_info['possibility'], case_info['severity'],
                int(case_info['possibility'] * case_info['severity']),
                risk_percent, risk_level_kr,
                ai_report['summary_eval'], image_url, image_url, now,
                case_info['rule_id']
            ))
            last_risk_id = cursor.lastrowid

            # action_logs 저장
            cursor.execute("""
                INSERT INTO action_logs (risk_id, action_status, action_manager_id, created_at)
                VALUES (%s, '미조치', %s, %s)
            """, (last_risk_id, user_id, now))

        # 세션 업데이트
        if session_id and detected_cases:
            cursor.execute("""
                UPDATE monitoring_sessions
                SET risk_event_count = risk_event_count + %s, session_status = '위험발생'
                WHERE session_id = %s
            """, (len(detected_cases), session_id))

        report_id = last_risk_id or 0

        conn.commit()
        print(json.dumps({"status": "success", "report_id": report_id}, ensure_ascii=False))

    except Exception as e:
        conn.rollback()
        print(f"오류 발생: {e}", file=sys.stderr)
        print(json.dumps({"error": str(e)}))
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(1)
    user_id = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    run_pipeline(sys.argv[1], user_id)

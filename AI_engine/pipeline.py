import sys
import os
import json
import cv2
import pymysql
import cloudinary
import cloudinary.uploader
import urllib.request
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from detect_objects import detect_objects
from detect_ppe import detect_ppe
from structure import structure_data
from structure_ppe import structure_ppe_data
from logic_fall import analyze_fall_risk
from logic_ppe import analyze_ppe

# Cloudinary 설정
cloudinary.config(
    cloud_name=os.getenv('CLOUDINARY_CLOUD_NAME', 'dxxaiv5ii'),
    api_key=os.getenv('CLOUDINARY_API_KEY', '771944593733371'),
    api_secret=os.getenv('CLOUDINARY_API_SECRET', 'AUVfLy-K6Q4CjRo9zno2P7kOoa8')
)

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', 'AIzaSyBGRzwUiDIrIKCL5DK34-uJZjKGjHdMEqM')

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

def call_gemini(prompt):
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"
        body = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}]
        }).encode('utf-8')
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=30) as res:
            data = json.loads(res.read().decode('utf-8'))
            return data['candidates'][0]['content']['parts'][0]['text']
    except Exception as e:
        print(f"Gemini 호출 실패: {e}", file=sys.stderr)
        return None

def generate_ai_report(ppe_risks, video_name):
    total_frames = len(ppe_risks)
    total_workers = 0
    helmet_violations = 0
    vest_violations = 0
    high_risk_count = 0
    medium_risk_count = 0

    for frame in ppe_risks:
        for worker in frame['workers']:
            total_workers += 1
            if worker['helmet'] == 'NO_HELMET':
                helmet_violations += 1
            if worker['vest'] == 'NO_VEST':
                vest_violations += 1
            if worker['risk'] == 'HIGH':
                high_risk_count += 1
            elif worker['risk'] == 'MEDIUM':
                medium_risk_count += 1

    if high_risk_count > 3:
        risk_grade = "고위험"
        risk_score = 85
    elif high_risk_count > 0 or medium_risk_count > 3:
        risk_grade = "관찰"
        risk_score = 45
    else:
        risk_grade = "정상"
        risk_score = 15

    prompt = f"""
당신은 산업현장 안전관리 전문가입니다. 아래 AI 분석 결과를 바탕으로 안전 보고서를 작성해주세요.

[분석 결과]
- 분석 영상: {video_name}
- 총 분석 프레임: {total_frames}개
- 감지된 작업자 수: {total_workers}명
- 안전모 미착용: {helmet_violations}건
- 안전조끼 미착용: {vest_violations}건
- 고위험 감지: {high_risk_count}건
- 주의 감지: {medium_risk_count}건
- 위험 등급: {risk_grade}

아래 JSON 형식으로만 응답해주세요. 다른 텍스트 없이 JSON만:
{{
  "law_references": "위반된 산업안전보건법 조항 (조항명과 내용 포함, 없으면 '해당 없음')",
  "recommendations": ["권고사항1", "권고사항2", "권고사항3"],
  "summary_eval": "종합평가 내용 (3~4문장, 위험도/조치사항/법적책임 포함)"
}}
"""

    gemini_result = call_gemini(prompt)

    if gemini_result:
        try:
            clean = gemini_result.strip()
            if "```" in clean:
                clean = clean.split("```")[1]
                if clean.startswith("json"):
                    clean = clean[4:]
            parsed = json.loads(clean.strip())
            return {
                "risk_grade": risk_grade,
                "risk_score": risk_score,
                "total_workers": total_workers,
                "helmet_violations": helmet_violations,
                "vest_violations": vest_violations,
                "law_references": parsed.get("law_references", ""),
                "recommendations": parsed.get("recommendations", []),
                "summary_eval": parsed.get("summary_eval", "")
            }
        except:
            pass

    # Gemini 실패 시 기본값
    law_refs = []
    if helmet_violations > 0:
        law_refs.append("산업안전보건법 제38조 - 안전모 미착용")
    if vest_violations > 0:
        law_refs.append("산업안전보건법 제38조 - 안전조끼 미착용")

    recommendations = []
    if helmet_violations > 0:
        recommendations.append("안전모 착용 의무화 및 미착용자 즉시 작업 중지")
    if vest_violations > 0:
        recommendations.append("안전조끼 착용 의무화 및 현장 가시성 확보")
    if not recommendations:
        recommendations.append("현재 특이사항 없음. 지속적 모니터링 유지")

    return {
        "risk_grade": risk_grade,
        "risk_score": risk_score,
        "total_workers": total_workers,
        "helmet_violations": helmet_violations,
        "vest_violations": vest_violations,
        "law_references": " | ".join(law_refs) if law_refs else "해당 없음",
        "recommendations": recommendations,
        "summary_eval": f"총 {total_frames}개 프레임 분석 결과 {total_workers}명 감지, 안전모 미착용 {helmet_violations}건, 안전조끼 미착용 {vest_violations}건 확인. 위험등급: {risk_grade}"
    }

def extract_frames_cv2(video_path, frames_folder):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"영상 열기 실패: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    interval = max(1, int(fps))
    count = 0
    saved = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if count % interval == 0:
            frame_resized = cv2.resize(frame, (640, 480))
            frame_path = os.path.join(frames_folder, f"frame_{saved+1:04d}.jpg")
            cv2.imwrite(frame_path, frame_resized)
            saved += 1
        count += 1
    cap.release()
    return saved

def run_pipeline(video_path):
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        video_name = os.path.splitext(os.path.basename(video_path))[0]
        frames_folder = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..", "frames", video_name
        )
        os.makedirs(frames_folder, exist_ok=True)

        cursor.execute("INSERT INTO videos (video_path) VALUES (%s)", (video_path,))
        video_id = cursor.lastrowid

        cursor.execute("INSERT INTO reports (video_id, summary) VALUES (%s, %s)",
                       (video_id, f"{video_name} 안전 분석 보고서"))
        report_id = cursor.lastrowid

        extract_frames_cv2(video_path, frames_folder)
        raw_objects = detect_objects(frames_folder)
        raw_ppe = detect_ppe(frames_folder)
        structured = structure_data(raw_objects)
        structured_ppe = structure_ppe_data(raw_ppe)

        for frame in structured_ppe:
            if "detections" not in frame:
                frame["detections"] = frame.get("objects", [])

        ppe_risks = analyze_ppe(structured, structured_ppe)

        # Gemini AI 보고서 생성
        ai_report = generate_ai_report(ppe_risks, video_name)

        # 위험/주의 프레임만 Cloudinary 업로드
        for ppe_frame in ppe_risks:
            frame_filename = ppe_frame['frame']
            f_path = os.path.join(frames_folder, frame_filename)

            has_violation = any(w['risk'] in ['HIGH', 'MEDIUM'] for w in ppe_frame['workers'])
            cloudinary_url = ''
            if has_violation and os.path.exists(f_path):
                cloudinary_url = upload_to_cloudinary(f_path)

            frame_path_to_save = cloudinary_url if cloudinary_url else f_path
            cursor.execute(
                "INSERT INTO frames (video_id, frame_path, captured_at) VALUES (%s, %s, %s)",
                (video_id, frame_path_to_save, datetime.now())
            )
            frame_id = cursor.lastrowid

            for worker in ppe_frame['workers']:
                risk_map = {"HIGH": "위험", "MEDIUM": "주의", "LOW": "정상"}
                current_status = risk_map.get(worker['risk'], "정상")
                cursor.execute("""
                    INSERT INTO report_items (report_id, frame_id, event_time, status, description)
                    VALUES (%s, %s, %s, %s, %s)
                """, (report_id, frame_id, datetime.now(), current_status,
                      f"보호구: {worker['helmet']}, 조끼: {worker['vest']}"))

        # 보고서 업데이트
        cursor.execute("""
            UPDATE reports SET
                summary = %s,
                risk_grade = %s,
                risk_score = %s,
                total_workers = %s,
                helmet_violations = %s,
                vest_violations = %s,
                law_references = %s,
                recommendations = %s,
                summary_eval = %s
            WHERE report_id = %s
        """, (
            f"{video_name} 안전 분석 보고서",
            ai_report['risk_grade'],
            ai_report['risk_score'],
            ai_report['total_workers'],
            ai_report['helmet_violations'],
            ai_report['vest_violations'],
            ai_report['law_references'],
            json.dumps(ai_report['recommendations'], ensure_ascii=False),
            ai_report['summary_eval'],
            report_id
        ))

        conn.commit()
        print(json.dumps({"status": "success", "report_id": report_id}, ensure_ascii=False))

    except Exception as e:
        conn.rollback()
        print(json.dumps({"error": str(e)}))
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(1)
    run_pipeline(sys.argv[1])

import sys
print("pipeline.py 시작!", file=sys.stderr)
import os
import json
import cv2
import pymysql
import cloudinary
import cloudinary.uploader
import urllib.request
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from detect_ppe import detect_all
from structure_ppe import structure_data
from logic_ppe import analyze_ppe
from logic_collision import analyze_collision
from safety_engine import integrate_analysis

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

def draw_bounding_boxes(image_path, workers, output_path):
    img = cv2.imread(image_path)
    if img is None:
        return image_path

    for worker in workers:
        bbox = worker['bbox']
        x1, y1, x2, y2 = bbox

        if worker['risk'] == 'HIGH':
            color = (0, 0, 255)
        elif worker['risk'] == 'MEDIUM':
            color = (0, 165, 255)
        else:
            color = (0, 255, 0)

        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
        label = f"{worker['helmet']} | {worker['vest']}"
        cv2.putText(img, label, (x1, y1 - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

    cv2.imwrite(output_path, img)
    return output_path

def create_annotated_video(frames_folder, ppe_risks, output_path):
    frames = sorted([f for f in os.listdir(frames_folder) if f.endswith('.jpg') and '_boxed' not in f])
    if not frames:
        return None

    first = cv2.imread(os.path.join(frames_folder, frames[0]))
    if first is None:
        return None
    h, w = first.shape[:2]

    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, 1.0, (w, h))

    risk_map = {r['frame']: r for r in ppe_risks}

    for frame_file in frames:
        img = cv2.imread(os.path.join(frames_folder, frame_file))
        if img is None:
            continue

        if frame_file in risk_map:
            for worker in risk_map[frame_file].get('workers', []):
                x1, y1, x2, y2 = worker['bbox']
                if worker['risk'] == 'HIGH':
                    color = (0, 0, 255)
                elif worker['risk'] == 'MEDIUM':
                    color = (0, 165, 255)
                else:
                    color = (0, 255, 0)
                cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
                label = f"{worker['helmet']} | {worker['vest']}"
                cv2.putText(img, label, (x1, y1 - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

        out.write(img)

    out.release()
    return output_path

def generate_ai_report(ppe_risks, collision_risks, final_result, video_name):
    helmet_violated = False
    vest_violated = False
    collision_detected = False
    emergency_exists = False
    warning_exists = False

    for frame in ppe_risks:
        for worker in frame.get('workers', []):
            if 'NO' in str(worker.get('helmet', '')).upper():
                helmet_violated = True
            if 'NO' in str(worker.get('vest', '')).upper():
                vest_violated = True

    for frame in collision_risks:
        if frame.get('alerts'):
            collision_detected = True

    for frame in final_result:
        for report in frame.get('reports', []):
            if report.get('final_risk') == 'EMERGENCY':
                emergency_exists = True
            elif report.get('final_risk') == 'WARNING':
                warning_exists = True

    if emergency_exists:
        risk_grade = "고위험"
        risk_score = 95
    elif warning_exists or helmet_violated:
        risk_grade = "고위험"
        risk_score = 85
    elif vest_violated or collision_detected:
        risk_grade = "관찰"
        risk_score = 55
    else:
        risk_grade = "정상"
        risk_score = 15

    helmet_violations = 1 if helmet_violated else 0
    vest_violations = 1 if vest_violated else 0

    prompt = f"""
당신은 산업현장 안전관리 전문가입니다. 아래 AI 분석 결과를 바탕으로 안전 보고서를 작성해주세요.

[분석 결과]
- 분석 영상: {video_name}
- 안전모 미착용: {"있음" if helmet_violated else "없음"}
- 안전조끼 미착용: {"있음" if vest_violated else "없음"}
- 중장비 접근 감지: {"있음" if collision_detected else "없음"}
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
  "summary_eval": "3~4문장으로 종합평가 작성"
}}
"""

    openai_result = call_openai(prompt)

    if openai_result:
        try:
            clean = openai_result.strip()
            if "```" in clean:
                clean = clean.split("```")[1]
                if clean.startswith("json"):
                    clean = clean[4:]
            parsed = json.loads(clean.strip())
            return {
                "risk_grade": risk_grade,
                "risk_score": risk_score,
                "helmet_violations": helmet_violations,
                "vest_violations": vest_violations,
                "law_references": parsed.get("law_references", ""),
                "recommendations": parsed.get("recommendations", []),
                "summary_eval": parsed.get("summary_eval", "")
            }
        except:
            pass

    law_refs = []
    if helmet_violated:
        law_refs.append("산업안전보건법 제38조제1항 - 안전모 착용 의무 위반")
    if vest_violated:
        law_refs.append("산업안전보건법 제39조 - 안전조끼 착용 의무 위반")
    if collision_detected:
        law_refs.append("산업안전보건법 제38조 - 중장비 작업 반경 안전 의무 위반")

    recommendations = []
    if helmet_violated:
        recommendations.append("안전모 미착용 감지 — 즉시 작업 중지 후 착용 확인")
    if vest_violated:
        recommendations.append("안전조끼 미착용 감지 — 현장 출입 통제 조치")
    if collision_detected:
        recommendations.append("중장비 접근 감지 — 즉시 작업 반경 이탈")
    if not recommendations:
        recommendations.append("현재 특이사항 없음. 지속적 모니터링 유지")

    return {
        "risk_grade": risk_grade,
        "risk_score": risk_score,
        "helmet_violations": helmet_violations,
        "vest_violations": vest_violations,
        "law_references": " | ".join(law_refs) if law_refs else "해당 없음",
        "recommendations": recommendations,
        "summary_eval": f"위험등급: {risk_grade} ({risk_score}%). {'안전모 미착용 ' if helmet_violated else ''}{'안전조끼 미착용 ' if vest_violated else ''}{'중장비 접근 ' if collision_detected else ''}위반 확인."
    }

def is_image_file(path):
    ext = os.path.splitext(path)[1].lower()
    return ext in ['.jpg', '.jpeg', '.png', '.bmp']

def extract_frames_cv2(video_path, frames_folder):
    if is_image_file(video_path):
        frame_path = os.path.join(frames_folder, "frame_0001.jpg")
        img = cv2.imread(video_path)
        if img is None:
            raise RuntimeError(f"이미지 열기 실패: {video_path}")
        img_resized = cv2.resize(img, (640, 480))
        cv2.imwrite(frame_path, img_resized)
        return 1

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

        raw_ppe = detect_all(frames_folder)
        structured = structure_data(raw_ppe)
        ppe_risks = analyze_ppe(structured)
        collision_risks = analyze_collision(structured, ppe_risks)
        final_result = integrate_analysis(ppe_risks, collision_risks)
        ai_report = generate_ai_report(ppe_risks, collision_risks, final_result, video_name)

        # 바운딩박스 영상 생성
        annotated_video_path = os.path.join(frames_folder, "annotated.mp4")
        create_annotated_video(frames_folder, ppe_risks, annotated_video_path)

        # Cloudinary에 영상 업로드
        annotated_video_url = ''
        if os.path.exists(annotated_video_path):
            try:
                video_result = cloudinary.uploader.upload(
                    annotated_video_path,
                    resource_type="video",
                    folder="safety_videos"
                )
                annotated_video_url = video_result.get('secure_url', '')
                print(f"영상 업로드 완료: {annotated_video_url}", file=sys.stderr)
            except Exception as e:
                print(f"영상 업로드 실패: {e}", file=sys.stderr)

        for ppe_frame in ppe_risks:
            if not ppe_frame.get('workers'):
                continue
            has_violation = any(w['risk'] in ['HIGH', 'MEDIUM'] for w in ppe_frame['workers'])
            if not has_violation:
                continue

            frame_filename = ppe_frame['frame']
            f_path = os.path.join(frames_folder, frame_filename)

            boxed_path = f_path.replace('.jpg', '_boxed.jpg')
            draw_bounding_boxes(f_path, ppe_frame['workers'], boxed_path)

            cloudinary_url = ''
            if os.path.exists(boxed_path):
                cloudinary_url = upload_to_cloudinary(boxed_path)
            elif os.path.exists(f_path):
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

        cursor.execute("""
            UPDATE reports SET
                summary = %s,
                risk_grade = %s,
                risk_score = %s,
                helmet_violations = %s,
                vest_violations = %s,
                law_references = %s,
                recommendations = %s,
                summary_eval = %s,
                annotated_video_url = %s
            WHERE report_id = %s
        """, (
            f"{video_name} 안전 분석 보고서",
            ai_report['risk_grade'],
            ai_report['risk_score'],
            ai_report['helmet_violations'],
            ai_report['vest_violations'],
            ai_report['law_references'],
            json.dumps(ai_report['recommendations'], ensure_ascii=False),
            ai_report['summary_eval'],
            annotated_video_url,
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
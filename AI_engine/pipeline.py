import sys
import os
import json
import cv2
import pymysql  # pip install pymysql 필수
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from detect_objects import detect_objects
from detect_ppe import detect_ppe
from structure import structure_data
from structure_ppe import structure_ppe_data
from logic_fall import analyze_fall_risk
from logic_ppe import analyze_ppe

# --- [수정] 광민님의 Railway DB 연결 설정 ---
def get_db_connection():
    return pymysql.connect(
        # Render 환경변수가 있으면 쓰고, 없으면 광민님 Railway 정보를 직접 씁니다.
        host=os.getenv('MYSQLHOST', 'junction.proxy.rlwy.net'),
        user=os.getenv('MYSQLUSER', 'root'),
        password=os.getenv('MYSQLPASSWORD', 'uXLlzlUcfWYHaSXqVihQFxzhGnjcxbZR'),
        db=os.getenv('MYSQLDATABASE', 'railway'), # 아까 확인하신 이름 'railway'
        port=int(os.getenv('MYSQLPORT', 50160)),
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor
    )

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

        # 1. DB에 영상 정보 저장
        cursor.execute("INSERT INTO videos (video_path) VALUES (%s)", (video_path,))
        video_id = cursor.lastrowid

        # 2. DB에 보고서 초기 데이터 생성
        cursor.execute("INSERT INTO reports (video_id, summary) VALUES (%s, %s)", (video_id, f"{video_name} 안전 분석 보고서"))
        report_id = cursor.lastrowid

        # 프레임 추출 및 분석
        extract_frames_cv2(video_path, frames_folder)
        raw_objects = detect_objects(frames_folder)
        raw_ppe = detect_ppe(frames_folder)
        structured = structure_data(raw_objects)
        structured_ppe = structure_ppe_data(raw_ppe)
        
        # 위험도 분석 결과
        ppe_risks = analyze_ppe(structured, structured_ppe)

        # 3. 분석 결과를 재학님 DB 테이블 규격에 맞춰 저장
        for ppe_frame in ppe_risks:
            frame_filename = ppe_frame['frame']
            f_path = os.path.join(frames_folder, frame_filename)
            
            # frames 테이블 저장
            cursor.execute("INSERT INTO frames (video_id, frame_path, captured_at) VALUES (%s, %s, %s)", 
                           (video_id, f_path, datetime.now()))
            frame_id = cursor.lastrowid

            for worker in ppe_frame['workers']:
                # AI 결과를 재학님이 정한 '정상', '주의', '위험'으로 변환
                risk_map = {"HIGH": "위험", "MEDIUM": "주의", "LOW": "정상"}
                current_status = risk_map.get(worker['risk'], "정상")
                
                # report_items 테이블 저장 (재학님 보고서용)
                cursor.execute("""
                    INSERT INTO report_items (report_id, frame_id, event_time, status, description)
                    VALUES (%s, %s, %s, %s, %s)
                """, (report_id, frame_id, datetime.now(), current_status, 
                      f"보호구: {worker['helmet']}, 조끼: {worker['vest']}"))

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

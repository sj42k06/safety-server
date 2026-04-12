import sys
import os
import json
import cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from detect_objects import detect_objects
from detect_ppe import detect_ppe
from structure import structure_data
from structure_ppe import structure_ppe_data
from logic_fall import analyze_fall_risk
from logic_ppe import analyze_ppe
def extract_frames_cv2(video_path, frames_folder):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"영상 열기 실패: {video_path}")
  <br>
    fps = cap.get(cv2.CAP_PROP_FPS)
    interval = max(1, int(fps))  # 1초마다 1프레임
    count = 0
    saved = 0
  <br>
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
  <br>
    cap.release()
  <br>
    if saved == 0:
        raise RuntimeError("프레임 추출 실패: 저장된 프레임 없음")
  <br>
    return saved
def run_pipeline(video_path):
    video_name = os.path.splitext(os.path.basename(video_path))[0]
    frames_folder = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "frames", video_name
    )
    os.makedirs(frames_folder, exist_ok=True)
    # 1. 프레임 추출 (ffmpeg 대신 opencv 사용)
    extract_frames_cv2(video_path, frames_folder)
    # 2. 객체 탐지
    raw_objects = detect_objects(frames_folder)
    raw_ppe     = detect_ppe(frames_folder)
    # 3. 구조화
    structured     = structure_data(raw_objects)
    structured_ppe = structure_ppe_data(raw_ppe)
    # 4. 위험도 판단
    fall_risks = analyze_fall_risk(structured, structured_ppe)
    ppe_risks  = analyze_ppe(structured, structured_ppe)
    # 5. 결과 출력 (server.js가 읽음)
    result = {
        "frames_folder": frames_folder,
        "fall_risks": fall_risks,
        "ppe_risks": ppe_risks
    }
    print(json.dumps(result, ensure_ascii=False))
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "영상 경로가 없습니다."}))
        sys.exit(1)
    run_pipeline(sys.argv[1])

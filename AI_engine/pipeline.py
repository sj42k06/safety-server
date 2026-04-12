import sys
import os
import json
import subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from detect_objects import detect_objects
from detect_ppe import detect_ppe
from structure import structure_data
from structure_ppe import structure_ppe_data
from logic_fall import analyze_fall_risk
from logic_ppe import analyze_ppe
def run_pipeline(video_path):
    video_name = os.path.splitext(os.path.basename(video_path))[0]
    frames_folder = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "frames", video_name
    )
    os.makedirs(frames_folder, exist_ok=True)
    # 1. 프레임 추출
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", video_path,
        "-vf", "fps=1,scale=640:480",
        "-q:v", "2",
        os.path.join(frames_folder, "frame_%04d.jpg")
    ], check=True)
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

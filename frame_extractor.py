import cv2
import os
import sys

# 인자 체크
if len(sys.argv) < 2:
    print("영상 경로가 전달되지 않았습니다.")
    exit()

# Node.js에서 경로 전달받기(업로드된 영상경로)*
video_path = sys.argv[1]

# 파일 존재 확인
if not os.path.exists(video_path):
    print("파일이 존재하지 않습니다.")
    exit()

print(f"처리 영상: {video_path}")

# 영상 이름 기준 폴더 생성
video_name = os.path.splitext(os.path.basename(video_path))[0]
output_folder = f"frames/{video_name}"
os.makedirs(output_folder, exist_ok=True)

# 영상 열기
cap = cv2.VideoCapture(video_path)
if not cap.isOpened():
    print("영상 파일을 열 수 없습니다.")
    exit()

# FPS 가져오기
fps = int(cap.get(cv2.CAP_PROP_FPS))
if fps == 0:
    fps = 30

frame_interval = fps
frame_count = 0
saved_count = 0  

while True:
    ret, frame = cap.read()
    if not ret:
        break

    # 1초당 1프레임 저장
    if frame_count % frame_interval == 0:
        filename = f"{output_folder}/frame_{frame_count}.jpg"
        success = cv2.imwrite(filename, frame)

        if success:
            saved_count += 1
        else:
            print(f"저장 실패: {filename}")

    frame_count += 1

cap.release()

print(f"프레임 추출 완료: {saved_count}장 저장됨")
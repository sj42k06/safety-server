import cv2
import os
import sys

if len(sys.argv) < 2:
    print("영상 경로 없음")
    exit()

video_path = sys.argv[1]

if not os.path.exists(video_path):
    print("파일 없음")
    exit()

video_name = os.path.splitext(os.path.basename(video_path))[0]
output_folder = f"frames/{video_name}"
os.makedirs(output_folder, exist_ok=True)

cap = cv2.VideoCapture(video_path)

if not cap.isOpened():
    print("영상 열기 실패")
    exit()

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

    if frame_count % frame_interval == 0:
        filename = f"{output_folder}/frame_{frame_count}.jpg"
        if cv2.imwrite(filename, frame):
            saved_count += 1

    frame_count += 1

cap.release()

print(f"프레임 추출 완료: {saved_count}")

import cv2
import os
import sys

video_path = sys.argv[1]
video_name = os.path.splitext(os.path.basename(video_path))[0]

output_dir = os.path.join("frames", video_name)
os.makedirs(output_dir, exist_ok=True)

cap = cv2.VideoCapture(video_path)

count = 0
frame_rate = 30

while True:
    ret, frame = cap.read()
    if not ret:
        break

    if count % frame_rate == 0:
        file_path = os.path.join(output_dir, f"frame_{count}.jpg")
        cv2.imwrite(file_path, frame)

    count += 1

cap.release()

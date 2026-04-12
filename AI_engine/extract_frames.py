import os
import sys
import subprocess

interval_sec = 1
resize_width = 640
resize_height = 480

if interval_sec <= 0:
    print("interval_sec는 0보다 커야 합니다.")
    exit()

if len(sys.argv) < 2:
    print("영상 경로가 전달되지 않았습니다.")
    exit()

video_path = os.path.abspath(sys.argv[1])

if not os.path.exists(video_path):
    print("파일이 존재하지 않습니다.")
    exit()

if subprocess.call(["which", "ffmpeg"]) != 0:
    print("ffmpeg가 설치되어 있지 않습니다.")
    exit()

print(f"처리 영상: {video_path}")

video_name = os.path.splitext(os.path.basename(video_path))[0]
output_folder = os.path.join("frames", video_name)
os.makedirs(output_folder, exist_ok=True)

fps = 1 / interval_sec
vf_filter = f"fps={fps}"

if resize_width and resize_height:
    vf_filter += f",scale={resize_width}:{resize_height}"

output_pattern = os.path.join(output_folder, "frame_%04d.jpg")

command = [
    "ffmpeg",
    "-y",
    "-loglevel", "error",
    "-i", video_path,
    "-vf", vf_filter,
    "-q:v", "2",
    output_pattern
]

try:
    subprocess.run(command, check=True)
    saved_files = len(os.listdir(output_folder))
    print(f"프레임 추출 완료: {saved_files}장")
except subprocess.CalledProcessError as e:
    print("ffmpeg 실행 중 오류 발생:", e)
    exit()
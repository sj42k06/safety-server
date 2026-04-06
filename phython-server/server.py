from flask import Flask, request, jsonify
import cv2
import os

app = Flask(__name__)

@app.route("/process", methods=["POST"])
def process():
    file = request.files["file"]

    os.makedirs("uploads", exist_ok=True)
    filepath = os.path.join("uploads", file.filename)
    file.save(filepath)

    cap = cv2.VideoCapture(filepath)

    os.makedirs("frames", exist_ok=True)
    frame_dir = os.path.join("frames", file.filename)
    os.makedirs(frame_dir, exist_ok=True)

    count = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        cv2.imwrite(f"{frame_dir}/frame_{count}.jpg", frame)
        count += 1

    cap.release()

    return jsonify({
        "message": "프레임 생성 완료",
        "frame": f"{frame_dir}/frame_0.jpg"
    })

app.run(host="0.0.0.0", port=8080)

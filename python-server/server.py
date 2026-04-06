from flask import Flask, request, jsonify, send_from_directory
import cv2
import os

app = Flask(__name__)

@app.route("/process", methods=["POST"])
def process():
    
    if "file" not in request.files:
        return jsonify({"error": "파일 없음"}), 400

    file = request.files["file"]

    os.makedirs("uploads", exist_ok=True)
    filepath = os.path.join("uploads", file.filename)
    file.save(filepath)

    cap = cv2.VideoCapture(filepath)

    if not cap.isOpened():
        return jsonify({"error": "영상 열기 실패"}), 500

    os.makedirs("frames", exist_ok=True)
    frame_path = os.path.join("frames", "frame.jpg")

    ret, frame = cap.read()
    if not ret:
        return jsonify({"error": "프레임 추출 실패"}), 500

    cv2.imwrite(frame_path, frame)

    return jsonify({
        "message": "프레임 생성 완료",
        "frame": "frames/frame.jpg"
    })

@app.route("/frames/<path:filename>")
def serve_frame(filename):
    return send_from_directory("frames", filename)

app.run(host="0.0.0.0", port=8080)

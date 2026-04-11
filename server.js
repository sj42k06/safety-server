const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2");
const cloudinary = require("cloudinary").v2;
const { spawn } = require("child_process");
const http = require("http");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8080;

// Cloudinary 설정
cloudinary.config({ 
  cloud_name: 'dxxaiv5ii', 
  api_key: '771944593733371', 
  api_secret: 'AUVfLy-K6Q4CjRo9zno2P7kOoa8' 
});

// Database 설정 (Railway MySQL)
const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public", { index: false }));

const upload = multer({ dest: "uploads/" });

// 메인 라우트: 로그인 페이지 우선 로드
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// 영상 업로드 및 AI 통합 분석 파이프라인
app.post("/upload", upload.single("video"), async (req, res) => {
  const videoFile = req.file;
  if (!videoFile) return res.status(400).send("영상 파일이 누락되었습니다.");

  try {
    // 1. 영상 클라우드 영구 저장
    const videoUpload = await cloudinary.uploader.upload(videoFile.path, { 
      resource_type: "video",
      folder: "safety_analysis/videos"
    });

    const videoPath = videoFile.path;
    const videoName = path.parse(videoPath).name;

    // 2. 프레임 추출 프로세스 실행 (Python Module 1)
    const extractor = spawn('python3', ['frame_extractor.py', videoPath]);

    extractor.on('close', (code) => {
      if (code !== 0) return res.status(500).send("Analysis Error: Frame Extraction Failed");

      // 3. 객체 탐지 및 위험 분석 실행 (Python Module 2)
      const inputFolder = path.join('frames', videoName);
      const detector = spawn('python3', ['detect_objects.py', inputFolder]);

      let aiRawData = "";
      detector.stdout.on('data', (data) => {
        aiRawData += data.toString();
      });

      detector.on('close', async () => {
        try {
          // 분석 결과 중 대표 프레임 클라우드 저장
          const frameDir = path.join(__dirname, 'frames', videoName);
          const files = fs.readdirSync(frameDir);
          const representativeFrame = path.join(frameDir, files[0]);
          
          const imageUpload = await cloudinary.uploader.upload(representativeFrame, { 
            folder: "safety_analysis/evidence" 
          });

          // 4. 분석 데이터 데이터베이스 기록
          const query = "INSERT INTO Risk_Log (violation_type, evidence_url, area) VALUES (?, ?, ?)";
          db.query(query, [aiRawData.substring(0, 255), imageUpload.secure_url, "Construction_Site_A"], (err) => {
            if (err) throw err;
            
            res.send(`
              <div style="font-family:sans-serif; text-align:center; padding:20px;">
                <h1 style="color:#2c3e50;">Safety Analysis Report</h1>
                <hr>
                <p><b>Detection Result:</b> ${aiRawData}</p>
                <img src="${imageUpload.secure_url}" width="500" style="border:1px solid #ddd; border-radius:8px;"/>
                <div style="margin-top:20px;">
                  <button onclick="location.href='/record.html'" style="padding:10px 20px; cursor:pointer;">View All Records</button>
                </div>
              </div>
            `);
          });
        } catch (e) {
          res.status(500).send("Analysis Integration Error");
        }
      });
    });

  } catch (error) {
    res.status(500).send("System Processing Error");
  }
});

server.listen(PORT, () => {
  console.log(`System initialized. Monitoring port ${PORT}`);
});

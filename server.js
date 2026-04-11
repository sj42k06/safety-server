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
const PORT = process.env.PORT || 10000; // Render 포트 대응

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

// [해결포인트 1] 메인 접속 시 로그인 페이지 로드
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// [해결포인트 2] 로그인 POST 요청 처리 (이게 없어서 에러가 났던 거야!)
app.post("/login", (req, res) => {
  const { userid, pwd } = req.body;
  // 관리자 계정 체크
  if (userid === "admin" && pwd === "1234") {
    return res.redirect("/index.html"); // 로그인 성공 시 영상 업로드 페이지로 이동
  }
  res.send("<script>alert('아이디 또는 비밀번호가 틀렸습니다.'); history.back();</script>");
});

// 영상 업로드 및 AI 통합 분석 파이프라인
app.post("/upload", upload.single("video"), async (req, res) => {
  const videoFile = req.file;
  if (!videoFile) return res.status(400).send("영상 파일이 누락되었습니다.");

  try {
    const videoUpload = await cloudinary.uploader.upload(videoFile.path, { 
      resource_type: "video",
      folder: "safety_analysis/videos"
    });

    const videoPath = videoFile.path;
    const videoName = path.parse(videoPath).name;

    // 1. 프레임 추출 (frame_extractor.py 실행)
    const extractor = spawn('python3', ['frame_extractor.py', videoPath]);

    extractor.on('close', (code) => {
      if (code !== 0) return res.status(500).send("프레임 추출 실패");

      // 2. 객체 탐지 (detect_objects.py 실행)
      const inputFolder = path.join('frames', videoName);
      const detector = spawn('python3', ['detect_objects.py', inputFolder]);

      let aiRawData = "";
      detector.stdout.on('data', (data) => {
        aiRawData += data.toString();
      });

      detector.on('close', async () => {
        try {
          const frameDir = path.join(__dirname, 'frames', videoName);
          const files = fs.readdirSync(frameDir);
          const representativeFrame = path.join(frameDir, files[0]);
          
          const imageUpload = await cloudinary.uploader.upload(representativeFrame, { 
            folder: "safety_analysis/evidence" 
          });

          // 3. DB 기록 저장
          const query = "INSERT INTO Risk_Log (violation_type, evidence_url, area) VALUES (?, ?, ?)";
          db.query(query, [aiRawData.substring(0, 255), imageUpload.secure_url, "Site_A"], (err) => {
            if (err) throw err;
            
            res.send(`
              <div style="text-align:center; padding:20px;">
                <h1>분석 리포트</h1>
                <p>결과: ${aiRawData}</p>
                <img src="${imageUpload.secure_url}" width="500"/>
                <br><br>
                <button onclick="location.href='/record.html'">전체 기록 보기</button>
              </div>
            `);
          });
        } catch (e) {
          res.status(500).send("분석 통합 오류");
        }
      });
    });

  } catch (error) {
    res.status(500).send("시스템 처리 오류");
  }
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

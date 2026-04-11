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
const PORT = process.env.PORT || 10000;

// 1. Cloudinary 설정 (이미지/영상 클라우드 저장소)
cloudinary.config({ 
  cloud_name: 'dxxaiv5ii', 
  api_key: '771944593733371', 
  api_secret: 'AUVfLy-K6Q4CjRo9zno2P7kOoa8' 
});

// 2. Database 설정 (Railway MySQL 연동)
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

// 업로드 임시 폴더 설정
const upload = multer({ dest: "uploads/" });

// [기능] 메인 페이지 접속
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// [기능] 사용자 로그인 처리
app.post("/login", (req, res) => {
  const { userid, pwd } = req.body;
  if (userid === "admin" && pwd === "1234") {
    return res.redirect("/index.html");
  }
  res.send("<script>alert('인증 실패'); history.back();</script>");
});

// [핵심] 영상 업로드 및 AI 통합 분석 파이프라인
app.post("/upload", upload.single("video"), async (req, res) => {
  const videoFile = req.file;
  if (!videoFile) return res.status(400).send("영상이 없습니다.");

  try {
    // A. 영상을 Cloudinary에 업로드
    const videoUpload = await cloudinary.uploader.upload(videoFile.path, { 
      resource_type: "video",
      folder: "safety_analysis/videos"
    });

    const videoPath = videoFile.path;
    const videoName = path.parse(videoPath).name;
    const absoluteFramesPath = path.join(__dirname, 'frames', videoName);

    // B. 파이썬 모듈 1 실행: 프레임 추출 (frame_extractor.py)
    const extractor = spawn('python3', ['frame_extractor.py', videoPath]);

    extractor.on('close', (code) => {
      if (code !== 0) return res.status(500).send("프레임 추출 실패");

      // C. 파이썬 모듈 2 실행: 객체 탐지 (detect_objects.py)
      // 여기서 'absoluteFramesPath'를 전달해서 폴더 못 찾는 에러를 해결함
      const detector = spawn('python3', ['detect_objects.py', absoluteFramesPath]);

      let aiRawData = "";
      detector.stdout.on('data', (data) => {
        aiRawData += data.toString();
      });

      detector.on('close', async () => {
        try {
          // D. 분석된 프레임 중 하나를 증거 사진으로 업로드
          const files = fs.readdirSync(absoluteFramesPath);
          const representativeFrame = path.join(absoluteFramesPath, files[0]);
          
          const imageUpload = await cloudinary.uploader.upload(representativeFrame, { 
            folder: "safety_analysis/evidence" 
          });

          // E. 최종 분석 데이터 DB 저장 (Risk_Log 테이블)
          const query = "INSERT INTO Risk_Log (violation_type, evidence_url, area) VALUES (?, ?, ?)";
          db.query(query, [aiRawData.trim(), imageUpload.secure_url, "Site_A"], (err) => {
            if (err) throw err;
            
            // F. 결과 리포트 출력
            res.send(`
              <div style="text-align:center; padding:20px; font-family:sans-serif;">
                <h1 style="color:#2c3e50;">산업 안전 분석 리포트</h1>
                <hr style="width:50%;">
                <div style="background:#f9f9f9; display:inline-block; padding:20px; border-radius:10px;">
                  <p><b>분석 결과:</b> ${aiRawData}</p>
                  <img src="${imageUpload.secure_url}" width="500" style="border-radius:5px; box-shadow:0 4px 8px rgba(0,0,0,0.1);"/>
                </div>
                <br><br>
                <button onclick="location.href='/record.html'" style="padding:10px 20px;">기록 확인하기</button>
              </div>
            `);
          });
        } catch (e) {
          console.error(e);
          res.status(500).send("데이터 분석 통합 오류");
        }
      });
    });

  } catch (error) {
    console.error(error);
    res.status(500).send("서버 처리 오류");
  }
});

server.listen(PORT, () => {
  console.log(`[시스템 가동] 포트 ${PORT}에서 모니터링 중...`);
});

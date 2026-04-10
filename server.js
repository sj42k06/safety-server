const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const mysql = require("mysql2");
const cloudinary = require("cloudinary").v2;
const { Server } = require("socket.io");
const http = require("http");

// ffmpeg 설정
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 8080;

// 1. Cloudinary 설정 (여기를 네 정보로 꼭 바꿔줘!)
cloudinary.config({ 
  cloud_name: '네_클라우드_이름', 
  api_key: '네_API_키', 
  api_secret: '네_API_비밀키' 
});

// 2. Railway MySQL 연결 설정
const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  waitForConnections: true,
  connectionLimit: 10,
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

// Multer 설정 (임시 저장)
const upload = multer({ dest: "uploads/" });

// 메인 페이지 (로그인)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// 로그인 로직
app.post("/login", (req, res) => {
  const { userid, pwd } = req.body;
  if (userid === "admin" && pwd === "1234") {
    return res.redirect("/index.html");
  }
  res.send("<script>alert('로그인 실패'); history.back();</script>");
});

// 3. 영상 업로드 및 분석 로직
app.post("/upload", upload.single("video"), async (req, res) => {
  const videoFile = req.file;
  if (!videoFile) return res.send("영상을 업로드해주세요.");

  try {
    // A. Cloudinary에 원본 영상 업로드
    const videoUpload = await cloudinary.uploader.upload(videoFile.path, { 
      resource_type: "video",
      folder: "safety_videos"
    });

    const videoUrl = videoUpload.secure_url;
    const videoName = path.parse(videoFile.path).name;
    const outputFolder = path.join(__dirname, "frames", videoName);
    if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });

    // B. 프레임 추출 (1초당 1장)
    ffmpeg(videoFile.path)
      .outputOptions(["-vf fps=1"])
      .output(path.join(outputFolder, "frame_%04d.jpg"))
      .on("end", async () => {
        const files = fs.readdirSync(outputFolder);
        
        // 시연을 위해 첫 번째 프레임만 분석하는 예시 (실제론 반복문 사용)
        const framePath = path.join(outputFolder, files[0]);
        
        // C. Cloudinary에 증거 사진 업로드
        const imageUpload = await cloudinary.uploader.upload(framePath, { folder: "safety_frames" });
        const imageUrl = imageUpload.secure_url;

        // D. 임시 결과 (나중에 AI 담당자가 준 결과로 대체)
        const riskResult = "안전모 미착용 위험 탐지";

        // E. DB(Railway)에 저장
        db.query(
          "INSERT INTO Risk_Log (worker_id, violation_type, evidence_url, area) VALUES (?, ?, ?, ?)",
          ["Worker_01", riskResult, imageUrl, "A구역"],
          (err) => {
            if (err) console.error(err);
            
            // F. 실시간 알림 전송 (Socket.io)
            io.emit("new_risk", { result: riskResult, url: imageUrl });

            res.send(`
              <h2>분석 완료</h2>
              <p>결과: ${riskResult}</p>
              <img src="${imageUrl}" width="300" />
              <br><a href="/record.html">기록 확인하기</a>
            `);
          }
        );
      })
      .run();

  } catch (error) {
    console.error(error);
    res.status(500).send("서버 오류 발생");
  }
});

// 기록 조회 API
app.get("/records", (req, res) => {
  db.query("SELECT * FROM Risk_Log ORDER BY detected_at DESC", (err, results) => {
    if (err) return res.json([]);
    res.json(results);
  });
});

server.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 작동 중입니다.`);
});

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

// ffmpeg 경로 설정
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 8080;

// [Step 1] Cloudinary 설정 (네 정보로 교체!)
cloudinary.config({ 
  cloud_name: 'dxxaiv5ii', 
  api_key: '771944593733371', 
  api_secret: 'AUVfLy-K6Q4CjRo9zno2P7kOoa8' 
});

// [Step 4] Railway MySQL 연결
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

// static 폴더 설정 (index: false로 해야 로그인창이 먼저 뜸)
app.use(express.static("public", { index: false }));

const upload = multer({ dest: "uploads/" });

// --- 라우팅 설정 ---

// 메인 접속 시 로그인 페이지로 유도
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// 로그인 처리
app.post("/login", (req, res) => {
  const { userid, pwd } = req.body;
  if (userid === "admin" && pwd === "1234") {
    return res.redirect("/index.html");
  }
  res.send("<script>alert('로그인 실패'); history.back();</script>");
});

// [Step 2 & 3] 영상 업로드 및 분석
app.post("/upload", upload.single("video"), async (req, res) => {
  const videoFile = req.file;
  if (!videoFile) return res.send("영상을 업로드해주세요.");

  try {
    // 1. 영상을 Cloudinary에 업로드
    const videoUpload = await cloudinary.uploader.upload(videoFile.path, { 
      resource_type: "video",
      folder: "safety_videos"
    });

    const outputFolder = path.join(__dirname, "frames", path.parse(videoFile.path).name);
    if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });

    // 2. 프레임 추출 (1초당 1장)
    ffmpeg(videoFile.path)
      .outputOptions(["-vf fps=1"])
      .output(path.join(outputFolder, "frame_%04d.jpg"))
      .on("end", async () => {
        const files = fs.readdirSync(outputFolder);
        if (files.length === 0) return res.send("프레임 추출 실패");

        // 3. 추출된 첫 번째 사진을 Cloudinary에 업로드 (증거용)
        const framePath = path.join(outputFolder, files[0]);
        const imageUpload = await cloudinary.uploader.upload(framePath, { folder: "safety_frames" });
        const imageUrl = imageUpload.secure_url;

        // 4. 위험 판단 로직 (임시)
        const riskResult = "안전모 미착용 위험 탐지";

        // 5. DB 저장 (Risk_Log 테이블)
        db.query(
          "INSERT INTO Risk_Log (worker_id, violation_type, evidence_url, area) VALUES (?, ?, ?, ?)",
          ["Worker_01", riskResult, imageUrl, req.body.riskLevel || "A구역"],
          (err) => {
            if (err) console.error("DB 저장 에러:", err);
            
            // 실시간 알림 (Socket.io)
            io.emit("new_risk", { result: riskResult, url: imageUrl });

            // 결과 화면 응답
            res.send(`
              <div style="text-align:center; padding:50px;">
                <h2>분석 완료</h2>
                <p>위험 결과: <b>${riskResult}</b></p>
                <img src="${imageUrl}" width="400" style="border-radius:10px;"/>
                <br><br>
                <button onclick="location.href='/record.html'">기록 확인하기</button>
              </div>
            `);
          }
        );
      })
      .run();

  } catch (error) {
    console.error("업로드 에러:", error);
    res.status(500).send("서버 처리 중 오류가 발생했습니다.");
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
  console.log(`Server running on port ${PORT}`);
});

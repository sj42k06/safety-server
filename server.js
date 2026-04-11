require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2");
const cloudinary = require("cloudinary").v2;
const { spawn } = require("child_process");
const http = require("http");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 10000;
// Cloudinary 설정
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
// MySQL 연결
const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  ssl: { rejectUnauthorized: false },
});
// CORS (React 프론트 허용)
app.use(cors({ origin: "*", credentials: true }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public", { index: false }));
const upload = multer({ dest: "uploads/" });
// ── 헬스체크 ──────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});
// ── 기존 HTML 로그인 ───────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});
app.post("/login", (req, res) => {
  const { userid, pwd } = req.body;
  if (userid === "admin" && pwd === "1234") {
    return res.redirect("/index.html");
  }
  res.send("<script>alert('인증 실패'); history.back();</script>");
});
// ── React용 로그인 API ─────────────────
app.post("/api/login", (req, res) => {
  const { userid, pwd } = req.body;
  if (userid === "admin" && pwd === "1234") {
    const token = jwt.sign(
      { userid },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );
    return res.json({ success: true, token });
  }
  res.status(401).json({ success: false, error: "인증 실패" });
});
// JWT 검증 미들웨어
function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "토큰 없음" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: "유효하지 않은 토큰" });
  }
}
// ── 기존 HTML 업로드 ───────────────────
app.post("/upload", upload.single("video"), async (req, res) => {
  const videoFile = req.file;
  if (!videoFile) return res.status(400).send("영상이 없습니다.");
  try {
    const videoUpload = await cloudinary.uploader.upload(videoFile.path, {
      resource_type: "video",
      folder: "safety_analysis/videos",
    });
    const videoPath = videoFile.path;
    const videoName = path.parse(videoPath).name;
    const absoluteFramesPath = path.join(__dirname, "frames", videoName);
    const extractor = spawn("python3", ["frame_extractor.py", videoPath]);
    extractor.on("close", (code) => {
      if (code !== 0) return res.status(500).send("프레임 추출 실패");
      const detector = spawn("python3", ["detect_objects.py", absoluteFramesPath]);
      let aiRawData = "";
      detector.stdout.on("data", (data) => { aiRawData += data.toString(); });
      detector.on("close", async () => {
        try {
          const files = fs.readdirSync(absoluteFramesPath);
          const representativeFrame = path.join(absoluteFramesPath, files[0]);
          const imageUpload = await cloudinary.uploader.upload(representativeFrame, {
            folder: "safety_analysis/evidence",
          });
          const query = "INSERT INTO Risk_Log (violation_type, evidence_url, area) VALUES (?, ?, ?)";
          db.query(query, [aiRawData.trim(), imageUpload.secure_url, "Site_A"], (err) => {
            if (err) throw err;
            res.send(`
              <div style="text-align:center;padding:20px;font-family:sans-serif;">
                <h1>산업 안전 분석 리포트</h1>
                <p><b>분석 결과:</b> ${aiRawData}</p>
                <img src="${imageUpload.secure_url}" width="500"/>
                <br><br>
                <button onclick="location.href='/record.html'">기록 확인하기</button>
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
// ── React용 영상 업로드 + AI 분석 API ──
app.post("/api/analyze", authMiddleware, upload.single("video"), async (req, res) => {
  const videoFile = req.file;
  if (!videoFile) return res.status(400).json({ error: "영상이 없습니다." });
  try {
    const videoUpload = await cloudinary.uploader.upload(videoFile.path, {
      resource_type: "video",
      folder: "safety_analysis/videos",
    });
    const videoPath = videoFile.path;
    const videoName = path.parse(videoPath).name;
    const absoluteFramesPath = path.join(__dirname, "frames", videoName);
    const extractor = spawn("python3", ["frame_extractor.py", videoPath]);
    extractor.on("close", (code) => {
      if (code !== 0) return res.status(500).json({ error: "프레임 추출 실패" });
      const detector = spawn("python3", ["detect_objects.py", absoluteFramesPath]);
      let aiRawData = "";
      detector.stdout.on("data", (data) => { aiRawData += data.toString(); });
      detector.on("close", async () => {
        try {
          const files = fs.readdirSync(absoluteFramesPath);
          const representativeFrame = path.join(absoluteFramesPath, files[0]);
          const imageUpload = await cloudinary.uploader.upload(representativeFrame, {
            folder: "safety_analysis/evidence",
          });
          const reportId = "RPT-" + Date.now();
          const query = `
            INSERT INTO Risk_Log (report_id, violation_type, evidence_url, video_url, area, analyzed_at)
            VALUES (?, ?, ?, ?, ?, NOW())
          `;
          db.query(
            query,
            [reportId, aiRawData.trim(), imageUpload.secure_url, videoUpload.secure_url, req.body.location || "현장"],
            (err) => {
              if (err) {
                console.error("DB 저장 오류:", err);
                return res.status(500).json({ error: "DB 저장 실패" });
              }
              res.json({
                success: true,
                report_id: reportId,
                ai_result: aiRawData.trim(),
                thumbnail_url: imageUpload.secure_url,
                video_url: videoUpload.secure_url,
              });
              fs.unlink(videoFile.path, () => {});
            }
          );
        } catch (e) {
          console.error(e);
          res.status(500).json({ error: "분석 통합 오류" });
        }
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "서버 처리 오류" });
  }
});
// ── 보고서 목록 조회 ───────────────────
app.get("/api/reports", authMiddleware, (req, res) => {
  db.query(
    "SELECT * FROM Risk_Log ORDER BY analyzed_at DESC LIMIT 50",
    (err, results) => {
      if (err) return res.status(500).json({ error: "조회 실패" });
      res.json({ reports: results });
    }
  );
});
// ── 보고서 상세 조회 ───────────────────
app.get("/api/reports/:id", authMiddleware, (req, res) => {
  db.query(
    "SELECT * FROM Risk_Log WHERE report_id = ?",
    [req.params.id],
    (err, results) => {
      if (err) return res.status(500).json({ error: "조회 실패" });
      if (results.length === 0) return res.status(404).json({ error: "없음" });
      res.json(results[0]);
    }
  );
});
server.listen(PORT, () => {
  console.log(`[시스템 가동] 포트 ${PORT}에서 모니터링 중...`);
});

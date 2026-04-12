require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2/promise");
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
// MySQL 연결 (promise 방식)
const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  ssl: { rejectUnauthorized: false },
});
// 미들웨어
app.use(cors({ origin: "*", credentials: true }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public", { index: false }));
const upload = multer({ dest: "uploads/" });
// authMiddleware는 유지하되 사용 안 함
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
// 헬스체크
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});
// 루트 → 로그인 페이지
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});
// 페이지 라우트
app.get("/upload", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "upload.html"));
});
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});
app.get("/reports", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "reports.html"));
});
// 로그인
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
// pipeline.py 실행 헬퍼 함수
function runPipeline(videoPath) {
  return new Promise((resolve, reject) => {
    const pipelinePath = path.join(__dirname, "AI_engine", "pipeline.py");
    const process = spawn("python3", [pipelinePath, videoPath]);
    let output = "";
    let errorOutput = "";
    process.stdout.on("data", (data) => { output += data.toString(); });
    process.stderr.on("data", (data) => { errorOutput += data.toString(); });
    process.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error("pipeline 실행 실패: " + errorOutput));
      }
      try {
        resolve(JSON.parse(output));
      } catch (e) {
        reject(new Error("pipeline 결과 파싱 실패: " + output));
      }
    });
  });
}
// 영상 분석 API - authMiddleware 제거!
app.post("/analyze", upload.single("video"), async (req, res) => {
  const videoFile = req.file;
  if (!videoFile) return res.status(400).json({ error: "영상이 없습니다." });
  try {
    // 1. Cloudinary에 영상 업로드
    const videoUpload = await cloudinary.uploader.upload(videoFile.path, {
      resource_type: "video",
      folder: "safety_analysis/videos",
    });
    // 2. pipeline.py 실행
    const videoAbsPath = path.resolve(videoFile.path);
    const pipelineResult = await runPipeline(videoAbsPath);
    const { frames_folder, fall_risks, ppe_risks } = pipelineResult;
    // 3. DB에 video 저장
    const [videoRow] = await db.query(
      "INSERT INTO videos (video_path, uploaded_at) VALUES (?, NOW())",
      [videoUpload.secure_url]
    );
    const videoId = videoRow.insertId;
    // 4. 프레임별 DB 저장
    const frameFiles = fs.readdirSync(frames_folder).sort();
    for (let i = 0; i < frameFiles.length; i++) {
      const frameFile = frameFiles[i];
      const framePath = path.join(frames_folder, frameFile);
      const frameUpload = await cloudinary.uploader.upload(framePath, {
        folder: "safety_analysis/frames",
      });
      const [frameRow] = await db.query(
        "INSERT INTO frames (video_id, frame_path, captured_at) VALUES (?, ?, NOW())",
        [videoId, frameUpload.secure_url]
      );
      const frameId = frameRow.insertId;
      const fallFrame = fall_risks.find(f => f.frame === frameFile);
      const ppeFrame = ppe_risks.find(f => f.frame === frameFile);
      if (fallFrame && fallFrame.risks.length > 0) {
        for (const risk of fallFrame.risks) {
          await db.query(
            `INSERT INTO risk_events (frame_id, risk_type, risk_level, description, created_at) VALUES (?, ?, ?, ?, NOW())`,
            [frameId, "낙하위험", risk.risk, `객체: ${risk.object} / 가장자리: ${risk.edge_risk} / 사람아래: ${risk.person_below}`]
          );
        }
      }
      if (ppeFrame && ppeFrame.workers.length > 0) {
        for (const worker of ppeFrame.workers) {
          if (worker.risk !== "LOW") {
            await db.query(
              `INSERT INTO risk_events (frame_id, risk_type, risk_level, description, created_at) VALUES (?, ?, ?, ?, NOW())`,
              [frameId, "PPE위반", worker.risk, `헬멧: ${worker.helmet} / 조끼: ${worker.vest}`]
            );
          }
        }
      }
    }
    fs.unlink(videoFile.path, () => {});
    res.json({
      success: true,
      video_id: videoId,
      video_url: videoUpload.secure_url,
      total_frames: frameFiles.length,
      fall_risks: fall_risks,
      ppe_risks: ppe_risks,
    });
  } catch (error) {
    console.error("분석 오류:", error);
    res.status(500).json({ error: "분석 실패: " + error.message });
  }
});
// 보고서 자동 생성 API - authMiddleware 제거!
app.post("/api/reports/generate", async (req, res) => {
  const { video_id } = req.body;
  if (!video_id) return res.status(400).json({ error: "video_id 없음" });
  try {
    const [frames] = await db.query(
      "SELECT * FROM frames WHERE video_id = ? ORDER BY frame_id ASC",
      [video_id]
    );
    if (frames.length === 0)
      return res.status(404).json({ error: "프레임 없음" });
    let totalRisks = [];
    for (const frame of frames) {
      const [events] = await db.query(
        "SELECT * FROM risk_events WHERE frame_id = ?",
        [frame.frame_id]
      );
      totalRisks.push(...events);
    }const criticalCount = totalRisks.filter(r => r.risk_level === "CRITICAL").length;
    const highCount = totalRisks.filter(r => r.risk_level === "HIGH").length;
    const mediumCount = totalRisks.filter(r => r.risk_level === "MEDIUM").length;
    const summary = `총 ${totalRisks.length}건 위험 감지 / CRITICAL: ${criticalCount}건 / HIGH: ${highCount}건 / MEDIUM: ${mediumCount}건`;
    const [reportRow] = await db.query(
      "INSERT INTO reports (video_id, summary, created_at) VALUES (?, ?, NOW())",
      [video_id, summary]
    );
    const reportId = reportRow.insertId;
    for (const frame of frames) {
      const [events] = await db.query(
        "SELECT * FROM risk_events WHERE frame_id = ?",
        [frame.frame_id]
      );
      let status = "정상";
      if (events.some(e => e.risk_level === "CRITICAL" || e.risk_level === "HIGH")) {
        status = "위험";
      } else if (events.some(e => e.risk_level === "MEDIUM")) {
        status = "주의";
      }
      const description = events.length > 0
        ? events.map(e => `${e.risk_type}: ${e.description}`).join(" | ")
        : "이상 없음";
      await db.query(
        `INSERT INTO report_items (report_id, frame_id, event_time, status, description) VALUES (?, ?, NOW(), ?, ?)`,
        [reportId, frame.frame_id, status, description]
      );
    }
    res.json({ success: true, report_id: reportId, summary, total_frames: frames.length, total_risks: totalRisks.length });
  } catch (error) {
    console.error("보고서 생성 오류:", error);
    res.status(500).json({ error: "보고서 생성 실패: " + error.message });
  }
});
// 보고서 목록 조회 - authMiddleware 제거!
app.get("/api/reports", async (req, res) => {
  try {
    const [reports] = await db.query(
      `SELECT r.*, v.video_path FROM reports r JOIN videos v ON r.video_id = v.video_id ORDER BY r.created_at DESC LIMIT 50`
    );
    res.json({ reports });
  } catch (error) {
    res.status(500).json({ error: "조회 실패" });
  }
});
// 보고서 상세 조회 - authMiddleware 제거!
app.get("/api/reports/:id", async (req, res) => {
  try {
    const [reports] = await db.query(
      "SELECT * FROM reports WHERE report_id = ?",
      [req.params.id]
    );
    if (reports.length === 0)
      return res.status(404).json({ error: "보고서 없음" });
    const [items] = await db.query(
      `SELECT ri.*, f.frame_path FROM report_items ri JOIN frames f ON ri.frame_id = f.frame_id WHERE ri.report_id = ? ORDER BY ri.item_id ASC`,
      [req.params.id]
    );
    res.json({ report: reports[0], items });
  } catch (error) {
    res.status(500).json({ error: "조회 실패" });
  }
});
// risk_events 조회 - authMiddleware 제거!
app.get("/api/risk-events", async (req, res) => {
  try {
    const [events] = await db.query(
      `SELECT re.*, f.frame_path, f.video_id FROM risk_events re JOIN frames f ON re.frame_id = f.frame_id ORDER BY re.created_at DESC LIMIT 100`
    );
    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: "조회 실패" });
  }
});
// 영상 목록 조회 - authMiddleware 제거!
app.get("/api/videos", async (req, res) => {
  try {
    const [videos] = await db.query(
      "SELECT * FROM videos ORDER BY uploaded_at DESC LIMIT 50"
    );
    res.json({ vi

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

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE || 'railway',
  port: process.env.MYSQLPORT || 50160,
  ssl: { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

app.use(cors({ origin: "*", credentials: true }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public", { index: false }));

const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir); }
const upload = multer({
  dest: uploadDir,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('영상 또는 이미지 파일만 업로드 가능합니다.'));
    }
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/upload", (req, res) => res.sendFile(path.join(__dirname, "public", "upload.html")));
app.get("/dashboard", (req, res) => res.sendFile(path.join(__dirname, "public", "dashboard.html")));
app.get("/reports", (req, res) => res.sendFile(path.join(__dirname, "public", "reports.html")));
app.get("/reports/:id", (req, res) => res.sendFile(path.join(__dirname, "public", "report-detail.html")));
app.get("/video-upload", (req, res) => res.sendFile(path.join(__dirname, "public", "video-upload.html")));

app.post("/api/login", (req, res) => {
  const { userid, pwd } = req.body;
  if (userid === "admin" && pwd === "1234") {
    const token = jwt.sign({ userid }, process.env.JWT_SECRET || 'smart_safe_key', { expiresIn: "24h" });
    return res.json({ 성공: true, token });
  }
  res.status(401).json({ 성공: false, error: "아이디 또는 비밀번호가 틀렸습니다." });
});

function runPipeline(videoPath) {
  return new Promise((resolve, reject) => {
    const pipelinePath = path.join(__dirname, "AI_engine", "pipeline.py");
    console.log(`[엔진 가동] 경로: ${pipelinePath}`);
    const pyProcess = spawn("python3", [pipelinePath, videoPath]);
    let output = "";
    let errorOutput = "";
    pyProcess.stdout.：("data", (data) => { output += data.toString(); });
    pyProcess.stderr.：("data", (data) => {
      errorOutput += data.toString();
      console.log(`[AI 로그]: ${data}`);
    });
    pyProcess.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`AI 엔진 오류 (코드 ${code}): ${errorOutput}`));
      }
      try {
        const lines = output.trim().split('\n');
        const jsonLine = lines.reverse().find(line => line.trim().startsWith('{'));
        const parsed = JSON.parse(jsonLine);
        resolve(parsed);
      } catch (e) {
        reject(new Error(`데이터 파싱 오류: ${output}`));
      }
    });
  });
}

app.post("/analyze", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "분석할 파일을 업로드해 주세요." });

  const tempPath = path.resolve(req.file.path);
  
  // 확장자 추가 (이미지면 .jpg, 영상이면 .mp4)
  const ext = req.file.mimetype.startsWith('image/') ? '.jpg' : '.mp4';
  const newPath = tempPath + ext;
  fs.renameSync(tempPath, newPath);

  try {
    console.log(`[분석 요청] 파일명: ${req.file.originalname}`);
    const result = await runPipeline(newPath);
    if (fs.existsSync(newPath)) { fs.unlinkSync(newPath); }
    res.status(200).json({
      성공: true,
      report_id: result.report_id,
      message: "안전 분석이 성공적으로 완료되었습니다."
    });
  } catch (error) {
    console.error("Critical Analysis Error:", error);
    if (fs.existsSync(newPath)) { fs.unlinkSync(newPath); }
    res.status(500).json({ error: "분석 시스템 장애", detail: error.message });
  }
});

app.get("/api/reports", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        r.report_id, 
        r.summary, 
        r.created_at, 
        r.risk_grade,
        r.helmet_violations,
        r.vest_violations,
        v.video_path,
        (SELECT f.frame_path FROM frames f WHERE f.video_id = r.video_id AND f.frame_path LIKE 'http%' LIMIT 1) AS thumbnail
      FROM reports r 
      LEFT JOIN videos v ON r.video_id = v.video_id 
      ORDER BY r.created_at DESC 
      LIMIT 20
    `);
    res.json({ success: true, reports: rows });
  } catch (err) {
    res.status(500).json({ error: "데이터베이스 조회 실패" });
  }
});

app.get("/api/reports/:id", async (req, res) => {
  try {
    const [report] = await db.query("SELECT * FROM reports WHERE report_id = ?", [req.params.id]);
    if (report.length === 0) return res.status(404).json({ error: "해당 보고서를 찾을 수 없습니다." });
    const [details] = await db.query(`
      SELECT ri.*, f.frame_path 
      FROM report_items ri 
      JOIN frames f ON ri.frame_id = f.frame_id 
      WHERE ri.report_id = ? 
      ORDER BY ri.item_id ASC
    `, [req.params.id]);
    res.json({ 성공: true, report: report[0], info: report[0], items: details });
  } catch (err) {
    res.status(500).json({ error: "상세 데이터 조회 실패" });
  }
});

app.delete("/api/reports/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await db.query("DELETE FROM report_items WHERE report_id = ?", [id]);
    await db.query(`DELETE FROM frames WHERE video_id = (SELECT video_id FROM reports WHERE report_id = ?)`, [id]);
    await db.query("DELETE FROM reports WHERE report_id = ?", [id]);
    await db.query("DELETE FROM videos WHERE video_id NOT IN (SELECT video_id FROM reports)");
    res.json({ 성공: true });
  } catch (err) {
    res.status(500).json({ error: "삭제 실패" });
  }
});

app.delete("/api/reports", async (req, res) => {
  try {
    await db.query("DELETE FROM report_items");
    await db.query("DELETE FROM frames");
    await db.query("DELETE FROM reports");
    await db.query("DELETE FROM videos");
    await db.query("ALTER TABLE report_items AUTO_INCREMENT = 1");
    await db.query("ALTER TABLE frames AUTO_INCREMENT = 1");
    await db.query("ALTER TABLE reports AUTO_INCREMENT = 1");
    await db.query("ALTER TABLE videos AUTO_INCREMENT = 1");
    res.json({ 성공: true });
  } catch (err) {
    res.status(500).json({ error: "초기화 실패" });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "running", uptime: process.uptime(), db_connected: true });
});

server.listen(PORT, () => {
  console.log(`
  ================================================
  [Smart Safe Report] 서버가 가동되었습니다.
  - URL: https://safety-server-oqza.onrender.com
  - Port: ${PORT}
  ================================================
  `);
});

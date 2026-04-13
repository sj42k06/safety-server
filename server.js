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

// 1. Cloudinary 설정
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 2. MySQL Pool 설정 (재학님 DB 규격)
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

// 3. 미들웨어 및 정적 파일 경로
app.use(cors({ origin: "*", credentials: true }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public", { index: false }));

// 업로드 폴더 자동 생성 확인
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir); }
const upload = multer({ dest: uploadDir });

// 4. 페이지 라우팅
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/upload", (req, res) => res.sendFile(path.join(__dirname, "public", "upload.html")));
app.get("/dashboard", (req, res) => res.sendFile(path.join(__dirname, "public", "dashboard.html")));
app.get("/reports", (req, res) => res.sendFile(path.join(__dirname, "public", "reports.html")));
app.get("/reports/:id", (req, res) => res.sendFile(path.join(__dirname, "public", "report-detail.html")));

// 5. 관리자 로그인 (JWT 발급)
app.post("/api/login", (req, res) => {
  const { userid, pwd } = req.body;
  if (userid === "admin" && pwd === "1234") {
    const token = jwt.sign({ userid }, process.env.JWT_SECRET || 'smart_safe_key', { expiresIn: "24h" });
    return res.json({ success: true, token });
  }
  res.status(401).json({ success: false, error: "아이디 또는 비밀번호가 틀렸습니다." });
});

// 6. AI 파이프라인 실행 엔진 (에러 헨들링 강화)
function runPipeline(videoPath) {
  return new Promise((resolve, reject) => {
    const pipelinePath = path.join(__dirname, "AI_engine", "pipeline.py");
    console.log(`[엔진 가동] 경로: ${pipelinePath}`);

    // Render 유료 플랜 환경에 맞춰 python3 사용
    const pyProcess = spawn("python3", [pipelinePath, videoPath]);
    
    let output = "";
    let errorOutput = "";

    pyProcess.stdout.on("data", (data) => { output += data.toString(); });
    pyProcess.stderr.on("data", (data) => { 
      errorOutput += data.toString();
      console.log(`[AI 로그]: ${data}`); 
    });

    pyProcess.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`AI 엔진 오류 (코드 ${code}): ${errorOutput}`));
      }
      try {
        const parsed = JSON.parse(output);
        resolve(parsed);
      } catch (e) {
        reject(new Error(`데이터 파싱 오류: ${output}`));
      }
    });
  });
}

// 7. 메인 분석 API
app.post("/analyze", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "분석할 영상을 업로드해 주세요." });

  const tempPath = path.resolve(req.file.path);

  try {
    console.log(`[분석 요청] 파일명: ${req.file.originalname}`);
    
    // AI 분석 시작 (pipeline.py가 DB 저장까지 완료)
    const result = await runPipeline(tempPath);

    // 분석 완료 후 임시 파일 즉시 삭제
    if (fs.existsSync(tempPath)) { fs.unlinkSync(tempPath); }

    res.status(200).json({
      success: true,
      report_id: result.report_id,
      message: "안전 분석이 성공적으로 완료되었습니다."
    });

  } catch (error) {
    console.error("Critical Analysis Error:", error);
    if (fs.existsSync(tempPath)) { fs.unlinkSync(tempPath); }
    res.status(500).json({ error: "분석 시스템 장애", detail: error.message });
  }
});

// 8. 보고서 데이터 조회 API (재학님 DB 테이블 최적화)
app.get("/api/reports", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT r.report_id, r.summary, r.created_at, v.video_path 
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

    res.json({ success: true, info: report[0], items: details });
  } catch (err) {
    res.status(500).json({ error: "상세 데이터 조회 실패" });
  }
});

// 9. 시스템 상태 모니터링
app.get("/health", (req, res) => {
  res.json({ status: "running", uptime: process.uptime(), db_connected: true });
});

// 10. 서버 가동
server.listen(PORT, () => {
  console.log(`
  ================================================
  [Smart Safe Report] 서버가 가동되었습니다.
  - URL: https://safety-server-oqza.onrender.com
  - Port: ${PORT}
  - DB Status: MySQL Connected (Railway)
  ================================================
  `);
});

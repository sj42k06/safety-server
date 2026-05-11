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
const axios = require("axios");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 10000;

// ── Cloudinary ──────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── DB Pool ─────────────────────────────
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

// ── 수신 번호 매핑 ──────────────────────
const PHONE_MAP = {
  admin:  process.env.ADMIN_PHONE,
  admin2: process.env.ADMIN2_PHONE,
};

// ── SMS 발송 ─────────────────────────────
async function sendHandoverSms(approvedBy, unresolvedCount, todayCount) {
  try {
    const toUser  = approvedBy === 'admin' ? 'admin2' : 'admin';
    const toPhone = PHONE_MAP[toUser];
    const from    = process.env.COOLSMS_FROM;
    const apiKey    = process.env.COOLSMS_API_KEY;
    const apiSecret = process.env.COOLSMS_API_SECRET;

    if (!toPhone || !from || !apiKey || !apiSecret) {
      console.warn('⚠️  SMS 설정 누락 - 발송 스킵');
      return false;
    }

    const date      = new Date().toISOString();
    const salt      = crypto.randomBytes(16).toString('hex');
    const signature = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');

    const now  = new Date().toLocaleString('ko-KR');
    const text = `[안전관리시스템] 인수인계 완료\n승인자: ${approvedBy}\n시각: ${now}\n미조치: ${unresolvedCount}건 / 당일보고서: ${todayCount}건`;

    await axios.post(
      'https://api.solapi.com/messages/v4/send',
      { message: { to: toPhone, from, text } },
      {
        headers: {
          'Authorization': `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`✅ SMS 발송 완료 → ${toUser}(${toPhone})`);
    return true;
  } catch (err) {
    console.error('❌ SMS 발송 오류:', err.response?.data || err.message);
    return false;
  }
}

// ── 미들웨어 ─────────────────────────────
app.use(cors({ origin: "*", credentials: true }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public", { index: false }));

const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir); }
const upload = multer({
  dest: uploadDir,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/') || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('영상 또는 이미지 파일만 업로드 가능합니다.'));
    }
  }
});

// ────────────────────────────────────────
// 페이지 라우트
// ────────────────────────────────────────
app.get("/",             (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/handover",     (req, res) => res.sendFile(path.join(__dirname, "public", "handover.html")));
app.get("/upload",       (req, res) => res.sendFile(path.join(__dirname, "public", "upload.html")));
app.get("/dashboard",    (req, res) => res.sendFile(path.join(__dirname, "public", "dashboard.html")));
app.get("/archive",      (req, res) => res.sendFile(path.join(__dirname, "public", "archive.html")));
app.get("/reports",      (req, res) => res.sendFile(path.join(__dirname, "public", "reports.html")));
app.get("/reports/:id",  (req, res) => res.sendFile(path.join(__dirname, "public", "report-detail.html")));
app.get("/video-upload", (req, res) => res.sendFile(path.join(__dirname, "public", "video-upload.html")));

// ────────────────────────────────────────
// 로그인 (users 테이블 기반)
// ────────────────────────────────────────
app.post("/api/login", async (req, res) => {
  const { userid, pwd } = req.body;
  try {
    const [rows] = await db.query(
      "SELECT * FROM users WHERE login_id = ? AND password = ?",
      [userid, pwd]
    );
    if (rows.length === 0) {
      return res.status(401).json({ 성공: false, error: "아이디 또는 비밀번호가 틀렸습니다." });
    }
    const user = rows[0];
    const token = jwt.sign(
      { user_id: user.user_id, login_id: user.login_id, name: user.name },
      process.env.JWT_SECRET || 'smart_safe_key',
      { expiresIn: "24h" }
    );
    res.json({ 성공: true, token, name: user.name, user_id: user.user_id });
  } catch (err) {
    res.status(500).json({ 성공: false, error: "서버 오류" });
  }
});

// ────────────────────────────────────────
// AI 파이프라인
// ────────────────────────────────────────
function runPipeline(videoPath, userId) {
  return new Promise((resolve, reject) => {
    const pipelinePath = path.join(__dirname, "AI_engine", "pipeline.py");
    const pyProcess = spawn("python3", [pipelinePath, videoPath, String(userId || 1)]);
    let output = "", errorOutput = "";
    pyProcess.stdout.on("data", (data) => { output += data.toString(); });
    pyProcess.stderr.on("data", (data) => { errorOutput += data.toString(); console.log(`[AI 로그]: ${data}`); });
    pyProcess.on("close", (code) => {
      if (code !== 0) return reject(new Error(`AI 엔진 오류 (코드 ${code}): ${errorOutput}`));
      try {
        const lines = output.trim().split('\n');
        const jsonLine = lines.reverse().find(line => line.trim().startsWith('{'));
        resolve(JSON.parse(jsonLine));
      } catch (e) { reject(new Error(`데이터 파싱 오류: ${output}`)); }
    });
  });
}

// ────────────────────────────────────────
// 빠른 바운딩박스 전용 (Flask AI 서버로 포워딩)
// ────────────────────────────────────────
const AI_SERVER = process.env.AI_SERVER_URL || 'http://localhost:5001';

app.post("/analyze-quick", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ boxes: [], danger: false });
  const tempPath = path.resolve(req.file.path);
  const newPath  = tempPath + '.jpg';
  fs.renameSync(tempPath, newPath);

  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('image', fs.createReadStream(newPath), 'capture.jpg');

    const response = await axios.post(AI_SERVER + '/analyze-quick', form, {
      headers: form.getHeaders(),
      timeout: 15000
    });

    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
    res.json(response.data);
  } catch (err) {
    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
    res.json({ boxes: [], danger: false });
  }
});

app.post("/analyze", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "분석할 파일을 업로드해 주세요." });
  const tempPath = path.resolve(req.file.path);
  const ext = req.file.mimetype.startsWith('image/') ? '.jpg' : '.mp4';
  const newPath = tempPath + ext;
  fs.renameSync(tempPath, newPath);

  // 로그인한 사용자 ID (헤더나 바디에서 받거나 기본값 1)
  const userId = req.body.user_id || req.headers['x-user-id'] || 1;

  try {
    const result = await runPipeline(newPath, userId);
    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
    res.status(200).json({
      성공: true,
      report_id: result.report_id,
      message: "안전 분석이 성공적으로 완료되었습니다."
    });
  } catch (error) {
    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
    res.status(500).json({ error: "분석 시스템 장애", detail: error.message });
  }
});

// ────────────────────────────────────────
// 보고서 목록 (reports + risk_logs 조인)
// ────────────────────────────────────────
app.get("/api/reports", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        r.report_id,
        r.report_title,
        r.report_date,
        r.created_at,
        r.report_content,
        u.name AS created_by_name,
        rl.risk_id,
        rl.detection_status,
        rl.description,
        rl.image_path,
        rl.action_status,
        rl.detected_at,
        sr.case_name,
        sr.law_name
      FROM reports r
      LEFT JOIN users u ON r.created_by = u.user_id
      LEFT JOIN risk_logs rl ON r.risk_id = rl.risk_id
      LEFT JOIN safety_rules sr ON rl.rule_id = sr.rule_id
      ORDER BY r.created_at DESC
      LIMIT 50
    `);
    res.json({ success: true, reports: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "데이터베이스 조회 실패" });
  }
});

// ────────────────────────────────────────
// 보고서 상세 (report + risk_log + safety_rule)
// ────────────────────────────────────────
app.get("/api/reports/:id", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        r.report_id,
        r.report_title,
        r.report_date,
        r.report_content,
        r.created_at,
        u.name AS created_by_name,
        rl.risk_id,
        rl.detection_status,
        rl.description,
        rl.image_path,
        rl.action_status,
        rl.action_note,
        rl.detected_at,
        sr.case_name,
        sr.law_name,
        sr.law_content,
        sr.recommendation
      FROM reports r
      LEFT JOIN users u ON r.created_by = u.user_id
      LEFT JOIN risk_logs rl ON r.risk_id = rl.risk_id
      LEFT JOIN safety_rules sr ON rl.rule_id = sr.rule_id
      WHERE r.report_id = ?
    `, [req.params.id]);

    if (rows.length === 0) return res.status(404).json({ error: "해당 보고서를 찾을 수 없습니다." });

    res.json({ 성공: true, report: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "상세 데이터 조회 실패" });
  }
});

// ────────────────────────────────────────
// 조치 상태 저장 (risk_logs.action_status 업데이트)
// ────────────────────────────────────────
app.put("/api/reports/:id/action", async (req, res) => {
  const { id } = req.params;
  const { action_status, action_note } = req.body;

  if (!['조치완료', '미조치'].includes(action_status)) {
    return res.status(400).json({ error: "유효하지 않은 조치 상태입니다." });
  }

  try {
    // report의 risk_id 찾기
    const [[report]] = await db.query(
      "SELECT risk_id FROM reports WHERE report_id = ?", [id]
    );
    if (!report) return res.status(404).json({ error: "보고서를 찾을 수 없습니다." });

    // risk_logs 업데이트
    await db.query(
      "UPDATE risk_logs SET action_status = ?, action_note = ? WHERE risk_id = ?",
      [action_status, action_note || null, report.risk_id]
    );

    res.json({ success: true, message: `'${action_status}'으로 저장되었습니다.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "저장 오류", detail: err.message });
  }
});

// ────────────────────────────────────────
// 보고서 삭제
// ────────────────────────────────────────
app.delete("/api/reports/:id", async (req, res) => {
  try {
    const [[report]] = await db.query(
      "SELECT risk_id FROM reports WHERE report_id = ?", [req.params.id]
    );
    await db.query("DELETE FROM reports WHERE report_id = ?", [req.params.id]);
    if (report) {
      await db.query("DELETE FROM risk_logs WHERE risk_id = ?", [report.risk_id]);
    }
    res.json({ 성공: true });
  } catch (err) {
    res.status(500).json({ error: "삭제 실패" });
  }
});

app.delete("/api/reports", async (req, res) => {
  try {
    await db.query("DELETE FROM reports");
    await db.query("DELETE FROM risk_logs");
    res.json({ 성공: true });
  } catch (err) {
    res.status(500).json({ error: "초기화 실패" });
  }
});

// ════════════════════════════════════════
//  인수인계 API
// ════════════════════════════════════════

// GET /api/handover/summary
app.get("/api/handover/summary", async (req, res) => {
  try {
    // 미조치 건수
    const [[{ unresolved_count }]] = await db.query(`
      SELECT COUNT(*) AS unresolved_count
      FROM reports r
      JOIN risk_logs rl ON r.risk_id = rl.risk_id
      WHERE rl.action_status = '미조치' OR rl.action_status IS NULL
    `);

    // 당일 보고서 건수
    const [[{ today_count }]] = await db.query(`
      SELECT COUNT(*) AS today_count
      FROM reports
      WHERE DATE(created_at) = CURDATE()
    `);

    // 미조치 보고서 목록 (최대 5건)
    const [unresolved_reports] = await db.query(`
      SELECT r.report_id, r.report_title, r.report_date, r.created_at,
             rl.action_status, sr.case_name
      FROM reports r
      JOIN risk_logs rl ON r.risk_id = rl.risk_id
      LEFT JOIN safety_rules sr ON rl.rule_id = sr.rule_id
      WHERE rl.action_status = '미조치' OR rl.action_status IS NULL
      ORDER BY r.created_at DESC
      LIMIT 5
    `);

    res.json({ success: true, unresolved_count, today_count, unresolved_reports });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "데이터 조회 실패", detail: err.message });
  }
});

// POST /api/handover/approve
app.post("/api/handover/approve", async (req, res) => {
  const { user, approved_at } = req.body;
  const now = approved_at ? new Date(approved_at) : new Date();

  let unresolvedCount = 0, todayCount = 0;
  try {
    const [[u]] = await db.query(`
      SELECT COUNT(*) AS cnt FROM reports r
      JOIN risk_logs rl ON r.risk_id = rl.risk_id
      WHERE rl.action_status = '미조치' OR rl.action_status IS NULL
    `);
    const [[t]] = await db.query(
      "SELECT COUNT(*) AS cnt FROM reports WHERE DATE(created_at) = CURDATE()"
    );
    unresolvedCount = u.cnt;
    todayCount      = t.cnt;
  } catch (_) {}

  try {
    // handover_logs에 기록
    // from_user, to_user를 users 테이블에서 조회
    const [users] = await db.query("SELECT user_id, login_id FROM users");
    const fromUser = users.find(u => u.login_id === user);
    const toUser   = users.find(u => u.login_id !== user);

    if (fromUser && toUser) {
      // 오늘 날짜 보고서 중 최신 보고서에 인수인계 기록
      const [[latestReport]] = await db.query(
        "SELECT report_id FROM reports WHERE DATE(created_at) = CURDATE() ORDER BY created_at DESC LIMIT 1"
      ).catch(() => [[null]]);

      if (latestReport) {
        await db.query(`
          INSERT INTO handover_logs
            (report_id, from_user_id, to_user_id, handover_date, handover_status, confirmed_at, signature_check, sms_sent)
          VALUES (?, ?, ?, CURDATE(), '확인완료', ?, TRUE, FALSE)
        `, [latestReport.report_id, fromUser.user_id, toUser.user_id, now]);
      }
    }
  } catch (err) {
    console.error("인수인계 기록 오류:", err.message);
  }

  // SMS 발송
  const smsSent = await sendHandoverSms(user, unresolvedCount, todayCount);

  // sms_sent 업데이트
  if (smsSent) {
    await db.query(
      "UPDATE handover_logs SET sms_sent = TRUE WHERE from_user_id = (SELECT user_id FROM users WHERE login_id = ?) ORDER BY handover_id DESC LIMIT 1",
      [user]
    ).catch(() => {});
  }

  res.json({ success: true, message: "인수 승인이 완료되었습니다.", sms_sent: smsSent });
});

// ────────────────────────────────────────
// 통계 API (대시보드용)
// ────────────────────────────────────────
app.get("/api/stats", async (req, res) => {
  try {
    const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM reports");

    const [byCase] = await db.query(`
      SELECT sr.case_name, COUNT(*) AS count
      FROM reports r
      JOIN risk_logs rl ON r.risk_id = rl.risk_id
      JOIN safety_rules sr ON rl.rule_id = sr.rule_id
      GROUP BY sr.case_name
    `);

    const [[{ unresolved }]] = await db.query(`
      SELECT COUNT(*) AS unresolved FROM reports r
      JOIN risk_logs rl ON r.risk_id = rl.risk_id
      WHERE rl.action_status = '미조치' OR rl.action_status IS NULL
    `);

    const [[{ resolved }]] = await db.query(`
      SELECT COUNT(*) AS resolved FROM reports r
      JOIN risk_logs rl ON r.risk_id = rl.risk_id
      WHERE rl.action_status = '조치완료'
    `);

    res.json({ success: true, total, byCase, unresolved, resolved });
  } catch (err) {
    res.status(500).json({ error: "통계 조회 실패" });
  }
});

// ────────────────────────────────────────
// 헬스 체크
// ────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "running", uptime: process.uptime(), db_connected: true });
});

// ── Flask AI 서버 자동 시작 ──────────────
function startFlaskServer() {
  const flaskPath = path.join(__dirname, "AI_engine", "app.py");
  const flask = spawn("python3", [flaskPath], {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  flask.stdout.on("data", d => console.log("[Flask AI]", d.toString().trim()));
  flask.stderr.on("data", d => console.log("[Flask AI]", d.toString().trim()));
  flask.on("close", (code) => {
    console.log(`[Flask AI] 종료됨 (코드 ${code}) - 3초 후 재시작`);
    setTimeout(startFlaskServer, 3000);
  });
  console.log("[Flask AI] 서버 시작됨");
}

server.listen(PORT, async () => {
  console.log(`
  ================================================
  [Smart Safe Report] 서버가 가동되었습니다.
  - URL: https://safety-server-oqza.onrender.com
  - Port: ${PORT}
  ================================================
  `);
  // Flask AI 서버 자동 시작
  startFlaskServer();
});

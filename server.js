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

// ── SMS 발송 (Solapi REST API 직접 호출) ─
// solapi SDK 버전 문제를 피하기 위해 REST API 직접 호출
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
// 로그인 (admin + admin2)
// ────────────────────────────────────────
const ACCOUNTS = {
  admin:  { pwd: '1234', name: '관리자'  },
  admin2: { pwd: '1234', name: '관리자2' },
};

app.post("/api/login", (req, res) => {
  const { userid, pwd } = req.body;
  const account = ACCOUNTS[userid];
  if (account && account.pwd === pwd) {
    const token = jwt.sign({ userid }, process.env.JWT_SECRET || 'smart_safe_key', { expiresIn: "24h" });
    return res.json({ 성공: true, token, name: account.name });
  }
  res.status(401).json({ 성공: false, error: "아이디 또는 비밀번호가 틀렸습니다." });
});

// ────────────────────────────────────────
// AI 파이프라인
// ────────────────────────────────────────
function runPipeline(videoPath) {
  return new Promise((resolve, reject) => {
    const pipelinePath = path.join(__dirname, "AI_engine", "pipeline.py");
    const pyProcess = spawn("python3", [pipelinePath, videoPath]);
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

app.post("/analyze", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "분석할 파일을 업로드해 주세요." });
  const tempPath = path.resolve(req.file.path);
  const ext = req.file.mimetype.startsWith('image/') ? '.jpg' : '.mp4';
  const newPath = tempPath + ext;
  fs.renameSync(tempPath, newPath);
  try {
    const result = await runPipeline(newPath);
    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
    res.status(200).json({ 성공: true, report_id: result.report_id, message: "안전 분석이 성공적으로 완료되었습니다." });
  } catch (error) {
    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
    res.status(500).json({ error: "분석 시스템 장애", detail: error.message });
  }
});

// ────────────────────────────────────────
// 보고서 목록
// ────────────────────────────────────────
app.get("/api/reports", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT r.report_id, r.summary, r.created_at, r.risk_grade,
             r.helmet_violations, r.vest_violations, r.action_status,
             v.video_path,
             (SELECT f.frame_path FROM frames f WHERE f.video_id = r.video_id AND f.frame_path LIKE 'http%' LIMIT 1) AS thumbnail
      FROM reports r
      LEFT JOIN videos v ON r.video_id = v.video_id
      ORDER BY r.created_at DESC LIMIT 20
    `);
    res.json({ success: true, reports: rows });
  } catch (err) {
    res.status(500).json({ error: "데이터베이스 조회 실패" });
  }
});

// ────────────────────────────────────────
// 보고서 상세
// ────────────────────────────────────────
app.get("/api/reports/:id", async (req, res) => {
  try {
    const [report] = await db.query("SELECT * FROM reports WHERE report_id = ?", [req.params.id]);
    if (report.length === 0) return res.status(404).json({ error: "해당 보고서를 찾을 수 없습니다." });

    const [details] = await db.query(`
      SELECT ri.*, f.frame_path
      FROM report_items ri
      JOIN frames f ON ri.frame_id = f.frame_id
      WHERE ri.report_id = ? ORDER BY ri.item_id ASC
    `, [req.params.id]);

    let actionHistory = [];
    try {
      const [histRows] = await db.query(
        "SELECT * FROM action_history WHERE report_id = ? ORDER BY created_at ASC",
        [req.params.id]
      );
      actionHistory = histRows.map(h => ({
        id: h.id, status: h.status, person: h.person,
        note: h.note, method: h.method, category: h.category,
        timestamp: h.created_at
      }));
    } catch (_) {}

    res.json({ 성공: true, report: report[0], info: report[0], items: details, action_history: actionHistory });
  } catch (err) {
    res.status(500).json({ error: "상세 데이터 조회 실패" });
  }
});

// ────────────────────────────────────────
// 조치 상태 저장
// ────────────────────────────────────────
app.put("/api/reports/:id/action", async (req, res) => {
  const { id } = req.params;
  const { action_status, action_person, action_reason, action_note, action_method, action_category, action_time } = req.body;

  if (!['미조치','조치중','조치완료'].includes(action_status)) {
    return res.status(400).json({ error: "유효하지 않은 조치 상태입니다." });
  }
  const now = action_time ? new Date(action_time) : new Date();

  try {
    await db.query(
      `UPDATE reports SET action_status=?, action_person=?, action_reason=?,
       action_note=?, action_method=?, action_category=?, action_time=? WHERE report_id=?`,
      [action_status, action_person||null, action_reason||null,
       action_note||null, action_method||null, action_category||null, now, id]
    );
    try {
      await db.query(
        `INSERT INTO action_history (report_id,status,person,note,method,category,created_at) VALUES (?,?,?,?,?,?,?)`,
        [id, action_status, action_person||null, action_reason||action_note||null,
         action_method||null, action_category||null, now]
      );
    } catch (_) {}

    let history = [];
    try {
      const [h] = await db.query(
        "SELECT * FROM action_history WHERE report_id=? ORDER BY created_at ASC", [id]
      );
      history = h.map(r => ({
        id: r.id, status: r.status, person: r.person,
        note: r.note, method: r.method, category: r.category,
        timestamp: r.created_at
      }));
    } catch (_) {}

    res.json({ success: true, message: `'${action_status}'으로 저장되었습니다.`, history });
  } catch (err) {
    res.status(500).json({ error: "저장 오류", detail: err.message });
  }
});

// ────────────────────────────────────────
// 보고서 삭제
// ────────────────────────────────────────
app.delete("/api/reports/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await db.query("DELETE FROM report_items WHERE report_id = ?", [id]);
    await db.query(`DELETE FROM frames WHERE video_id = (SELECT video_id FROM reports WHERE report_id = ?)`, [id]);
    await db.query("DELETE FROM reports WHERE report_id = ?", [id]);
    await db.query("DELETE FROM videos WHERE video_id NOT IN (SELECT video_id FROM reports)");
    res.json({ 성공: true });
  } catch (err) { res.status(500).json({ error: "삭제 실패" }); }
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
  } catch (err) { res.status(500).json({ error: "초기화 실패" }); }
});

// ════════════════════════════════════════
//  인수인계 API
// ════════════════════════════════════════

app.get("/api/handover/summary", async (req, res) => {
  try {
    const [[{ unresolved_count }]] = await db.query(
      `SELECT COUNT(*) AS unresolved_count FROM reports
       WHERE action_status = '미조치' OR action_status IS NULL`
    );
    const [[{ today_count }]] = await db.query(
      `SELECT COUNT(*) AS today_count FROM reports WHERE DATE(created_at) = CURDATE()`
    );
    const [unresolved_reports] = await db.query(
      `SELECT report_id, risk_grade, summary, created_at FROM reports
       WHERE action_status = '미조치' OR action_status IS NULL
       ORDER BY created_at DESC LIMIT 5`
    );
    res.json({ success: true, unresolved_count, today_count, unresolved_reports });
  } catch (err) {
    res.status(500).json({ error: "데이터 조회 실패", detail: err.message });
  }
});

app.post("/api/handover/approve", async (req, res) => {
  const { user, approved_at } = req.body;
  const now = approved_at ? new Date(approved_at) : new Date();

  let unresolvedCount = 0, todayCount = 0;
  try {
    const [[u]] = await db.query(
      `SELECT COUNT(*) AS cnt FROM reports WHERE action_status = '미조치' OR action_status IS NULL`
    );
    const [[t]] = await db.query(
      `SELECT COUNT(*) AS cnt FROM reports WHERE DATE(created_at) = CURDATE()`
    );
    unresolvedCount = u.cnt;
    todayCount      = t.cnt;
  } catch (_) {}

  try {
    await db.query(
      "INSERT INTO handover_logs (user, approved_at) VALUES (?, ?)",
      [user || 'unknown', now]
    );
  } catch (_) {}

  const smsSent = await sendHandoverSms(user, unresolvedCount, todayCount);
  res.json({ success: true, message: "인수 승인이 완료되었습니다.", sms_sent: smsSent });
});

// ────────────────────────────────────────
// 헬스 체크
// ────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "running", uptime: process.uptime(), db_connected: true });
});

// ════════════════════════════════════════
//  DB 자동 준비
// ════════════════════════════════════════
async function setupDatabase() {
  const alterSqls = [
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS action_status   VARCHAR(20)  DEFAULT '미조치'",
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS action_person   VARCHAR(100) DEFAULT NULL",
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS action_reason   TEXT         DEFAULT NULL",
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS action_note     TEXT         DEFAULT NULL",
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS action_method   VARCHAR(100) DEFAULT NULL",
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS action_category VARCHAR(100) DEFAULT NULL",
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS action_time     DATETIME     DEFAULT NULL",
  ];
  for (const sql of alterSqls) await db.query(sql).catch(() => {});

  await db.query(`
    CREATE TABLE IF NOT EXISTS action_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      report_id INT NOT NULL, status VARCHAR(20) NOT NULL,
      person VARCHAR(100) DEFAULT NULL, note TEXT DEFAULT NULL,
      method VARCHAR(100) DEFAULT NULL, category VARCHAR(100) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).catch(() => {});

  await db.query(`
    CREATE TABLE IF NOT EXISTS handover_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user VARCHAR(100) NOT NULL,
      approved_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).catch(() => {});

  console.log('✅ DB 테이블 준비 완료');
}

server.listen(PORT, async () => {
  await setupDatabase();
  console.log(`
  ================================================
  [Smart Safe Report] 서버가 가동되었습니다.
  - URL: https://safety-server-oqza.onrender.com
  - Port: ${PORT}
  ================================================
  `);
});

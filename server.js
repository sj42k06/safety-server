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

// ── Solapi SMS 공통 발송 함수 ─────────────
async function solapiSend(apiKey, apiSecret, from, to, text) {
  const date      = new Date().toISOString();
  const salt      = Math.random().toString(36).substring(2, 20);
  const hmac      = crypto.createHmac('sha256', apiSecret);
  hmac.update(date + salt);
  const signature = hmac.digest('hex');
  const res = await axios.post(
    'https://api.solapi.com/messages/v4/send',
    { message: { to, from, text } },
    {
      headers: {
        'Authorization': `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    }
  );
  return res.data;
}

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
  admin1: process.env.ADMIN_PHONE,
  admin2: process.env.ADMIN2_PHONE,
  worker1: process.env.WORKER_PHONE,
};

// ── SMS 발송 ─────────────────────────────
async function sendHandoverSms(approvedBy, unresolvedCount, todayCount) {
  try {
    const from    = process.env.COOLSMS_FROM;
    const apiKey    = process.env.COOLSMS_API_KEY;
    const apiSecret = process.env.COOLSMS_API_SECRET;

    if (!from || !apiKey || !apiSecret) {
      console.warn('⚠️  SMS 설정 누락 - 발송 스킵');
      return false;
    }

    const now  = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const nameMap = { 'admin1': '손광민', 'admin2': '정재학' };
    const approverName = nameMap[approvedBy] || approvedBy;
    const text = `[안전관리시스템] 인수인계 완료\n${approverName}님이 보고서를 확인하여 인수인계를 완료하였습니다\n시각: ${now}\n미조치: ${unresolvedCount}건`;

    // 손광민 + 정재학 둘 다 발송
    const phones = [
      process.env.ADMIN_PHONE,
      process.env.ADMIN2_PHONE
    ].filter(Boolean);

    for (const toPhone of phones) {
      await solapiSend(apiKey, apiSecret, from, toPhone, text);
      console.log(`✅ 인수인계 SMS 발송 → ${toPhone}`);
    }
    return true;
  } catch (err) {
    console.error('❌ SMS 발송 오류:', err.response?.data || err.message);
    return false;
  }
}

// ── 위험 감지 SMS (3명 발송) ─────────
async function sendDangerSms(dangerType, riskPercent, action, detectedTime) {
  try {
    const from      = process.env.COOLSMS_FROM;
    const apiKey    = process.env.COOLSMS_API_KEY;
    const apiSecret = process.env.COOLSMS_API_SECRET;
    const now = detectedTime || new Date().toLocaleTimeString('ko-KR', {timeZone:'Asia/Seoul', hour:'2-digit', minute:'2-digit'});

    if (!from || !apiKey || !apiSecret) {
      console.warn('⚠️  SMS 설정 누락');
      return;
    }

    const text = `[스마트 현장 안전관제]\n⚠️ 위험 감지!\n\n감지 시간: ${now}\n위험 요소: ${dangerType}\n위험도: ${riskPercent}%\n\n즉각 조치: ${action}`;

    // 수신자: 손광민 + 정재학 + 수연
    const phones = [
      process.env.ADMIN_PHONE,       // 손광민
      process.env.ADMIN2_PHONE,      // 정재학
      process.env.WORKER_PHONE,      // 수연
    ].filter(Boolean);

    for (const toPhone of phones) {
      await solapiSend(apiKey, apiSecret, from, toPhone, text);
      console.log(`✅ 위험 감지 SMS 발송 → ${toPhone}`);
    }
  } catch (err) {
    console.error('❌ 위험 SMS 오류:', err.response?.data || err.message);
  }
}

// ── 미들웨어 ─────────────────────────────
app.use(cors({ origin: "*", credentials: true }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.json({ limit: "50mb" }));
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

// ────────────────────────────────────────
// 위험 감지 SMS API (1번만 발송)
// ────────────────────────────────────────
app.post('/api/danger-sms', async (req, res) => {
  try {
    const { danger_type, risk_percent, action, detected_time } = req.body;
    await sendDangerSms(danger_type, risk_percent, action, detected_time);
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

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
function runPipeline(videoPath, userId, dangerTypes = []) {
  return new Promise((resolve, reject) => {
    const pipelinePath = path.join(__dirname, "AI_engine", "pipeline.py");
    const env = { ...process.env, DANGER_TYPES: JSON.stringify(dangerTypes) };
    const pyProcess = spawn("python3", [pipelinePath, videoPath, String(userId || 1)], { env });
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
  // Flask 아직 준비 안됐으면 빈 결과 반환 (에러 말고)
  if (!flaskReady) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.json({ boxes: [], danger: false, ppe_violation: false, not_ready: true });
  }
  const tempPath = path.resolve(req.file.path);
  const newPath  = tempPath + '.jpg';
  fs.renameSync(tempPath, newPath);

  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('image', fs.createReadStream(newPath), 'capture.jpg');

    const response = await axios.post(AI_SERVER + '/analyze-quick', form, {
      headers: form.getHeaders(),
      timeout: 30000
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
  let dangerTypes = [];
  try { dangerTypes = JSON.parse(req.body.danger_types || '[]'); } catch(e) {}
  const actionStatus = req.body.action_status || '미조치';
  const actionNote   = req.body.action_note   || '';

  try {
    // Cloudinary에 이미지 먼저 업로드
    let imageUrl = '';
    try {
      const uploadResult = await cloudinary.uploader.upload(newPath, { folder: 'safety_frames' });
      imageUrl = uploadResult.secure_url;
      console.log('✅ Cloudinary 업로드:', imageUrl);
    } catch(e) { console.error('Cloudinary 오류:', e.message); }

    const result = await runPipeline(newPath, userId, dangerTypes);
    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);

    // 이미지 URL 업데이트
    if (result.risk_id && imageUrl) {
      try {
        await db.query("UPDATE risk_logs SET image_path = ? WHERE risk_id = ?", [imageUrl, result.risk_id]);
      } catch(e) { console.error('이미지 업데이트 오류:', e.message); }
    }

    // 조치 상태 즉시 업데이트
    if (result.risk_id && actionStatus !== '미조치') {
      try {
        await db.query(
          "UPDATE risk_logs SET action_status = ?, action_note = ? WHERE risk_id = ?",
          [actionStatus, actionNote || null, result.risk_id]
        );
      } catch(e) { console.error('조치상태 업데이트 오류:', e.message); }
    }

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
// 보고서 목록 (새 DB 구조)
// ────────────────────────────────────────
app.get("/api/reports", async (req, res) => {
  try {
    const { days, from, to, shift, grade } = req.query;
    let where = ['1=1'];
    let params = [];

    if (days && days !== 'all') {
      where.push('r.report_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)');
      params.push(parseInt(days));
    }
    if (from) { where.push('r.report_date >= ?'); params.push(from); }
    if (to)   { where.push('r.report_date <= ?'); params.push(to); }
    if (shift) { where.push('ms.shift_type = ?'); params.push(shift); }

    const whereStr = where.join(' AND ');

    const [rows] = await db.query(`
      SELECT
        r.report_id,
        r.report_title,
        r.report_date,
        r.created_at,
        r.report_content,
        r.total_risk_events,
        r.resolved_count,
        r.unresolved_count,
        r.major_risk_case,
        r.max_risk_percent,
        r.avg_risk_percent,
        r.approval_status,
        r.next_shift_note,
        ms.shift_type,
        ms.start_time,
        ms.end_time,
        u.name AS created_by_name,
        (SELECT re.bbox_image_path FROM risk_events re
         WHERE re.session_id = r.session_id
         AND re.bbox_image_path IS NOT NULL
         AND re.bbox_image_path != ''
         ORDER BY re.detected_time ASC LIMIT 1) AS image_path
      FROM reports r
      LEFT JOIN monitoring_sessions ms ON r.session_id = ms.session_id
      LEFT JOIN users u ON r.created_by = u.user_id
      WHERE ${whereStr}
      ORDER BY r.created_at DESC
      LIMIT 100
    `, params);
    res.json({ success: true, reports: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "데이터베이스 조회 실패" });
  }
});

// ────────────────────────────────────────
// 보고서 상세 (새 DB 구조)
// ────────────────────────────────────────
app.get("/api/reports/:id", async (req, res) => {
  try {
    const [[report]] = await db.query(`
      SELECT
        r.report_id, r.report_title, r.report_date, r.report_content,
        r.created_at, r.total_risk_events, r.resolved_count, r.unresolved_count,
        r.major_risk_case, r.max_risk_percent, r.avg_risk_percent,
        r.approval_status, r.next_shift_note, r.created_by,
        ms.shift_type, ms.start_time, ms.end_time, ms.camera_id,
        u.name AS created_by_name
      FROM reports r
      LEFT JOIN monitoring_sessions ms ON r.session_id = ms.session_id
      LEFT JOIN users u ON r.created_by = u.user_id
      WHERE r.report_id = ?
    `, [req.params.id]);

    if (!report) return res.status(404).json({ error: "해당 보고서를 찾을 수 없습니다." });

    // 타임라인 데이터 (위험 이벤트 + 조치 기록)
    const [timeline] = await db.query(`
      SELECT
        re.risk_id, re.detected_time, re.risk_case, re.accident_type,
        re.likelihood_score, re.severity_score, re.risk_score,
        re.risk_percent, re.risk_level, re.description,
        re.image_path, re.bbox_image_path,
        al.action_status, al.action_time,
        sr.law_name, sr.law_content, sr.recommendation
      FROM risk_events re
      LEFT JOIN action_logs al ON re.risk_id = al.risk_id
      LEFT JOIN safety_rules sr ON re.rule_id = sr.rule_id
      WHERE re.session_id = (SELECT session_id FROM reports WHERE report_id = ?)
      ORDER BY re.detected_time ASC
    `, [req.params.id]);

    res.json({ success: true, report, timeline });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "상세 데이터 조회 실패" });
  }
});

// ────────────────────────────────────────
// 조치 상태 업데이트 (새 DB 구조)
// ────────────────────────────────────────
app.put("/api/risk/:risk_id/action", async (req, res) => {
  const { risk_id } = req.params;
  const { action_status } = req.body;

  if (!['조치완료', '미조치', '확인중', '오탐'].includes(action_status)) {
    return res.status(400).json({ error: "유효하지 않은 조치 상태입니다." });
  }

  try {
    await db.query(
      "UPDATE action_logs SET action_status = ?, action_time = ? WHERE risk_id = ?",
      [action_status, action_status === '조치완료' ? new Date() : null, risk_id]
    );
    res.json({ success: true, message: `'${action_status}'으로 저장되었습니다.` });
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
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    await db.query("DELETE FROM handover_logs WHERE report_id = ?", [id]);
    await db.query("DELETE FROM reports WHERE report_id = ?", [id]);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    res.json({ 성공: true });
  } catch (err) {
    await db.query("SET FOREIGN_KEY_CHECKS = 1").catch(()=>{});
    console.error('삭제 오류:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/reports", async (req, res) => {
  try {
    await db.query("DELETE FROM handover_logs");
    await db.query("DELETE FROM reports");
    await db.query("DELETE FROM risk_logs");
    res.json({ 성공: true });
  } catch (err) {
    console.error('전체삭제 오류:', err.message);
    res.status(500).json({ error: "초기화 실패", detail: err.message });
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
    const toUser   = users.find(u => u.login_id !== user && u.login_id !== null);

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



// ────────────────────────────────────────
// 알람 저장 API (위험 감지 시)
// ────────────────────────────────────────
app.post("/api/alarm", async (req, res) => {
  try {
    const { session_id, rule_id, risk_case, risk_percent, risk_level, bbox_image_url } = req.body;

    // risk_events에 저장
    const [result] = await db.query(`
      INSERT INTO risk_events
      (session_id, rule_id, detected_time, risk_case, accident_type,
       likelihood_score, severity_score, risk_score, risk_percent, risk_level,
       description, bbox_image_path, created_at)
      SELECT ?, rule_id, NOW(), case_name, accident_type,
             likelihood_score, severity_score, risk_score, ?, ?,
             CONCAT(case_name, ' 상황이 감지되었습니다.'), ?, NOW()
      FROM safety_rules WHERE rule_id = ?
    `, [session_id, risk_percent, risk_level, bbox_image_url || '', rule_id]);

    const risk_id = result.insertId;

    // action_logs에 미조치로 저장
    const [[session]] = await db.query('SELECT manager_id FROM monitoring_sessions WHERE session_id = ?', [session_id]);
    await db.query(`
      INSERT INTO action_logs (risk_id, action_status, action_manager_id, created_at)
      VALUES (?, '미조치', ?, NOW())
    `, [risk_id, session?.manager_id || 1]);

    // 세션 위험 이벤트 수 업데이트
    await db.query(`
      UPDATE monitoring_sessions
      SET risk_event_count = risk_event_count + 1, session_status = '위험발생'
      WHERE session_id = ?
    `, [session_id]);

    res.json({ success: true, risk_id });
  } catch (err) {
    console.error('알람 저장 오류:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────
// 현재 세션 조회 API
// ────────────────────────────────────────
app.get("/api/session/current", async (req, res) => {
  try {
    // 한국 시간 기준으로 계산 (UTC+9)
    const now = new Date();
    const koreaTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const hour = koreaTime.getUTCHours();
    let shiftType;
    if (hour >= 6 && hour < 14) shiftType = '오전';
    else if (hour >= 14 && hour < 22) shiftType = '오후';
    else shiftType = '야간';

    const today = koreaTime.toISOString().slice(0, 10);

    const [[session]] = await db.query(`
      SELECT * FROM monitoring_sessions
      WHERE session_date = ? AND shift_type = ?
      ORDER BY session_id DESC LIMIT 1
    `, [today, shiftType]);

    if (!session) {
      // 세션 없으면 새로 생성
      // 한국 시간 기준으로 start_time, end_time 계산
      // 한국 시간 직접 포맷 (toISOString은 UTC로 변환되므로 사용 안 함)
      const pad = n => String(n).padStart(2, '0');
      const dateStr = `${koreaTime.getUTCFullYear()}-${pad(koreaTime.getUTCMonth()+1)}-${pad(koreaTime.getUTCDate())}`;
      let koreaStart, koreaEnd;
      if (shiftType === '오전') {
        koreaStart = `${dateStr} 06:00:00`;
        koreaEnd   = `${dateStr} 14:00:00`;
      } else if (shiftType === '오후') {
        koreaStart = `${dateStr} 14:00:00`;
        koreaEnd   = `${dateStr} 22:00:00`;
      } else {
        // 야간: 22:00 ~ 다음날 06:00
        const nextDate = new Date(koreaTime.getTime() + 24 * 60 * 60 * 1000);
        const nextDateStr = `${nextDate.getUTCFullYear()}-${pad(nextDate.getUTCMonth()+1)}-${pad(nextDate.getUTCDate())}`;
        koreaStart = `${dateStr} 22:00:00`;
        koreaEnd   = `${nextDateStr} 06:00:00`;
      }

      const [result] = await db.query(`
        INSERT INTO monitoring_sessions
        (camera_id, monitored_area, shift_type, session_date, start_time, end_time, manager_id, analyzed_frames, normal_frames, risk_event_count, session_status, handover_status)
        VALUES ('CAM-01', '현장 모니터링 구역', ?, ?, ?, ?, 1, 0, 0, 0, '정상', '대기')
      `, [shiftType, today, koreaStart, koreaEnd]);
      const [[newSession]] = await db.query('SELECT * FROM monitoring_sessions WHERE session_id = ?', [result.insertId]);
      return res.json({ success: true, session: newSession });
    }

    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────
// 슬라이드 이미지 목록 API
// ────────────────────────────────────────
app.get("/api/slides", (req, res) => {
  const fs = require('fs');
  const slidesDir = path.join(__dirname, 'public', 'slides');

  // 케이스별 폴더 분류
  const cases = {
    forklift: [],
    material: [],
    crowd: []
  };

  Object.keys(cases).forEach(function(caseName) {
    const caseDir = path.join(slidesDir, caseName);
    if (fs.existsSync(caseDir)) {
      cases[caseName] = fs.readdirSync(caseDir)
        .filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f))
        .map(f => '/slides/' + caseName + '/' + f);
    }
  });

  res.json({ images: cases });
});

// ────────────────────────────────────────
// 통계 API (새 DB 구조)
// ────────────────────────────────────────
app.get("/api/stats", async (req, res) => {
  try {
    const { days, shift } = req.query;
    let where = ['1=1'];
    let params = [];

    if (days && days !== 'all') {
      where.push('ms.session_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)');
      params.push(parseInt(days));
    }
    if (shift) { where.push('ms.shift_type = ?'); params.push(shift); }
    const whereStr = where.join(' AND ');

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM risk_events re JOIN monitoring_sessions ms ON re.session_id = ms.session_id WHERE ${whereStr}`, params);
    const [[{ immediate }]] = await db.query(`SELECT COUNT(*) AS immediate FROM risk_events re JOIN monitoring_sessions ms ON re.session_id = ms.session_id WHERE re.risk_level = '즉각조치' AND ${whereStr}`, params);
    const [[{ danger }]] = await db.query(`SELECT COUNT(*) AS danger FROM risk_events re JOIN monitoring_sessions ms ON re.session_id = ms.session_id WHERE re.risk_level = '위험' AND ${whereStr}`, params);
    const [[{ caution }]] = await db.query(`SELECT COUNT(*) AS caution FROM risk_events re JOIN monitoring_sessions ms ON re.session_id = ms.session_id WHERE re.risk_level = '주의' AND ${whereStr}`, params);
    const [[{ unresolved }]] = await db.query(`SELECT COUNT(*) AS unresolved FROM risk_events re JOIN monitoring_sessions ms ON re.session_id = ms.session_id JOIN action_logs al ON re.risk_id = al.risk_id WHERE al.action_status = '미조치' AND ${whereStr}`, params);
    const [[{ resolved }]] = await db.query(`SELECT COUNT(*) AS resolved FROM risk_events re JOIN monitoring_sessions ms ON re.session_id = ms.session_id JOIN action_logs al ON re.risk_id = al.risk_id WHERE al.action_status = '조치완료' AND ${whereStr}`, params);
    const [[{ reportCount }]] = await db.query(`SELECT COUNT(*) AS reportCount FROM reports r JOIN monitoring_sessions ms ON r.session_id = ms.session_id WHERE ${whereStr}`, params);

    const [byCase] = await db.query(`
      SELECT re.risk_case AS case_name, COUNT(*) AS count
      FROM risk_events re JOIN monitoring_sessions ms ON re.session_id = ms.session_id
      WHERE ${whereStr}
      GROUP BY re.risk_case ORDER BY count DESC LIMIT 5
    `, params);

    const [daily] = await db.query(`
      SELECT ms.session_date AS date, COUNT(*) AS danger
      FROM risk_events re JOIN monitoring_sessions ms ON re.session_id = ms.session_id
      WHERE ${whereStr}
      GROUP BY ms.session_date ORDER BY date DESC LIMIT 30
    `, params);

    res.json({ success: true, total, immediate, danger, caution, unresolved, resolved, reportCount, byCase, daily });
  } catch (err) {
    console.error('통계 오류:', err.message);
    res.status(500).json({ error: "통계 조회 실패" });
  }
});

// ────────────────────────────────────────
// 인수인계 요약 API (새 DB 구조)
// ────────────────────────────────────────
app.get("/api/handover/summary", async (req, res) => {
  try {
    const { user } = req.query;

    // 미확인 인수인계 조회
    const [handovers] = await db.query(`
      SELECT
        hl.handover_id, hl.handover_date, hl.handover_status, hl.handover_note,
        r.report_id, r.report_title, r.report_date, r.total_risk_events,
        r.unresolved_count, r.major_risk_case, r.avg_risk_percent,
        ms.shift_type, ms.start_time, ms.end_time,
        u.name AS from_user_name
      FROM handover_logs hl
      JOIN reports r ON hl.report_id = r.report_id
      JOIN monitoring_sessions ms ON r.session_id = ms.session_id
      JOIN users u ON hl.from_user_id = u.user_id
      WHERE hl.handover_status = '대기'
      ORDER BY hl.handover_date DESC
      LIMIT 5
    `);

    res.json({ success: true, handovers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────
// 인수인계 승인 + 보고서 생성 API
// ────────────────────────────────────────
app.post("/api/handover/approve", async (req, res) => {
  try {
    const { handover_id, from_user, to_user, from_phone, to_phone } = req.body;

    // 인수인계 승인
    await db.query(`
      UPDATE handover_logs
      SET handover_status = '확인완료', confirmed_at = NOW(), sms_sent = TRUE, signature_check = TRUE
      WHERE handover_id = ?
    `, [handover_id]);

    // SMS 발송 (양쪽)
    const fromMsg = `[스마트 안전관제] ${from_user} 관리자님, 인수인계가 완료되었습니다.`;
    const toMsg   = `[스마트 안전관제] ${to_user} 관리자님, 인수인계가 완료되었습니다. 근무를 시작하세요.`;

    if (from_phone) await sendSms(from_phone, fromMsg);
    if (to_phone)   await sendSms(to_phone, toMsg);

    res.json({ success: true, message: '인수인계가 승인되었습니다.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────
// 보고서 생성 API (인수인계 직전)
// ────────────────────────────────────────
app.post("/api/reports/generate", async (req, res) => {
  try {
    const { session_id, created_by } = req.body;

    // 세션 정보 조회
    const [[session]] = await db.query('SELECT * FROM monitoring_sessions WHERE session_id = ?', [session_id]);
    if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });

    // 이미 해당 세션 보고서 있으면 업데이트
    const [[existing]] = await db.query(
      'SELECT report_id FROM reports WHERE session_id = ? ORDER BY created_at ASC LIMIT 1',
      [session_id]
    );

    // 위험 이벤트 통계
    const [[stats]] = await db.query(`
      SELECT
        COUNT(*) AS total_risk,
        SUM(CASE WHEN al.action_status = '조치완료' THEN 1 ELSE 0 END) AS resolved,
        SUM(CASE WHEN al.action_status = '미조치' THEN 1 ELSE 0 END) AS unresolved,
        MAX(re.risk_percent) AS max_percent,
        AVG(re.risk_percent) AS avg_percent
      FROM risk_events re
      LEFT JOIN action_logs al ON re.risk_id = al.risk_id
      WHERE re.session_id = ?
    `, [session_id]);

    // 주요 위험 케이스
    const [[majorCase]] = await db.query(`
      SELECT risk_case FROM risk_events WHERE session_id = ?
      GROUP BY risk_case ORDER BY COUNT(*) DESC LIMIT 1
    `, [session_id]);

    // 보고서 생성
    const sessionDateStr = session.session_date instanceof Date
      ? session.session_date.toISOString().slice(0, 10)
      : String(session.session_date).slice(0, 10);
    const reportTitle = `${sessionDateStr} ${session.shift_type} 안전 인수인계 보고서`;

    let report_id;

    if (existing) {
      // 기존 보고서 업데이트
      report_id = existing.report_id;
      await db.query(`
        UPDATE reports SET
          total_analyzed_frames = ?, total_normal_frames = ?,
          total_risk_events = ?, resolved_count = ?, unresolved_count = ?,
          major_risk_case = ?, max_risk_percent = ?, avg_risk_percent = ?,
          approval_status = '승인대기'
        WHERE report_id = ?
      `, [
        session.analyzed_frames, session.normal_frames,
        stats.total_risk || 0, stats.resolved || 0, stats.unresolved || 0,
        majorCase?.risk_case || '해당없음',
        stats.max_percent || 0, stats.avg_percent || 0,
        report_id
      ]);
    } else {
      // 새 보고서 생성
      const [result] = await db.query(`
        INSERT INTO reports
        (session_id, report_title, report_date, created_by, total_analyzed_frames,
         total_normal_frames, total_risk_events, resolved_count, unresolved_count,
         major_risk_case, max_risk_percent, avg_risk_percent, approval_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '승인대기', NOW())
      `, [
        session_id, reportTitle, session.session_date, created_by,
        session.analyzed_frames, session.normal_frames,
        stats.total_risk || 0, stats.resolved || 0, stats.unresolved || 0,
        majorCase?.risk_case || '해당없음',
        stats.max_percent || 0, stats.avg_percent || 0
      ]);
      report_id = result.insertId;
    }

    // 인수인계 로그 생성
    const nextManagerId = created_by >= 4 ? 1 : created_by + 1;
    await db.query(`
      INSERT INTO handover_logs
      (report_id, from_user_id, to_user_id, handover_date, handover_status, created_at)
      VALUES (?, ?, ?, NOW(), '대기', NOW())
    `, [report_id, created_by, nextManagerId]);

    res.json({ success: true, report_id, message: '보고서가 생성되었습니다.' });
  } catch (err) {
    console.error('보고서 생성 오류:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ────────────────────────────────────────
// 세션별 위험 이벤트 조회 API
// ────────────────────────────────────────
app.get("/api/session/:session_id/events", async (req, res) => {
  try {
    const [events] = await db.query(`
      SELECT re.risk_id, re.detected_time, re.risk_case, re.risk_percent, re.risk_level,
             al.action_status, al.action_time
      FROM risk_events re
      LEFT JOIN action_logs al ON re.risk_id = al.risk_id
      WHERE re.session_id = ?
      ORDER BY re.detected_time ASC
    `, [req.params.session_id]);
    res.json({ success: true, events });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});


// ────────────────────────────────────────
// 바운딩박스 이미지 업로드 API (Cloudinary)
// ────────────────────────────────────────
app.post('/api/upload-bbox', async (req, res) => {
  try {
    const { image_data } = req.body; // base64 이미지
    if (!image_data) return res.status(400).json({ error: '이미지 없음' });

    const uploadResult = await cloudinary.uploader.upload(image_data, {
      resource_type: 'image'
    });

    res.json({ success: true, url: uploadResult.secure_url });
  } catch(err) {
    console.error('이미지 업로드 오류:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ────────────────────────────────────────
// 위험도 기준표 API (safety_rules)
// ────────────────────────────────────────
app.get('/api/safety-rules', async (req, res) => {
  try {
    const [rules] = await db.query(`
      SELECT rule_id, case_name, accident_type,
             likelihood_score, severity_score, risk_score,
             risk_percent, risk_level, risk_formula,
             law_name, law_content, recommendation
      FROM safety_rules
      ORDER BY rule_id
    `);
    res.json({ success: true, rules });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});


// ────────────────────────────────────────
// 미확인 보고서 체크 API
// ────────────────────────────────────────
app.get('/api/handover/pending', async (req, res) => {
  try {
    const loginId = req.query.user;
    if (!loginId) return res.json({ hasPending: false });

    // login_id로 user_id 조회
    const [userRows] = await db.query(
      'SELECT user_id FROM users WHERE login_id = ?', [loginId]
    );
    if (userRows.length === 0) return res.json({ hasPending: false });
    const userId = userRows[0].user_id;

    // 내가 받아야 할 미확인 보고서 조회
    const [rows] = await db.query(`
      SELECT hl.handover_id, r.report_id, r.report_title,
             u.name AS from_user
      FROM handover_logs hl
      JOIN reports r ON hl.report_id = r.report_id
      JOIN users u ON hl.from_user_id = u.user_id
      WHERE hl.to_user_id = ?
        AND hl.handover_status = '대기'
      ORDER BY hl.created_at DESC
      LIMIT 1
    `, [userId]);

    if (rows.length > 0) {
      res.json({
        hasPending: true,
        report_id: rows[0].report_id,
        report_title: rows[0].report_title,
        from_user: rows[0].from_user
      });
    } else {
      res.json({ hasPending: false });
    }
  } catch(err) {
    res.json({ hasPending: false });
  }
});


// ────────────────────────────────────────
// 인수인계 승인 API
// ────────────────────────────────────────
app.post('/api/handover/confirm', async (req, res) => {
  try {
    const { report_id, user } = req.body;

    // handover_logs 상태 업데이트
    await db.query(`
      UPDATE handover_logs
      SET handover_status = '확인완료',
          confirmed_at = NOW(),
          signature_check = TRUE
      WHERE report_id = ?
        AND handover_status = '대기'
    `, [report_id]);

    // reports 승인 상태 업데이트
    await db.query(`
      UPDATE reports
      SET approval_status = '승인완료',
          approved_at = NOW()
      WHERE report_id = ?
    `, [report_id]);

    // 미조치 건수 조회
    const [[stats]] = await db.query(`
      SELECT COUNT(*) AS unresolved FROM action_logs al
      JOIN risk_events re ON al.risk_id = re.risk_id
      JOIN reports r ON re.session_id = r.session_id
      WHERE r.report_id = ? AND al.action_status = '미조치'
    `, [report_id]);

    // SMS 발송
    const approvedBy = user || 'admin2';
    await sendHandoverSms(approvedBy, stats.unresolved || 0, 0);

    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});


// ────────────────────────────────────────
// 세션별 보고서 조회
// ────────────────────────────────────────
app.get('/api/reports/by-session/:session_id', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM reports WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
      [req.params.session_id]
    );
    if (rows.length > 0) {
      res.json({ success: true, report: rows[0] });
    } else {
      res.json({ success: false });
    }
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────
// 헬스 체크
// ────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "running", uptime: process.uptime(), db_connected: true });
});

// ── Flask AI 서버 자동 시작 + 헬스체크 ──
let flaskReady = false;

async function waitFlaskReady() {
  const maxTry = 30;
  for (let i = 0; i < maxTry; i++) {
    try {
      const res = await axios.get('http://localhost:5001/health', { timeout: 2000 });
      if (res.status === 200 || res.status === 404) {
        flaskReady = true;
        console.log('[Flask AI] 준비 완료!');
        return;
      }
    } catch(e) {}
    // 대기 중 로그 생략
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log('[Flask AI] 준비 타임아웃 - 계속 진행');
  flaskReady = true;
}

function startFlaskServer() {
  flaskReady = false;
  const flaskPath = path.join(__dirname, "AI_engine", "app.py");
  const flask = spawn("python3", [flaskPath], {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  flask.stdout.on("data", d => console.log("[Flask AI]", d.toString().trim()));
  flask.stderr.on("data", d => console.log("[Flask AI]", d.toString().trim()));
  flask.on("close", (code) => {
    flaskReady = false;
    console.log(`[Flask AI] 종료됨 (코드 ${code}) - 3초 후 재시작`);
    setTimeout(startFlaskServer, 3000);
  });
  console.log("[Flask AI] 서버 시작됨");
  waitFlaskReady();
}

// 전역 에러 핸들러 - 서버 크래시 방지
process.on('uncaughtException', (err) => {
  console.error('⚠️ 처리되지 않은 오류 (서버 유지):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ 처리되지 않은 Promise 거부 (서버 유지):', reason);
});

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

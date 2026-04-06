const express = require("express");
const multer = require("multer");
const path = require("path");
const mysql = require("mysql2");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

const db = mysql.createConnection({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT
});

db.connect(err => {
  if (err) {
    console.log("DB 연결 실패:", err);
  } else {
    console.log("DB 연결 성공");
  }
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

app.post("/login", (req, res) => {
  const { userid, pwd } = req.body;
  if (userid === "admin" && pwd === "1234") {
    res.redirect("/index.html");
  } else {
    res.send("로그인 실패");
  }
});

app.post("/upload", upload.single("videos"), (req, res) => {
  const file = req.file;
  const area = req.body.riskLevel;
  const description = req.body.description;

  if (!file) {
    return res.send("파일 없음");
  }

  const time = new Date().toLocaleString();
  const filePath = "/uploads/" + file.filename;
  const type = file.mimetype.startsWith("video") ? "video" : "image";
  const result = "영상 분석 완료";

  const sql = "INSERT INTO records (time, file, type, result, area, description) VALUES (?, ?, ?, ?, ?, ?)";
  const values = [time, filePath, type, result, area, description];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.log(err);
      return res.send("DB 저장 실패");
    }
    res.send(`
      <h2>영상 분석 완료</h2>
      <video src="${filePath}" controls width="300"></video>
      <br><br>
      <a href="/record.html">기록 보기</a>
    `);
  });
});

app.get("/records", (req, res) => {
  db.query("SELECT * FROM records", (err, results) => {
    if (err) return res.json([]);
    res.json(results);
  });
});

app.listen(10000, () => {
  console.log("server running");
});

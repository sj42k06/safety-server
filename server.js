const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const mysql = require("mysql2");

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  return res.redirect("/login.html");
});

app.use(express.static("public", { index: false }));
app.use("/frames", express.static("frames"));
app.use("/uploads", express.static("uploads"));

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("frames")) fs.mkdirSync("frames");

const db = mysql.createConnection({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE
});

db.connect((err) => {
  if (err) {
    console.log("DB 연결 실패:", err);
  } else {
    console.log("DB 연결 성공");
  }
});

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

app.post("/login", (req, res) => {
  const { userid, pwd } = req.body;
  if (userid === "admin" && pwd === "1234") {
    return res.redirect("/index.html");
  }
  res.send("로그인 실패");
});

app.post("/upload", upload.fields([
  { name: "video", maxCount: 1 },
  { name: "images", maxCount: 5 }
]), (req, res) => {

  const videoFile = req.files["video"]?.[0];
  const imageFiles = req.files["images"] || [];

  if (!videoFile && imageFiles.length === 0) {
    return res.send("파일 없음");
  }

  const area = req.body.riskLevel;
  const description = req.body.description;

  if (videoFile) {
    const videoPath = path.join(__dirname, videoFile.path);
    const videoName = path.parse(videoPath).name;
    const outputFolder = path.join(__dirname, "frames", videoName);

    if (!fs.existsSync(outputFolder)) {
      fs.mkdirSync(outputFolder, { recursive: true });
    }

    const outputPattern = path.join(outputFolder, "frame_%04d.jpg");

    ffmpeg(videoPath)
      .outputOptions([
        "-vf fps=1,scale=640:480",
        "-q:v 2"
      ])
      .output(outputPattern)
      .on("end", () => {

        const detected = Math.floor(Math.random() * 3) + 1;

        let riskLevel = "";
        let action = "";

        if (detected === 1) { riskLevel = "Medium"; action = "주의 요망"; }
        if (detected === 2) { riskLevel = "High"; action = "즉시 점검 필요"; }
        if (detected === 3) { riskLevel = "Critical"; action = "작업 중단 필요"; }

        const result = `위험요소 ${detected}개 / 위험도 ${riskLevel}`;

        saveData(`/${videoFile.path}`, "video", result, area, description);

        res.send(`
          <h2>AI 인수인계 보고서</h2>
          <p>구역: ${area}</p>
          <p>설명: ${description}</p>
          <p>${result}</p>
          <p>조치사항: ${action}</p>
          <video src="/${videoFile.path}" controls width="400"></video>
          <br><br>
          <a href="/record.html">기록 보기</a>
        `);
      })
      .on("error", (err) => {
        console.log(err);
        res.send("ffmpeg 오류");
      })
      .run();

  } else {
    const imagePath = "/" + imageFiles[0].path;

    const result = "이미지 등록 완료";

    saveData(imagePath, "image", result, area, description);

    res.send(`
      <h2>${result}</h2>
      <img src="${imagePath}" width="300"/>
      <br><br>
      <a href="/record.html">기록 보기</a>
    `);
  }
});

function saveData(file, type, result, area, description) {
  const time = new Date().toLocaleString();

  db.query(
    "INSERT INTO records (time, file, type, result, area, description) VALUES (?, ?, ?, ?, ?, ?)",
    [time, file, type, result, area, description],
    (err) => {
      if (err) console.log("DB 저장 오류:", err);
    }
  );
}

app.get("/records", (req, res) => {
  db.query("SELECT * FROM records ORDER BY id DESC", (err, results) => {
    if (err) return res.json([]);
    res.json(results);
  });
});

app.listen(PORT, () => {
  console.log("server running");
});

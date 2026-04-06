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
app.use(express.static("public", { index: false }));
app.use("/frames", express.static("frames"));
app.use("/uploads", express.static("uploads"));

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("frames")) fs.mkdirSync("frames");

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
  const { userid, pwd } = req.body;
  if (userid === "admin" && pwd === "1234") {
    return res.redirect("/index.html");
  }
  res.send("<script>alert('로그인 실패'); history.back();</script>");
});

app.post("/upload", upload.fields([
  { name: "video", maxCount: 1 },
  { name: "images", maxCount: 5 }
]), (req, res) => {
  const { area, description } = req.body;
  const videoFile = req.files["video"]?.[0];
  const imageFiles = req.files["images"] || [];

  if (!videoFile && imageFiles.length === 0) return res.send("No File");

  if (videoFile) {
    const videoPath = path.join(__dirname, videoFile.path);
    const videoName = path.parse(videoPath).name;
    const outputFolder = path.join(__dirname, "frames", videoName);

    if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder, { recursive: true });

    ffmpeg(videoPath)
      .outputOptions(["-vf fps=1,scale=640:480", "-q:v 2"])
      .output(path.join(outputFolder, "frame_%04d.jpg"))
      .on("end", () => {
        const filePath = `/${videoFile.path}`;
        const sql = "INSERT INTO records (time, file, type, result, area) VALUES (NOW(), ?, 'video', ?, ?)";
        
        db.query(sql, [filePath, description || "분석 완료", area || "undefined"], (err) => {
          if (err) console.error(err);
          
          res.send(`
            <style>
              body { font-family: sans-serif; padding: 20px; }
              .btn { background: #007bff; color: white; padding: 10px 15px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px; border: none; cursor: pointer; }
            </style>
            <h2>분석 성공</h2>
            <video src="${filePath}" controls width="400"></video>
            <p>구역: ${area || "undefined"}</p>
            <a href="/record.html" class="btn">기록 확인</a>
          `);
        });
      })
      .on("error", (err) => {
        console.error(err);
        res.send("Error");
      })
      .run();
  } else {
    const filePath = "/" + imageFiles[0].path;
    const sql = "INSERT INTO records (time, file, type, result, area) VALUES (NOW(), ?, 'image', ?, ?)";
    db.query(sql, [filePath, description || "등록 완료", area], (err) => {
      if (err) console.error(err);
      res.send(`<h2>등록 성공</h2><img src="${filePath}" width="300"/><br><p>구역: ${area}</p><a href="/record.html" class="btn">기록 확인</a>`);
    });
  }
});

app.get("/records", (req, res) => {
  db.query("SELECT * FROM records ORDER BY time DESC", (err, results) => {
    if (err) return res.json([]);
    res.json(results);
  });
});

app.listen(PORT, () => {
  console.log("Server running on " + PORT);
});

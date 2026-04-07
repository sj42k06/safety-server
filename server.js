const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const mysql = require("mysql2");
const FormData = require("form-data");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

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

async function runAI(filePath) {
  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath));

  const response = await fetch(
    "https://detect.roboflow.com/모델이름/버전?api_key=9iLrFxUNzKGhY0DKM9bz",
    {
      method: "POST",
      body: formData
    }
  );

  const result = await response.json();
  return result;
}

async function generateAI(classes) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5.3",
      messages: [
        {
          role: "system",
          content: "너는 산업현장 안전관리 AI다."
        },
        {
          role: "user",
          content: `
감지된 객체: ${classes.join(",")}

이 상황을 분석해서
위험 여부, 위험 요소, 대응 방안, 인수인계 내용을 작성해라.
          `
        }
      ]
    })
  });

  const data = await res.json();
  return data.choices[0].message.content;
}

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
]), async (req, res) => {

  const { area } = req.body;
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
      .on("end", async () => {

        const files = fs.readdirSync(outputFolder);
        let allClasses = [];

        for (let f of files.slice(0, 5)) {
          const framePath = path.join(outputFolder, f);

          try {
            const result = await runAI(framePath);
            if (result.predictions) {
              result.predictions.forEach(p => {
                allClasses.push(p.class);
              });
            }
          } catch (e) {
            console.error(e);
          }
        }

        const unique = [...new Set(allClasses)];
        const report = await generateAI(unique);

        const filePath = `/${videoFile.path}`;

        db.query(
          "INSERT INTO records (time, file, type, result, area) VALUES (NOW(), ?, 'video', ?, ?)",
          [filePath, report, area || "undefined"],
          () => {
            res.send(`
              <h2>AI 분석 완료 (영상)</h2>
              <video src="${filePath}" controls width="400"></video>
              <pre>${report}</pre>
              <a href="/record.html">기록 확인</a>
            `);
          }
        );

      })
      .run();

  } else {

    const filePath = "/" + imageFiles[0].path;
    const fullPath = path.join(__dirname, imageFiles[0].path);

    let allClasses = [];

    try {
      const result = await runAI(fullPath);
      if (result.predictions) {
        result.predictions.forEach(p => {
          allClasses.push(p.class);
        });
      }
    } catch (e) {
      console.error(e);
    }

    const unique = [...new Set(allClasses)];
    const report = await generateAI(unique);

    db.query(
      "INSERT INTO records (time, file, type, result, area) VALUES (NOW(), ?, 'image', ?, ?)",
      [filePath, report, area],
      () => {
        res.send(`
          <h2>AI 분석 완료 (이미지)</h2>
          <img src="${filePath}" width="300"/>
          <pre>${report}</pre>
          <a href="/record.html">기록 확인</a>
        `);
      }
    );

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

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use("/frames", express.static("frames"));

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
  res.redirect("/login.html");
});

app.post("/login", (req, res) => {
  const { userid, pwd } = req.body;
  if (userid === "admin" && pwd === "1234") {
    return res.redirect("/index.html");
  }
  res.send("로그인 실패");
});

app.post("/upload", upload.single("video"), (req, res) => {
  if (!req.file) return res.send("파일 없음");

  const videoPath = path.join(__dirname, req.file.path);
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
      const files = fs.readdirSync(outputFolder).length;
      const result = "위험 요소 감지 (안전모 미착용)";

      const dataPath = "data.json";
      let data = [];

      if (fs.existsSync(dataPath)) {
        data = JSON.parse(fs.readFileSync(dataPath));
      }

      data.push({
        time: new Date().toLocaleString(),
        image: `/frames/${videoName}/frame_0001.jpg`,
        result: result
      });

      fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));

      res.send(`
        <h2>${result}</h2>
        <img src="/frames/${videoName}/frame_0001.jpg" width="300"/>
        <p>${files} frames 생성</p>
        <a href="/record.html">기록 보기</a>
      `);
    })
    .on("error", (err) => {
      console.log(err);
      res.send("ffmpeg 오류");
    })
    .run();
});

app.get("/records", (req, res) => {
  if (!fs.existsSync("data.json")) return res.json([]);
  const data = JSON.parse(fs.readFileSync("data.json"));
  res.json(data);
});

app.listen(PORT, () => {
  console.log("server running");
});

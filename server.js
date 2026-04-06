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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.use(express.static("public"));
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

        const result = "영상 분석 완료";

        saveData(`/frames/${videoName}/frame_0001.jpg`, result);

        res.send(`
          <h2>${result}</h2>
          <img src="/frames/${videoName}/frame_0001.jpg" width="300"/>
          <br><br>
          <a href="/record.html">기록 보기</a>
        `);
      })
      .on("error", (err) => {
        console.log(err);
        res.send("ffmpeg 오류");
      })
      .run();

  } else if (imageFiles.length > 0) {

    const imagePath = "/" + imageFiles[0].path;

    const result = "이미지 등록 완료";

    saveData(imagePath, result);

    res.send(`
      <h2>${result}</h2>
      <img src="${imagePath}" width="300"/>
      <br><br>
      <a href="/record.html">기록 보기</a>
    `);
  }
});

function saveData(image, result) {
  const dataPath = "data.json";
  let data = [];

  if (fs.existsSync(dataPath)) {
    data = JSON.parse(fs.readFileSync(dataPath));
  }

  data.push({
    time: new Date().toLocaleString(),
    image: image,
    result: result
  });

  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

app.get("/records", (req, res) => {
  if (!fs.existsSync("data.json")) return res.json([]);
  const data = JSON.parse(fs.readFileSync("data.json"));
  res.json(data);
});

app.listen(PORT, () => {
  console.log("server running");
});

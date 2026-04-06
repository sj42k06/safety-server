const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use("/frames", express.static("frames"));
app.use("/uploads", express.static("uploads"));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
  const { id, pw } = req.body;

  if (id === "admin" && pw === "1234") {
    res.redirect("/upload.html");
  } else {
    res.send("아이디 또는 비밀번호 틀림");
  }
});

app.post("/upload", upload.single("video"), (req, res) => {
  const videoPath = req.file.path;
  const videoName = path.parse(req.file.filename).name;

  exec(`python3 frame_extractor.py ${videoPath}`, (err) => {
    if (err) {
      console.error(err);
      return res.send("python 실행 오류");
    }

    res.send(`
      <h2>완료</h2>
      <a href="/frames/${videoName}/frame_0.jpg">프레임 보기</a>
    `);
  });
});

app.listen(PORT, () => {
  console.log("server running on port " + PORT);
});

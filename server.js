const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

app.use("/frames", express.static(path.join(__dirname, "frames")));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "uploads/videos";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage: storage });

app.post("/upload", upload.single("video"), (req, res) => {
  const videoPath = req.file.path;
  const videoName = path.parse(req.file.filename).name;

  exec(`python3 frame_extractor.py ${videoPath}`, (err, stdout, stderr) => {
    if (err) {
      console.error(err);
      return res.send("Python 실행 실패");
    }
    res.send(`완료: /frames/${videoName}/frame_0.jpg`);
  });
});

app.listen(PORT, () => {
  console.log("server running on port " + PORT);
});

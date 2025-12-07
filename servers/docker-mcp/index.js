import express from "express";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import { exec } from "child_process";
import 'dotenv/config';

const app = express();
app.use(bodyParser.json());
app.use(cookieParser());

// Middleware: attach GitHub token from secure httpOnly cookie
app.use((req, res, next) => {
  req.githubToken = req.cookies.github_token || null;
  next();
});

app.get("/status", (req, res) => {
  res.json({ ok: true, service: "Docker MCP", status: "running" });
});

// 🐳 1️⃣ List running containers
app.post("/listContainers", (req, res) => {
  exec("docker ps --format '{{json .}}'", (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });

    const containers = stdout
      .trim()
      .split("\n")
      .filter(line => line.trim() !== "")
      .map(line => JSON.parse(line));

    res.json({ success: true, containers });
  });
});

// 🐳 2️⃣ Start a container
app.post("/startContainer", (req, res) => {
  const { image, name } = req.body;

  if (!image || !name) {
    return res.status(400).json({ error: "Image and name are required" });
  }

  // If you later need to authenticate with GitHub Registry:
  // const token = req.githubToken;
  // exec(`echo ${token} | docker login ghcr.io -u USERNAME --password-stdin`);

  exec(`docker run -d --name ${name} ${image}`, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });

    res.json({ success: true, containerId: stdout.trim() });
  });
});

app.listen(4002, () =>
  console.log("🐳 Docker MCP server running securely on port 4002")
);

import express from "express";
import bodyParser from "body-parser";
import { exec } from "child_process";
import 'dotenv/config';


const app = express();
app.use(bodyParser.json());


app.get("/status", (req, res) => {
  res.json({ ok: true, service: "Docker MCP", status: "running" });
});


// List running containers
app.post("/listContainers", (req, res) => {
  exec("docker ps --format '{{json .}}'", (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    const containers = stdout
      .trim()
      .split("\n")
      .map(line => JSON.parse(line));
    res.json(containers);
  });
});

app.post("/startContainer", (req, res) => {
  const { image, name } = req.body;
  exec(`docker run -d --name ${name} ${image}`, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ containerId: stdout.trim() });
  });
});

app.listen(4002, () => console.log("✅ Docker MCP server running on port 4002"));

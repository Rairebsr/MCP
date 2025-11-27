import express from "express";
import fetch from "node-fetch";
import { exec } from "child_process";
import bodyParser from "body-parser";
import util from "util";
import 'dotenv/config';

const app = express();
const execPromise = util.promisify(exec);
app.use(bodyParser.json());

const GITHUB_API = "https://api.github.com";

// 🧩 Middleware to validate GitHub token
app.use((req, res, next) => {
  if (req.method === "POST" && !req.body?.token) {
    return res.status(401).json({ error: "GitHub token missing" });
  }
  next();
});


app.get("/status", (req, res) => {
  res.json({ ok: true, service: "Git MCP", status: "running" });
});


// 🧭 1️⃣ List repositories of the authenticated user
// 🧭 1️⃣ List repositories of the authenticated user (Gemini-style response)
app.post("/listRepos", async (req, res) => {
  const { token } = req.body;
  try {
    const ghRes = await fetch(`${GITHUB_API}/user/repos`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    const repos = await ghRes.json();
    if (!Array.isArray(repos))
      throw new Error(repos.message || "Invalid GitHub response");

    // 🪶 Gemini-style structured formatting
    const formattedList = repos
      .map(
        (r, idx) =>
          `**${idx + 1}. ${r.name}**  
   🔗 [Repo URL](${r.html_url})  
   🕒 Updated: ${new Date(r.updated_at).toLocaleString()}  
   🔒 Private: ${r.private ? "Yes" : "No"}`
      )
      .join("\n\n");

    res.json({
      role: "assistant",
      content: [
        {
          type: "text",
          text: `Here are your repositories (${repos.length} total):\n\n${formattedList}`,
        },
      ],
      success: true,
    });
  } catch (err) {
    console.error("❌ listRepos failed:", err);
    res.status(500).json({
      role: "assistant",
      content: [
        {
          type: "text",
          text: `⚠️ Failed to list repositories: ${err.message}`,
        },
      ],
      success: false,
    });
  }
});

// 🧭 2️⃣ Create a new repository
app.post("/createRepo", async (req, res) => {
  const { token, name, description = "", privateRepo = false } = req.body;

  if (!name) return res.status(400).json({ error: "Repository name required" });

  try {
    const ghRes = await fetch(`${GITHUB_API}/user/repos`, {
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({
        name,
        description,
        private: privateRepo,
      }),
    });

    const data = await ghRes.json();

    if (!ghRes.ok) throw new Error(data.message || "Failed to create repository");

    res.json({
      success: true,
      message: `Repository '${name}' created successfully!`,
      repo: {
        name: data.name,
        url: data.html_url,
      },
    });
  } catch (err) {
    console.error("❌ createRepo failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🧭 3️⃣ Clone a repository (local)
app.post("/cloneRepo", async (req, res) => {
  const { repoUrl, directory = "./repos" } = req.body;

  if (!repoUrl) return res.status(400).json({ error: "Repository URL required" });

  try {
    console.log(`🚀 Cloning ${repoUrl} into ${directory}...`);
    const { stdout, stderr } = await execPromise(`git clone ${repoUrl} ${directory}`);

    res.json({
      success: true,
      message: `Repository cloned successfully into ${directory}.`,
      stdout,
      stderr,
    });
  } catch (err) {
    console.error("❌ cloneRepo failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🧭 4️⃣ Generic Git command executor (used by orchestrator for /git/exec)
app.post("/git/exec", async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: "Git command required" });

  try {
    console.log("⚙️ Running git command:", command);
    const { stdout, stderr } = await execPromise(`git ${command}`);
    res.json({ success: true, output: stdout || stderr });
  } catch (err) {
    console.error("❌ git exec failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Healthcheck for orchestrator
app.get("/status", (req, res) => {
  res.json({ ok: true, service: "Git MCP", status: "running" });
});

// 🚀 Start server
const PORT = 4001;
app.listen(PORT, () => console.log(`🧠 Git MCP server running on port ${PORT}`));

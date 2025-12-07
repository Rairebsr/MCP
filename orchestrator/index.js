import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";
import 'dotenv/config';
import { GoogleGenAI } from "@google/genai";
import cors from "cors";
import cookieParser from "cookie-parser";

const app = express();
app.use(cors({
    origin: "http://localhost:5173", // Only allows requests from your frontend URL
    methods: ["GET", "POST", "PUT", "DELETE"], // Allows necessary HTTP methods
    credentials: true // Important for cookies/authentication if you were using them
}));
app.use(cookieParser());

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

async function checkAvailableServers() {
  const servers = [];

  try {
    const gitRes = await fetch("http://localhost:4001/status");
    const gitJson = await gitRes.json();
    if (gitJson?.status === "running") servers.push("git");
  } catch (e) {
    console.warn("Git MCP not available:", e.message);
  }

  try {
    const dockerRes = await fetch("http://localhost:4002/status");
    const dockerJson = await dockerRes.json();
    if (dockerJson?.status === "running") servers.push("docker");
  } catch (e) {
    console.warn("Docker MCP not available:", e.message);
  }

  return servers;
}


app.get("/test", (req, res) => res.send("Server is running"));

// OAuth callback
app.get("/auth/callback", async (req, res) => {
  const code = req.query.code;
  console.log("Callback:", code);

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code
    })
  });

  const data = await tokenRes.json();
  const token = data.access_token;

  if (!token) return res.status(400).json({ error: "Bad code" });

  res.cookie("github_token", token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  res.status(200).send("OK");
});

app.get("/debug/cookies", (req, res) => {
  res.json(req.cookies);
});



// MCP Execute — forward to Git MCP Server
app.post("/mcp/execute", async (req, res) => {
  const { tool, args} = req.body; 

  const token = req.cookies.github_token;

  if (!token) return res.status(401).json({ error: "Not logged in" });

  try {
    let url, body;
    switch (tool) {
      case "listRepos":
        url = "http://localhost:4001/listRepos";
        body = { owner: args.owner, token };
        break;
      default:
        return res.status(400).json({ error: "Unknown tool" });
    }

    const result = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(r => r.json());

    res.json({ result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Execution failed" });
  }
});

function normalizeAction(action) {
  if (!action) return null;
  const a = action.toLowerCase().trim();

  // Exact known mappings from Gemini style → internal style
  if (a === "git.list_repos" || a === "list_repos") return "listRepos";
  if (a === "git.create_repo" || a === "create_repo") return "createRepo";
  if (a === "git.clone_repo" || a === "clone_repo") return "cloneRepo";

  if (a === "docker.run" || a === "docker_run") return "dockerRun";
  if (a === "docker.build" || a === "docker_build") return "dockerBuild";

  // Fallback: loose matching (in case Gemini invents variants)
  if (a.includes("list") && a.includes("repo")) return "listRepos";
  if (a.includes("create") && a.includes("repo")) return "createRepo";
  if (a.includes("clone") && a.includes("repo")) return "cloneRepo";
  if (a.includes("docker") && a.includes("run")) return "dockerRun";
  if (a.includes("docker") && a.includes("build")) return "dockerBuild";

  return action; // as-is (might still match a switch case)
}


// ---- LLM Orchestrator (Gemini 2.5 Flash) ----
app.post("/ask", async (req, res) => {
  console.log("Incoming request:", req.body);
  const { query } = req.body;

  const token = req.cookies.github_token;
  console.log("token is:", token);

  if (!token) {
    return res.status(401).json({ reply: "⚠️ Not logged in. Please click 'Login with GitHub' first." });
  }

  try {
    // 1️⃣ Check available MCP servers
    const availableServers = await checkAvailableServers(); // e.g. ['git', 'docker']
    console.log("🛰️ Available servers:", availableServers);

    // 2️⃣ Ask Gemini what to do
    const contextualQuery = `
You are an MCP Orchestrator.

Available servers: ${availableServers.join(", ") || "None"}.

User said: "${query}".

You MUST respond ONLY as valid JSON like:
{
  "action": "<actionName>",
  "parameters": { ... }
}

Use these actionName values (exactly):
- "listRepos"
- "createRepo"
- "cloneRepo"
- "dockerRun"
- "dockerBuild"
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ parts: [{ text: contextualQuery }] }],
      temperature: 0.2,
      candidateCount: 1,
    });

    console.log("🧠 Full Gemini response:", JSON.stringify(response, null, 2));

    // 3️⃣ Extract raw text and parse JSON
    const rawText = response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log("🧠 Raw Gemini text:", rawText);

    let geminiJSON;
    try {
      const match = rawText.match(/\{[\s\S]*\}/);
      geminiJSON = match ? JSON.parse(match[0]) : null;
    } catch (e) {
      console.warn("⚠️ Could not parse Gemini JSON, sending raw text.");
      return res.json({ reply: rawText });
    }

    console.log("🧩 Parsed Gemini JSON:", geminiJSON);
    // --- Normalize parameters Gemini gives --- //
if (geminiJSON.parameters) {
  
  // repoName → name
  if (geminiJSON.parameters.repoName && !geminiJSON.parameters.name) {
    geminiJSON.parameters.name = geminiJSON.parameters.repoName;
  }

  // repository → name
  if (geminiJSON.parameters.repository && !geminiJSON.parameters.name) {
    geminiJSON.parameters.name = geminiJSON.parameters.repository;
  }

  // projectName → name
  if (geminiJSON.parameters.projectName && !geminiJSON.parameters.name) {
    geminiJSON.parameters.name = geminiJSON.parameters.projectName;
  }

  // fallback: if user typed only single word, treat as repo name
  if (!geminiJSON.parameters.name && query.split(" ").length === 1) {
    geminiJSON.parameters.name = query.trim();
  }
}

console.log("🔧 Normalized parameters:", geminiJSON.parameters);


    if (!geminiJSON?.action) {
      // If Gemini didn't give an action, just show its reply
      return res.json({ reply: rawText });
    }

    // 🔁 Normalize the action name (fixes "git.list_repos" → "listRepos")
    const normalizedAction = normalizeAction(geminiJSON.action);
    console.log("🔧 Normalized action:", normalizedAction);

    // 4️⃣ Route action to MCP server
    let mcpRes;

    switch (normalizedAction) {
      case "listRepos":
        if (!availableServers.includes("git")) {
          throw new Error("Git server not available");
        }

        mcpRes = await fetch("http://localhost:4001/listRepos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        }).then((r) => r.json());
        break;

      case "createRepo":
        if (!availableServers.includes("git")) {
          throw new Error("Git server not available");
        }

        mcpRes = await fetch("http://localhost:4001/createRepo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, ...geminiJSON.parameters }),
        }).then((r) => r.json());
        break;

      case "cloneRepo":
        if (!availableServers.includes("git")) {
          throw new Error("Git server not available");
        }

        mcpRes = await fetch("http://localhost:4001/cloneRepo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...geminiJSON.parameters }),
        }).then((r) => r.json());
        break;

      case "dockerRun":
      case "dockerBuild":
        if (!availableServers.includes("docker")) {
          throw new Error("Docker server not available");
        }

        mcpRes = await fetch("http://localhost:4002/docker/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: normalizedAction, ...geminiJSON.parameters }),
        }).then((r) => r.json());
        break;

      default:
        // If it's some unknown action, return raw Gemini text
        return res.json({ reply: rawText });
    }

    console.log("📦 MCP Response:", mcpRes);

    // 5️⃣ Send CLEAN reply to frontend (not raw JSON)
    const cleanReply =
      mcpRes?.content?.[0]?.text ||      // our structured tool format
      mcpRes?.message ||                 // simple message
      JSON.stringify(mcpRes, null, 2);   // fall back (debug style)

    return res.json({ reply: cleanReply });

  } catch (err) {
    console.error("❌ Orchestrator failed:", err);
    return res.status(500).json({
      reply: `❌ Orchestrator failed: ${err.message}`,
    });
  }
});




app.listen(4000, () => console.log("🤖 Orchestrator running on port 4000"));

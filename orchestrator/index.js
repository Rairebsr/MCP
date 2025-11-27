import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";
import 'dotenv/config';
import { GoogleGenAI } from "@google/genai";
import cors from "cors";



const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(cors({
    origin: "http://localhost:5173", // Only allows requests from your frontend URL
    methods: ["GET", "POST", "PUT", "DELETE"], // Allows necessary HTTP methods
    credentials: true // Important for cookies/authentication if you were using them
}));

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
  if (!code) return res.status(400).send("No code provided");

  try {
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
    console.log(token);

    if (!token) {
  console.error("GitHub token exchange failed:", data);
  return res.status(400).json({ error: "Failed to retrieve GitHub token", details: data });
}

    res.redirect(`http://localhost:5173?token=${token}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// MCP Execute — forward to Git MCP Server
app.post("/mcp/execute", async (req, res) => {
  const { tool, args, token } = req.body; 

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

// ---- LLM Orchestrator (Gemini 2.5 Flash) ----
app.post("/ask", async (req, res) => {
  console.log("Incoming request:", req.body);
  const { query, token } = req.body;
  if (!token) return res.status(401).json({ error: "Not logged in" });

  try {
    // Step 1: Detect available servers
    const availableServers = await checkAvailableServers(); // ['git', 'docker']
    console.log("🛰️ Available servers:", availableServers);

    // Step 2: Ask Gemini for next action
    const contextualQuery = `
You are an MCP Orchestrator. 
Available servers: ${availableServers.join(", ") || "None"}.
User said: "${query}".
Respond ONLY in JSON format like:
{
  "action": "<actionName>",
  "parameters": { ... }
}
Where actionName can be: listRepos, createRepo, cloneRepo, dockerRun, dockerBuild, etc.
`;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ parts: [{ text: contextualQuery }] }],
      temperature: 0.7,
      candidateCount: 1,
    });

    console.log("🧠 Full Gemini response:", JSON.stringify(response, null, 2));

    // Step 3: Extract and parse JSON safely
    const rawText = response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let geminiJSON;
try {
  const match = rawText.match(/\{[\s\S]*\}/);
  geminiJSON = match ? JSON.parse(match[0]) : null;
} catch (e) {
  console.warn("⚠️ Could not parse Gemini JSON, sending raw text.");
  return res.json({ reply: rawText });
}

if (!geminiJSON?.action) {
  // fallback if action is missing
  return res.json({ reply: rawText });
}


    console.log("🧩 Parsed Gemini JSON:", geminiJSON);

    // Step 4: Route action to MCP server
    let mcpRes;
    switch (geminiJSON.action) {
      case "listRepos":
        if (!availableServers.includes("git")) throw new Error("Git server not available");
        mcpRes = await fetch("http://localhost:4001/listRepos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        }).then((r) => r.json());
        break;

      case "createRepo":
        if (!availableServers.includes("git")) throw new Error("Git server not available");
        mcpRes = await fetch("http://localhost:4001/createRepo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, ...geminiJSON.parameters }),
        }).then((r) => r.json());
        break;

      case "cloneRepo":
        if (!availableServers.includes("git")) throw new Error("Git server not available");
        mcpRes = await fetch("http://localhost:4001/cloneRepo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...geminiJSON.parameters }),
        }).then((r) => r.json());
        break;

      case "dockerRun":
      case "dockerBuild":
        if (!availableServers.includes("docker")) throw new Error("Docker server not available");
        mcpRes = await fetch(`http://localhost:4002/docker/exec`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: geminiJSON.action, ...geminiJSON.parameters }),
        }).then((r) => r.json());
        break;

      default:
        // fallback: send Gemini text as reply
        return res.json({ reply: rawText });
    }

    // Step 5: Send MCP response to frontend
    res.json({ reply: JSON.stringify(mcpRes, null, 2) });

  } catch (err) {
    console.error("❌ Orchestrator failed:", err);
    res.status(500).json({ error: "Orchestrator failed", details: err.message });
  }
});




app.listen(4000, () => console.log("🤖 Orchestrator running on port 4000"));

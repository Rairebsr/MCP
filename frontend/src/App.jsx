import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";


const App = () => {
  const GITHUB_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID;
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState([]);
  const [mcServers, setMcServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState(null);
  const [tools, setTools] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef(null);
  const [user, setUser] = useState(null);

useEffect(() => {
  console.log("[auth] useEffect mount; url:", window.location.href);
  const url = new URL(window.location.href);

  const authed = url.searchParams.get("authed");
  if (authed) {
    url.searchParams.delete("authed");
    window.history.replaceState({}, "", url.pathname + url.search);
    fetchAuthStatus();
    return;
  }

  const code = url.searchParams.get("code");
  if (code && !window.__handledAuth) {
    window.__handledAuth = true;
    fetch(`http://localhost:4000/auth/callback?code=${code}`, { method: "GET", credentials: "include" })
      .finally(async () => {
        url.searchParams.delete("code");
        window.history.replaceState({}, "", url.pathname);
        await fetchAuthStatus();
      });
    return;
  }

  fetchAuthStatus();
}, []);


const fetchAuthStatus = async () => {
  console.log("[auth] fetchAuthStatus: start");
  try {
    const res = await fetch("http://localhost:4000/auth/status", { credentials: "include" });
    console.log("[auth] /auth/status response status:", res.status);
    const data = await res.json().catch(e => {
      console.error("[auth] failed to parse /auth/status json", e);
      return null;
    });
    console.log("[auth] /auth/status payload:", data);
    if (data && data.loggedIn) {
      setUser({ login: data.login, avatar_url: data.avatar_url, name: data.name });
      console.log("[auth] setUser ->", data.login);
    } else {
      setUser(null);
      console.log("[auth] not logged in (set user null)");
    }
  } catch (err) {
    console.error("[auth] fetchAuthStatus error", err);
    setUser(null);
  }
};


  useEffect(() => {
    console.log("[auth] useEffect mount; url:", window.location.href);
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");

    if (code && !window.__handledAuth) {
      window.__handledAuth = true;

      // IMPORTANT: call the backend callback endpoint that exchanges code -> token
      // your backend route is /auth/callback (not /api/auth/callback)
      fetch(`http://localhost:4000/auth/callback?code=${code}`, 
        { method: "GET", credentials: "include" })

        .finally(async () => {
          // remove code from URL and refresh auth status
          url.searchParams.delete("code");
          window.history.replaceState({}, "", url.pathname);
          await fetchAuthStatus();
        });
    } else {
      // normal mount: check if already logged in
      fetchAuthStatus();
    }
  }, []);


const callOrchestrator = async (query, token) => {
  const response = await fetch("/api/ask", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query })
});

  const data = await response.json();

  if (!response.ok) {
    // Return the error message from the backend
    return data.message || data.error || "Failed to get response from orchestrator";
  }

  return data.reply || "No response";
};



  // Enhanced mock data for MCP servers
  const mockServers = [
    {
      id: 1,
      name: 'Github server',
      status: 'online',
      description: 'git tool',
      icon: '🗄️',
      tools: [
        { name: 'create-repo', description: 'Get current weather for location' },
        { name: 'pull', description: 'Get 5-day weather forecast' },
        { name: 'list-repo', description: 'Search for locations' }
      ]
    },
    {
      id: 2,
      name: 'Docker server',
      status: 'online',
      description: 'Docker operation',
      icon: '',
      tools: [
        { name: 'create-image', description: 'Execute SQL queries' },
        { name: 'deploy', description: 'Update database records' }
      ]
    }
  ];

  useEffect(() => {
    // Simulate loading MCP servers
    setMcServers(mockServers);
    // Add welcome message
    setMessages([
      {
        id: 1,
        type: 'system',
        content: 'Welcome to MCP Orchestrator! I can help you interact with various MCP servers. Select a server to see available tools.',
        timestamp: new Date()
      }
    ]);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleInputChange = (e) => {
    setInputValue(e.target.value);
  };

  const handleSubmit = async (e) => {
  e.preventDefault();
  if (!inputValue.trim()) return;

  const userMessage = {
    id: Date.now(),
    type: 'user',
    content: inputValue,
    timestamp: new Date()
  };

  setMessages(prev => [...prev, userMessage]);
  setInputValue('');
  setIsProcessing(true);

  try {
    const response = await callOrchestrator(inputValue);

    const aiMessage = {
      id: Date.now() + 1,
      type: response.toLowerCase().includes("not logged in") ? 'error' : 'assistant',
      content: response,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, aiMessage]);
  } catch (error) {
    const errorMessage = {
      id: Date.now() + 1,
      type: 'error',
      content: 'Sorry, there was an error processing your request.',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, errorMessage]);
  } finally {
    setIsProcessing(false);
  }
};


  const handleServerClick = (server) => {
    setSelectedServer(server);
    setTools(server.tools);
    
    // Add server selection message
    const serverMessage = {
      id: Date.now(),
      type: 'system',
      content: `Selected ${server.name}: ${server.description}`,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, serverMessage]);
  };

  const handleToolClick = (tool) => {
    const toolMessage = {
      id: Date.now(),
      type: 'system',
      content: `Tool selected: ${tool.name} - ${tool.description}`,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, toolMessage]);
    setInputValue(`Use ${tool.name} to `);
  };

  // Performance metrics data
  const performanceData = {
    responseTimes: [120, 95, 150, 80, 110, 130],
    successRate: 98.5,
    activeConnections: 4
  };

  const getMessageStyles = (type) => {
    const baseStyles = "rounded-2xl px-4 py-3 max-w-[80%]";
    switch (type) {
      case 'user':
        return `${baseStyles} bg-blue-600 text-white ml-auto`;
      case 'assistant':
        return `${baseStyles} bg-gray-700 text-white`;
      case 'system':
        return `${baseStyles} bg-gray-800 text-gray-300 border border-dashed border-gray-600`;
      case 'error':
        return `${baseStyles} bg-red-600 text-white`;
      default:
        return `${baseStyles} bg-gray-700 text-white`;
    }
  };

  return (
    <div className="flex h-screen bg-gray-900 text-white">
      {/* Left Panel - MCP Servers */}
      <div className="w-80 bg-gray-800 border-r border-gray-700 flex flex-col">
        <div className="p-6 border-b border-gray-700">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">MCP Servers</h2>
            <span className="bg-blue-600 text-white px-2 py-1 rounded-full text-xs font-medium">
              {performanceData.activeConnections} Active
            </span>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-3">
            {mcServers.map(server => (
              <div
                key={server.id}
                className={`p-4 rounded-xl cursor-pointer transition-all duration-200 border-2 ${
                  selectedServer?.id === server.id
                    ? 'bg-gray-700 border-blue-500 shadow-lg shadow-blue-500/20'
                    : 'bg-gray-750 border-transparent hover:bg-gray-700 hover:border-gray-600'
                } ${server.status === 'offline' ? 'opacity-50' : ''}`}
                onClick={() => handleServerClick(server)}
              >
                <div className="flex items-start space-x-3">
                  <div className="text-2xl">{server.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-medium text-sm truncate">{server.name}</span>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                        server.status === 'online' 
                          ? 'bg-green-900 text-green-300' 
                          : 'bg-red-900 text-red-300'
                      }`}>
                        ● {server.status}
                      </span>
                    </div>
                    <p className="text-gray-400 text-xs leading-relaxed">
                      {server.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tools Section */}
        {selectedServer && (
          <div className="border-t border-gray-700 p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold">Available Tools</h3>
              <span className="bg-gray-700 text-gray-300 px-2 py-1 rounded-full text-xs">
                {tools.length} tools
              </span>
            </div>
            <div className="space-y-2">
              {tools.map((tool, index) => (
                <div
                  key={index}
                  className="p-3 bg-gray-750 rounded-lg cursor-pointer transition-all duration-200 hover:bg-gray-700 hover:border-gray-500 border-2 border-transparent"
                  onClick={() => handleToolClick(tool)}
                >
                  <div className="flex items-start space-x-3">
                    <div className="text-lg">⚙️</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono font-semibold text-sm mb-1">
                        {tool.name}
                      </div>
                      <div className="text-gray-400 text-xs leading-relaxed">
                        {tool.description}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col bg-gray-900">
        {/* Chat/Messages Area */}
        <div className="flex-1 flex flex-col">
          <div className="p-6 border-b border-gray-700">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-500 to-green-500 bg-clip-text text-transparent">
                MCP Orchestrator
              </h2>
               {/* AUTH AREA */}
              <div className="flex items-center space-x-3">
                {user ? (
                  <>
                    <div className="flex items-center space-x-2">
                      {user.avatar_url && (
                        <img
                          src={user.avatar_url}
                          alt="avatar"
                          className="w-8 h-8 rounded-full"
                        />
                      )}

                      <div className="text-sm text-right">
                        <div className="font-medium">Logged in as</div>
                        <div className="truncate max-w-[10rem]">{user.login || user.name}</div>
                      </div>
                    </div>

                    <button
                      onClick={async () => {
                        await fetch("http://localhost:4000/auth/logout", { method: "POST", credentials: "include" });
                        await fetchAuthStatus();
                      }}
                      className="bg-red-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition"
                    >
                      Logout
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      window.location.href = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=repo,user`;
                    }}
                    className="bg-orange-500 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-orange-600 transition"
                  >
                    Login with GitHub
                  </button>
                )}
  </div>
  {/* end AUTH AREA */}
</div>
          </div>
          
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6" style={{ maxHeight: 'calc(100vh - 200px)' }}>
              {messages.map((message) => (
                <div key={message.id} className="flex flex-col mb-2">
                  <div className={getMessageStyles(message.type)}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                  <div
                    className={`text-xs text-gray-500 mt-1 ${
                      message.type === 'user' ? 'text-right mr-2' : 'ml-2'
                    }`}
                  >
                    {message.timestamp.toLocaleTimeString()}
                  </div>
                </div>
              ))}
              {isProcessing && (
                <div className="flex space-x-2 items-center">
                  <div className="bg-gray-700 rounded-2xl px-4 py-3">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

          </div>
        </div>

        {/* Input Area - Fixed at Bottom */}
        <div className="border-t border-gray-700 bg-gray-900 p-6">
          <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
            <div className="flex space-x-4 items-center">
              <input
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                placeholder={
                  selectedServer 
                    ? `Ask something or use tools from ${selectedServer.name}...` 
                    : "Select a server and ask me anything..."
                }
                className="flex-1 bg-gray-800 border-2 border-gray-700 rounded-2xl px-6 py-4 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all duration-200"
                disabled={isProcessing}
              />
              <button
                type="submit"
                disabled={isProcessing || !inputValue.trim()}
                className="bg-blue-600 text-white rounded-2xl p-4 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all duration-200 hover:scale-105 disabled:hover:scale-100 w-14 h-14 flex items-center justify-center"
              >
                {isProcessing ? '⏳' : '➤'}
              </button>
            </div>
            {selectedServer && (
              <div className="text-sm text-gray-400 mt-2 ml-2">
                Active: {selectedServer.icon} {selectedServer.name}
              </div>
            )}
          </form>
        </div>
      </div>

      {/* Right Panel - Analytics */}
      <div className="w-80 bg-gray-800 border-l border-gray-700 overflow-y-auto">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold">Analytics</h2>
        </div>
        
        {/* Performance Metrics */}
        <div className="p-6 border-b border-gray-700">
          <h3 className="font-semibold mb-4">Performance</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-750 p-4 rounded-xl border border-gray-600 text-center">
              <div className="text-2xl font-bold text-green-400">{performanceData.successRate}%</div>
              <div className="text-gray-400 text-sm mt-1">Success Rate</div>
            </div>
            <div className="bg-gray-750 p-4 rounded-xl border border-gray-600 text-center">
              <div className="text-2xl font-bold text-blue-400">
                {Math.round(performanceData.responseTimes.reduce((a, b) => a + b) / performanceData.responseTimes.length)}ms
              </div>
              <div className="text-gray-400 text-sm mt-1">Avg Response</div>
            </div>
          </div>
        </div>

        {/* Response Time Chart */}
        <div className="p-6 border-b border-gray-700">
          <h3 className="font-semibold mb-4">Response Times</h3>
          <div className="flex items-end justify-between h-32 space-x-2">
            {performanceData.responseTimes.map((time, index) => (
              <div key={index} className="flex flex-col items-center flex-1">
                <div className="w-full bg-gray-700 rounded-t-lg relative group" style={{ height: '100px' }}>
                  <div
                    className="bg-gradient-to-t from-blue-500 to-green-500 rounded-t-lg w-full transition-all duration-300"
                    style={{ height: `${(time / 200) * 100}%` }}
                  >
                    <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                      {time}ms
                    </div>
                  </div>
                </div>
                <div className="text-gray-400 text-xs mt-2">Req {index + 1}</div>
              </div>
            ))}
          </div>
        </div>

        {/* System Status */}
        <div className="p-6">
          <h3 className="font-semibold mb-4">System Status</h3>
          <div className="space-y-3">
            <div className="flex items-center space-x-3 p-3 bg-gray-750 rounded-lg border border-gray-600">
              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
              <span>LLM Orchestrator</span>
            </div>
            <div className="flex items-center space-x-3 p-3 bg-gray-750 rounded-lg border border-gray-600">
              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
              <span>API Gateway</span>
            </div>
            <div className="flex items-center space-x-3 p-3 bg-gray-750 rounded-lg border border-gray-600">
              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
              <span>Database</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
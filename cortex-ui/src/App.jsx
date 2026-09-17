import { useState, useEffect, useRef } from "react";
import axios from "axios";
import {
  FileText,
  Trash2,
  BrainCircuit,
  Link,
  Image as ImageIcon,
  Plus,
  Send,
  MessageSquare,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

const API_BASE = "http://127.0.0.1:8000";

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState("");
  const [activeSource, setActiveSource] = useState(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // 1. Initialize messages from localStorage to save search/chat history
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem("cortex_chat_history");
    return saved ? JSON.parse(saved) : [];
  });

  const [inputMessage, setInputMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  const messagesEndRef = useRef(null);

  // 2. Save messages to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem("cortex_chat_history", JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const fetchDocuments = async () => {
    try {
      const res = await axios.get(`${API_BASE}/documents`);
      setDocuments(res.data.documents);
    } catch (error) {
      console.error("Failed to fetch documents:", error);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const getSourceIcon = (type) => {
    if (type === "url")
      return <Link size={16} className='text-blue-400 flex-shrink-0' />;
    if (type === "image")
      return <ImageIcon size={16} className='text-purple-400 flex-shrink-0' />;
    return <FileText size={16} className='text-emerald-400 flex-shrink-0' />;
  };

  const handleAddUrl = async () => {
    const url = prompt("Enter the URL to ingest:");
    if (!url) return;
    setIsProcessing(true);
    setProcessStatus("Fetching and reading URL...");
    try {
      const res = await axios.post(`${API_BASE}/sources/url`, { url });
      await fetchDocuments();
      setActiveSource(res.data);
    } catch (error) {
      alert(error.response?.data?.detail || "Failed to process URL.");
    } finally {
      setIsProcessing(false);
      setShowAddMenu(false);
      setProcessStatus("");
    }
  };

  const handleFileUpload = async (e, endpoint) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append("file", file);

    setIsProcessing(true);
    setProcessStatus(`Processing ${file.name}...`);
    try {
      const res = await axios.post(`${API_BASE}/${endpoint}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await fetchDocuments();
      setActiveSource(res.data);
    } catch (error) {
      alert(
        error.response?.data?.detail ||
          "Upload failed. (If this was an image, you may have hit Gemini's rate limit).",
      );
    } finally {
      setIsProcessing(false);
      setShowAddMenu(false);
      setProcessStatus("");
      e.target.value = "";
    }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API_BASE}/documents/${id}`);
      if (activeSource?.document_id === id) setActiveSource(null);
      fetchDocuments();
    } catch (error) {
      console.error("Delete failed:", error);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    const userMsg = inputMessage.trim();
    setInputMessage("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setIsTyping(true);

    try {
      const res = await axios.post(`${API_BASE}/chat`, {
        question: userMsg,
        filename: activeSource ? activeSource.filename : null,
        session_id: "default-session",
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.data.answer },
      ]);
    } catch (error) {
      const detail = error.response?.data?.detail;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: detail || "Error connecting to AI backend.",
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  // 3. Clear History Function
  const clearHistory = () => {
    if (window.confirm("Are you sure you want to clear your chat history?")) {
      setMessages([]);
      localStorage.removeItem("cortex_chat_history");
    }
  };

  return (
    <div className='flex h-screen bg-[#0B0F19] text-slate-200 font-sans selection:bg-emerald-500/30'>
      {/* SIDEBAR */}
      <div className='w-80 bg-slate-950/50 border-r border-slate-800/60 flex flex-col z-20 backdrop-blur-xl shadow-xl'>
        <div className='p-6 flex items-center gap-3'>
          <div className='p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20 shadow-inner'>
            <BrainCircuit className='text-emerald-400' size={26} />
          </div>
          <h1 className='text-xl font-bold tracking-wide bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent'>
            Cortex
          </h1>
        </div>

        <div className='px-4 flex-grow overflow-y-auto custom-scrollbar pb-6'>
          <h2 className='text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-4 px-2'>
            Knowledge Base
          </h2>
          {documents.length === 0 ? (
            <div className='text-sm text-slate-500 italic px-2 bg-slate-900/50 p-4 rounded-xl border border-slate-800/50 text-center'>
              No sources added yet.
            </div>
          ) : (
            <ul className='space-y-2'>
              {documents.map((doc) => (
                <li
                  key={doc.document_id}
                  onClick={() => setActiveSource(doc)}
                  className={`group flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all duration-200 ${
                    activeSource?.document_id === doc.document_id
                      ? "bg-slate-800/80 border-emerald-500/50 shadow-md shadow-emerald-900/10"
                      : "bg-slate-900/40 border-slate-800/50 hover:border-slate-700 hover:bg-slate-800/60"
                  }`}
                >
                  <div className='flex items-center gap-3 overflow-hidden'>
                    {getSourceIcon(doc.source_type)}
                    <span className='text-sm truncate font-medium text-slate-300 group-hover:text-white transition-colors'>
                      {doc.filename}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(doc.document_id);
                    }}
                    className='text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all bg-slate-950 p-1.5 rounded-md hover:bg-red-500/10'
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className='p-4 relative bg-slate-950/80 border-t border-slate-800/60'>
          {isProcessing && (
            <div className='mb-3 text-xs text-emerald-400 animate-pulse text-center font-medium tracking-wide flex justify-center items-center gap-2'>
              <div className='w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin'></div>
              {processStatus}
            </div>
          )}

          {showAddMenu && !isProcessing && (
            <div className='absolute bottom-[4.5rem] left-4 right-4 bg-slate-900 border border-slate-700 rounded-xl p-1.5 flex flex-col gap-1 shadow-2xl z-50 backdrop-blur-md'>
              <label className='flex items-center gap-3 p-3 hover:bg-slate-800 rounded-lg cursor-pointer text-sm font-medium transition-colors text-slate-300 hover:text-white'>
                <FileText size={16} className='text-emerald-400' /> Add Document
                <input
                  type='file'
                  className='hidden'
                  accept='.pdf,.md,.txt'
                  onChange={(e) => handleFileUpload(e, "documents/upload")}
                />
              </label>
              <label className='flex items-center gap-3 p-3 hover:bg-slate-800 rounded-lg cursor-pointer text-sm font-medium transition-colors text-slate-300 hover:text-white'>
                <ImageIcon size={16} className='text-purple-400' /> Add Image
                <input
                  type='file'
                  className='hidden'
                  accept='.jpg,.jpeg,.png,.webp'
                  onChange={(e) => handleFileUpload(e, "images/upload")}
                />
              </label>
              <button
                onClick={handleAddUrl}
                className='flex items-center gap-3 p-3 hover:bg-slate-800 rounded-lg text-left text-sm font-medium transition-colors text-slate-300 hover:text-white'
              >
                <Link size={16} className='text-blue-400' /> Add Link
              </button>
            </div>
          )}

          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            disabled={isProcessing}
            className={`flex items-center justify-center gap-2 w-full p-3.5 rounded-xl transition-all font-medium text-sm shadow-lg active:scale-[0.98] ${
              isProcessing
                ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
                : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white border border-emerald-400/20 shadow-emerald-900/20"
            }`}
          >
            <Plus
              size={18}
              className={
                showAddMenu
                  ? "rotate-45 transition-transform duration-300"
                  : "transition-transform duration-300"
              }
            />
            {isProcessing ? "Working..." : "Add Source"}
          </button>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className='flex-1 flex flex-col relative'>
        {/* Top Context & Summary Panel */}
        {activeSource ? (
          <div className='p-6 border-b border-slate-800/60 bg-slate-950/40 backdrop-blur-md shadow-sm shrink-0 z-10'>
            <div className='flex items-center justify-between mb-4'>
              <div className='flex items-center gap-3 text-emerald-400 font-semibold text-lg'>
                {getSourceIcon(activeSource.source_type)}
                <span>{activeSource.title || activeSource.filename}</span>
              </div>
            </div>

            {activeSource.summary && (
              <div className='bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 text-sm max-h-[30vh] overflow-y-auto custom-scrollbar shadow-inner'>
                <h3 className='text-slate-300 font-bold mb-2 uppercase tracking-wider text-xs'>
                  Short Summary
                </h3>
                <p className='text-slate-400 mb-5 leading-relaxed'>
                  {activeSource.summary}
                </p>

                {Array.isArray(activeSource.key_points) &&
                  activeSource.key_points.length > 0 && (
                    <>
                      <h3 className='text-slate-300 font-bold mb-2 uppercase tracking-wider text-xs mt-4'>
                        Key Points
                      </h3>
                      <ul className='list-disc list-inside text-slate-400 mb-5 space-y-2 leading-relaxed marker:text-emerald-500'>
                        {activeSource.key_points.map((pt, i) => (
                          <li key={i}>{pt}</li>
                        ))}
                      </ul>
                    </>
                  )}

                {activeSource.easy_explanation && (
                  <>
                    <h3 className='text-slate-300 font-bold mb-2 uppercase tracking-wider text-xs mt-4'>
                      Easy Explanation
                    </h3>
                    <p className='text-slate-400 leading-relaxed bg-slate-800/50 p-4 rounded-lg border border-slate-700/50 italic'>
                      {activeSource.easy_explanation}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className='px-6 py-4 border-b border-slate-800/60 bg-slate-950/40 backdrop-blur-md text-slate-400 text-sm shrink-0 flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <BrainCircuit size={16} className='text-emerald-500' />
              <span>Global knowledge chat is active.</span>
            </div>
            {messages.length > 0 && (
              <button
                onClick={clearHistory}
                className='text-xs font-medium bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-400 px-3 py-1.5 rounded-lg border border-slate-700 hover:border-red-500/30 transition-all flex items-center gap-2'
              >
                <Trash2 size={12} /> Clear History
              </button>
            )}
          </div>
        )}

        {/* Chat Message Window */}
        <div className='flex-1 overflow-y-auto p-6 md:p-8 space-y-8 pb-36 custom-scrollbar'>
          {messages.length === 0 ? (
            <div className='h-full flex flex-col items-center justify-center text-slate-500 opacity-80'>
              <div className='p-6 bg-slate-900/50 rounded-3xl border border-slate-800 shadow-xl mb-6'>
                <MessageSquare
                  size={48}
                  className='opacity-40 text-emerald-500'
                />
              </div>
              <p className='text-lg font-medium text-slate-300'>
                How can I help you today?
              </p>
              <p className='text-sm mt-2'>
                Ask a question about your documents to get started.
              </p>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                } animate-in slide-in-from-bottom-2 duration-300`}
              >
                <div
                  className={`max-w-[80%] md:max-w-[70%] p-5 rounded-2xl leading-relaxed shadow-sm ${
                    msg.role === "user"
                      ? "bg-gradient-to-br from-emerald-600 to-teal-700 text-white rounded-br-sm shadow-emerald-900/20"
                      : "bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-sm"
                  }`}
                >
                  {msg.role === "user" ? (
                    msg.content
                  ) : (
                    <div className='prose prose-invert prose-emerald max-w-none prose-p:leading-relaxed prose-pre:bg-slate-950 prose-pre:border prose-pre:border-slate-800'>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {isTyping && (
            <div className='flex justify-start animate-in fade-in'>
              <div className='bg-slate-900 border border-slate-800 p-5 rounded-2xl rounded-bl-sm shadow-sm flex items-center gap-2'>
                <div className='w-2 h-2 bg-emerald-500 rounded-full animate-bounce'></div>
                <div
                  className='w-2 h-2 bg-emerald-500 rounded-full animate-bounce'
                  style={{ animationDelay: "0.15s" }}
                ></div>
                <div
                  className='w-2 h-2 bg-emerald-500 rounded-full animate-bounce'
                  style={{ animationDelay: "0.3s" }}
                ></div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} className='h-4' />
        </div>

        {/* Chat Input form */}
        <div className='absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#0B0F19] via-[#0B0F19]/90 to-transparent pt-12'>
          <form
            onSubmit={handleSendMessage}
            className='flex gap-3 max-w-4xl mx-auto relative group'
          >
            <input
              type='text'
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder={
                activeSource
                  ? `Ask about ${activeSource.filename}...`
                  : "Ask a general question..."
              }
              className='flex-1 bg-slate-900/90 backdrop-blur-xl border border-slate-700 rounded-2xl px-6 py-4 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-xl text-slate-200 placeholder:text-slate-500'
            />
            <button
              type='submit'
              disabled={isTyping || !inputMessage.trim()}
              className='absolute right-2 top-2 bottom-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white p-3 rounded-xl transition-all shadow-md active:scale-95 disabled:active:scale-100 flex items-center justify-center aspect-square'
            >
              <Send
                size={20}
                className={
                  inputMessage.trim() && !isTyping
                    ? "translate-x-0.5 -translate-y-0.5 transition-transform"
                    : ""
                }
              />
            </button>
          </form>
        </div>
      </div>

      {/* Global Styles for Custom Scrollbar & Tailwind Prose adjustments */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #334155;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: #475569;
        }
      `,
        }}
      />
    </div>
  );
}

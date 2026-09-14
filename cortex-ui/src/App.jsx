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
} from "lucide-react";
import ReactMarkdown from "react-markdown";

const API_BASE = "http://127.0.0.1:8000";

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState("");
  const [activeSource, setActiveSource] = useState(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      return <Link size={16} className='text-blue-500 flex-shrink-0' />;
    if (type === "image")
      return <ImageIcon size={16} className='text-purple-500 flex-shrink-0' />;
    return <FileText size={16} className='text-emerald-500 flex-shrink-0' />;
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
          "Upload failed. (If this was an image, you may have hit Groq's 429 rate limit).",
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
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error connecting to AI backend." },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className='flex h-screen bg-gray-900 text-gray-100 font-sans'>
      {/* SIDEBAR */}
      <div className='w-80 bg-gray-950 border-r border-gray-800 flex flex-col z-20'>
        <div className='p-5 border-b border-gray-800 flex items-center gap-3'>
          <BrainCircuit className='text-emerald-500' size={28} />
          <h1 className='text-xl font-bold tracking-wide'>Cortex UI</h1>
        </div>

        <div className='p-4 flex-grow overflow-y-auto'>
          <h2 className='text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4'>
            Knowledge Base
          </h2>
          {documents.length === 0 ? (
            <p className='text-sm text-gray-500 italic'>
              No sources added yet.
            </p>
          ) : (
            <ul className='space-y-2'>
              {documents.map((doc) => (
                <li
                  key={doc.document_id}
                  onClick={() => setActiveSource(doc)}
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${activeSource?.document_id === doc.document_id ? "bg-gray-800 border-emerald-500" : "bg-gray-900 border-gray-800 hover:border-gray-700"}`}
                >
                  <div className='flex items-center gap-3 overflow-hidden'>
                    {getSourceIcon(doc.source_type)}
                    <span className='text-sm truncate'>{doc.filename}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(doc.document_id);
                    }}
                    className='text-gray-500 hover:text-red-400'
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className='p-4 border-t border-gray-800 relative'>
          {isProcessing && (
            <div className='mb-3 text-xs text-emerald-400 animate-pulse text-center font-medium tracking-wide'>
              {processStatus}
            </div>
          )}

          {showAddMenu && !isProcessing && (
            <div className='absolute bottom-16 left-4 right-4 bg-gray-800 border border-gray-700 rounded-lg p-2 flex flex-col gap-1 shadow-xl z-50'>
              <label className='flex items-center gap-3 p-3 hover:bg-gray-700 rounded cursor-pointer text-sm font-medium transition-colors'>
                <FileText size={16} className='text-emerald-400' /> Add PDF /
                Document
                <input
                  type='file'
                  className='hidden'
                  accept='.pdf,.md,.txt'
                  onChange={(e) => handleFileUpload(e, "documents/upload")}
                />
              </label>
              <label className='flex items-center gap-3 p-3 hover:bg-gray-700 rounded cursor-pointer text-sm font-medium transition-colors'>
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
                className='flex items-center gap-3 p-3 hover:bg-gray-700 rounded text-left text-sm font-medium transition-colors'
              >
                <Link size={16} className='text-blue-400' /> Add Link
              </button>
            </div>
          )}

          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            disabled={isProcessing}
            className={`flex items-center justify-center gap-2 w-full p-3 rounded-lg transition-colors font-medium text-sm ${isProcessing ? "bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700" : "bg-emerald-600 hover:bg-emerald-500 text-white"}`}
          >
            <Plus
              size={18}
              className={
                showAddMenu
                  ? "rotate-45 transition-transform"
                  : "transition-transform"
              }
            />
            {isProcessing ? "Working..." : "Add Source"}
          </button>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className='flex-1 flex flex-col bg-gray-900 relative'>
        {/* Top Context & Summary Panel */}
        {activeSource ? (
          <div className='p-5 border-b border-gray-800 bg-gray-950/50 shadow-sm shrink-0 z-10'>
            <div className='flex items-center gap-2 text-emerald-400 font-semibold mb-3 text-lg'>
              {getSourceIcon(activeSource.source_type)}
              <span>{activeSource.title || activeSource.filename}</span>
            </div>

            {activeSource.summary && (
              <div className='bg-gray-900 border border-gray-800 rounded-lg p-5 text-sm max-h-60 overflow-y-auto custom-scrollbar'>
                <h3 className='text-gray-200 font-bold mb-2 uppercase tracking-wider text-xs'>
                  Short Summary
                </h3>
                <p className='text-gray-400 mb-5 leading-relaxed'>
                  {activeSource.summary}
                </p>

                {/* BULLETPROOF ARRAY CHECK */}
                {Array.isArray(activeSource.key_points) &&
                  activeSource.key_points.length > 0 && (
                    <>
                      <h3 className='text-gray-200 font-bold mb-2 uppercase tracking-wider text-xs'>
                        Key Points
                      </h3>
                      <ul className='list-disc list-inside text-gray-400 mb-5 space-y-1.5 leading-relaxed'>
                        {activeSource.key_points.map((pt, i) => (
                          <li key={i}>{pt}</li>
                        ))}
                      </ul>
                    </>
                  )}

                {activeSource.easy_explanation && (
                  <>
                    <h3 className='text-gray-200 font-bold mb-2 uppercase tracking-wider text-xs'>
                      Easy Explanation
                    </h3>
                    <p className='text-gray-400 leading-relaxed bg-gray-800/50 p-3 rounded border border-gray-700/50 italic'>
                      {activeSource.easy_explanation}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className='p-4 border-b border-gray-800 bg-gray-950/50 text-center text-gray-500 text-sm shrink-0'>
            No active source selected. Global knowledge chat is active.
          </div>
        )}

        {/* Chat Message Window */}
        <div className='flex-1 overflow-y-auto p-6 space-y-6 pb-32'>
          {messages.length === 0 ? (
            <div className='h-full flex flex-col items-center justify-center text-gray-500 opacity-60'>
              <BrainCircuit size={72} className='mb-6 opacity-20' />
              <p className='text-lg'>
                Ask Cortex a question about your knowledge base...
              </p>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[75%] p-4 rounded-2xl ${
                    msg.role === "user"
                      ? "bg-emerald-600 text-white rounded-br-none"
                      : "bg-gray-800 text-gray-200 rounded-bl-none border border-gray-700 shadow-sm"
                  }`}
                >
                  {msg.role === "user" ? (
                    msg.content
                  ) : (
                    <div className='markdown-styles'>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {isTyping && (
            <div className='flex justify-start'>
              <div className='bg-gray-800 p-4 rounded-2xl rounded-bl-none border border-gray-700 text-gray-400 text-sm flex items-center gap-2'>
                <div className='w-2 h-2 bg-emerald-500 rounded-full animate-bounce'></div>
                <div
                  className='w-2 h-2 bg-emerald-500 rounded-full animate-bounce'
                  style={{ animationDelay: "0.2s" }}
                ></div>
                <div
                  className='w-2 h-2 bg-emerald-500 rounded-full animate-bounce'
                  style={{ animationDelay: "0.4s" }}
                ></div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Chat Input form */}
        <div className='absolute bottom-0 left-0 right-0 p-5 bg-gray-950/95 backdrop-blur border-t border-gray-800'>
          <form
            onSubmit={handleSendMessage}
            className='flex gap-3 max-w-5xl mx-auto'
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
              className='flex-1 bg-gray-900 border border-gray-700 rounded-xl px-5 py-3.5 focus:outline-none focus:border-emerald-500 transition-colors shadow-inner'
            />
            <button
              type='submit'
              disabled={isTyping || !inputMessage.trim()}
              className='bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-600 text-white p-3.5 rounded-xl transition-colors shadow-sm'
            >
              <Send
                size={22}
                className={
                  inputMessage.trim() && !isTyping
                    ? "translate-x-0.5 transition-transform"
                    : ""
                }
              />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

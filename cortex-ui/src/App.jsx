import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import HomePage from "./components/HomePage.jsx";
import LibraryPage from "./components/LibraryPage.jsx";
import ChatPage from "./components/ChatPage.jsx";
import AddSourceModal from "./components/AddSourceModal.jsx";
import { Box, BrainCircuit, ChevronRight, CircleHelp, Command, FileText, FolderOpen, Image as ImageIcon, Link, MessageCircle, MessageSquare, MoreHorizontal, Plus, Search } from "lucide-react";

const API_BASE = "http://127.0.0.1:8000";
const readStore = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState("");
  const [activeSource, setActiveSource] = useState(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [view, setView] = useState("home");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState(() => readStore("cortex_chat_history", []).map(m => ({ ...m, sourceId: m.sourceId || "global" })));
  const [inputMessage, setInputMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  const chatKey = activeSource?.document_id || "global";

  useEffect(() => { localStorage.setItem("cortex_chat_history", JSON.stringify(messages)); }, [messages]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isTyping]);
  useEffect(() => { fetchDocuments(); }, []);

  async function fetchDocuments() {
    try { const res = await axios.get(`${API_BASE}/documents`); setDocuments(res.data.documents || []); }
    catch (error) { console.error("Failed to fetch documents:", error); }
  }
  const getIcon = (type, size = 18) => type === "url"
    ? <Link size={size} /> : type === "image" ? <ImageIcon size={size} /> : <FileText size={size} />;
  const getKind = (doc) => doc?.source_type === "image" ? "images" : doc?.source_type === "url" ? "links" : "documents";
  const grouped = useMemo(() => ({
    images: documents.filter(d => d.source_type === "image"),
    documents: documents.filter(d => !["image", "url"].includes(d.source_type)),
    links: documents.filter(d => d.source_type === "url"),
  }), [documents]);
  const visibleDocs = (category === "all" ? documents : grouped[category] || []).filter(d =>
    `${d.filename} ${d.title || ""}`.toLowerCase().includes(query.toLowerCase()));
  const sourceMessages = messages.filter(m => m.sourceId === chatKey);
  const chatTurns = useMemo(() => {
    const turns = new Map();
    messages.forEach((m) => {
      const key = m.sourceId || "global";
      if (!turns.has(key)) turns.set(key, { sourceId: key, title: key === "global" ? "Open conversation" : documents.find(d => d.document_id === key)?.title || documents.find(d => d.document_id === key)?.filename || "Source conversation", count: 0, last: 0 });
      const item = turns.get(key); item.count += m.role === "user" ? 1 : 0; item.last = Math.max(item.last, m.at || 0);
    });
    return [...turns.values()].sort((a,b) => b.last-a.last);
  }, [messages, documents]);

  async function addUrl() {
    const url = prompt("Enter the URL to add:"); if (!url) return;
    setProcessing(true); setProcessStatus("Reading your link…");
    try { const res = await axios.post(`${API_BASE}/sources/url`, { url }); await fetchDocuments(); setActiveSource(res.data); setView("chat"); }
    catch (error) { alert(error.response?.data?.detail || "Could not process this link."); }
    finally { setProcessing(false); setShowAddMenu(false); setProcessStatus(""); }
  }
  async function uploadFile(e, endpoint) {
    const file = e.target.files?.[0]; if (!file) return;
    const formData = new FormData(); formData.append("file", file);
    setProcessing(true); setProcessStatus(`Adding ${file.name}…`);
    try { const res = await axios.post(`${API_BASE}/${endpoint}`, formData, { headers: { "Content-Type": "multipart/form-data" } }); await fetchDocuments(); setActiveSource(res.data); setView("chat"); }
    catch (error) { alert(error.response?.data?.detail || "Upload failed. Please try again."); }
    finally { setProcessing(false); setShowAddMenu(false); setProcessStatus(""); e.target.value = ""; }
  }
  async function sendMessage(e) {
    e.preventDefault(); if (!inputMessage.trim() || isTyping) return;
    const question = inputMessage.trim(); setInputMessage("");
    setMessages(prev => [...prev, { role: "user", content: question, sourceId: chatKey, at: Date.now() }]); setIsTyping(true);
    try {
      const res = await axios.post(`${API_BASE}/chat`, { question, filename: activeSource?.filename || null, session_id: `cortex-${chatKey}` });
      setMessages(prev => [...prev, { role: "assistant", content: res.data.answer, sourceId: chatKey, at: Date.now() }]);
    } catch (error) {
      setMessages(prev => [...prev, { role: "assistant", content: error.response?.data?.detail || "I couldn’t reach the knowledge engine. Check that the backend is running and try again.", sourceId: chatKey, at: Date.now() }]);
    } finally { setIsTyping(false); }
  }
  function openSource(doc) { setActiveSource(doc); setView("chat"); }
  function openThread(sourceId) { setActiveSource(documents.find(d => d.document_id === sourceId) || null); setView("chat"); }
  function goHome() {
    setView("home");
    setActiveSource(null);
    setCategory("all");
    setQuery("");
    setShowAddMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const categoryCards = [
    { id: "images", label: "Images", note: "Visual references", icon: ImageIcon, color: "coral", count: grouped.images.length },
    { id: "documents", label: "Documents", note: "Notes & reading", icon: FileText, color: "mint", count: grouped.documents.length },
    { id: "links", label: "Links", note: "Things from the web", icon: Link, color: "blue", count: grouped.links.length },
    { id: "chats", label: "Threads", note: "Ideas in conversation", icon: MessageCircle, color: "lilac", count: chatTurns.length },
  ];

  return <div className="app-shell">
    <aside className="rail">
      <button type="button" className="brand-mark" onClick={goHome} aria-label="Cortex home" title="Go to home"><BrainCircuit size={22}/></button>
      <div className="rail-rule" />
      <button type="button" className={`rail-button ${view === "home" ? "selected" : ""}`} title="Home" aria-label="Home" aria-current={view === "home" ? "page" : undefined} onClick={goHome}><Box size={19}/></button>
      <button className={`rail-button ${view === "chat" ? "selected" : ""}`} title="Chat" onClick={() => setView("chat")}><MessageSquare size={19}/></button>
      <button className={`rail-button ${view === "library" ? "selected" : ""}`} title="Library" onClick={() => setView("library")}><FolderOpen size={19}/></button>
      <div className="rail-spacer"/>
      <button className="rail-button" title="Help"><CircleHelp size={18}/></button>
      <div className="avatar">M</div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="breadcrumb"><button type="button" className="crumb-brand" onClick={goHome} title="Go to home">Cortex</button><ChevronRight size={14}/><span>{view === "home" ? "Home" : view === "library" ? "Your library" : "Chat"}</span>{view === "chat" && activeSource && <><ChevronRight size={14}/><span className="crumb-current">{activeSource.title || activeSource.filename}</span></>}</div>
        <div className="top-actions"><button className="quiet-button" onClick={() => setView("library")}><Search size={16}/><span>Search your space</span><kbd><Command size={10}/> K</kbd></button><button className="top-icon" title="More"><MoreHorizontal size={20}/></button></div>
      </header>

      {view === "home" && <HomePage {...{documents, chatTurns, categoryCards, setCategory, setView, openSource, openThread, getIcon}} />}

      {view === "library" && <LibraryPage {...{documents, category, setCategory, categoryCards, query, setQuery, chatTurns, openThread, visibleDocs, openSource, setShowAddMenu, setView, getIcon}} />}

      {view === "chat" && <ChatPage {...{activeSource, setActiveSource, getIcon, sourceMessages, inputMessage, setInputMessage, sendMessage, isTyping, messagesEndRef, setView, chatTurns, chatKey, openThread, documents, openSource, getKind}} />}
    </main>

    {showAddMenu && <AddSourceModal {...{setShowAddMenu, processing, processStatus, uploadFile, addUrl}} />}
    <button className="floating-add" onClick={()=>setShowAddMenu(true)} disabled={processing}><Plus size={19}/><span>{processing ? processStatus : "Add to your space"}</span></button>
  </div>;
}


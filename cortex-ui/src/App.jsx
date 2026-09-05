import { useState, useEffect } from "react";
import axios from "axios";
import { Upload, FileText, Trash2, BrainCircuit } from "lucide-react";

const API_BASE = "http://127.0.0.1:8000";

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  // Fetch documents on load
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

  // Handle File Upload
  const handleFileUpload = async (e) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];

    const formData = new FormData();
    formData.append("file", file);

    setIsUploading(true);
    try {
      await axios.post(`${API_BASE}/documents/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      fetchDocuments(); // Refresh the list
    } catch (error) {
      console.error("Upload failed:", error);
      alert("Upload failed. Check console for details.");
    } finally {
      setIsUploading(false);
      e.target.value = ""; // Reset input
    }
  };

  // Handle File Delete
  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API_BASE}/documents/${id}`);
      fetchDocuments();
    } catch (error) {
      console.error("Delete failed:", error);
    }
  };

  return (
    <div className='flex h-screen bg-gray-900 text-gray-100 font-sans'>
      {/* SIDEBAR - Document Manager */}
      <div className='w-80 bg-gray-950 border-r border-gray-800 flex flex-col'>
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
              No documents uploaded yet.
            </p>
          ) : (
            <ul className='space-y-2'>
              {documents.map((doc) => (
                <li
                  key={doc.document_id}
                  className='flex items-center justify-between p-3 bg-gray-900 rounded-lg border border-gray-800 group hover:border-gray-700 transition-colors'
                >
                  <div className='flex items-center gap-3 overflow-hidden'>
                    <FileText
                      size={16}
                      className='text-emerald-500 flex-shrink-0'
                    />
                    <span className='text-sm truncate'>{doc.filename}</span>
                  </div>
                  <button
                    onClick={() => handleDelete(doc.document_id)}
                    className='text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity'
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className='p-4 border-t border-gray-800'>
          <label
            className={`flex items-center justify-center gap-2 w-full p-3 rounded-lg cursor-pointer transition-colors ${isUploading ? "bg-gray-800 text-gray-500" : "bg-emerald-600 hover:bg-emerald-500 text-white"}`}
          >
            <Upload size={18} />
            <span className='text-sm font-medium'>
              {isUploading ? "Ingesting Data..." : "Upload Document"}
            </span>
            <input
              type='file'
              className='hidden'
              accept='.pdf,.txt,.md'
              onChange={handleFileUpload}
              disabled={isUploading}
            />
          </label>
        </div>
      </div>

      {/* MAIN CHAT AREA (Placeholder for now) */}
      <div className='flex-1 flex items-center justify-center bg-gray-900'>
        <div className='text-center text-gray-500'>
          <BrainCircuit size={48} className='mx-auto mb-4 opacity-20' />
          <p>
            Select a document or start typing to interact with your Second
            Brain.
          </p>
        </div>
      </div>
    </div>
  );
}

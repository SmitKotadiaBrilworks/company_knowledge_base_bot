"use client";

import { useState, useRef, useEffect } from "react";
import type { Document, SearchResult, QueryResponse } from "@/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(dateStr: string) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: SearchResult[];
  searchType?: string;
  loading?: boolean;
}

// ── Components ────────────────────────────────────────────────────────────────

function SourceCard({ source, index }: { source: SearchResult; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const score = source.rrf_score ?? source.similarity ?? 0;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden text-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-left"
      >
        <span className="font-medium text-gray-700 truncate">
          [{index + 1}] {source.metadata?.source ?? "Unknown"}
          {source.metadata?.page ? ` · p.${source.metadata.page}` : ""}
        </span>
        <span className="ml-2 shrink-0 text-xs text-gray-400">
          score {score.toFixed(4)} {expanded ? "▲" : "▼"}
        </span>
      </button>
      {expanded && (
        <div className="px-3 py-2 text-gray-600 text-xs leading-relaxed whitespace-pre-wrap border-t border-gray-200">
          {source.content}
        </div>
      )}
    </div>
  );
}

function AssistantMessage({ msg }: { msg: ChatMessage }) {
  const [showSources, setShowSources] = useState(false);

  if (msg.loading) {
    return (
      <div className="flex gap-3 items-start">
        <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
          AI
        </div>
        <div className="flex-1 bg-white border border-gray-200 rounded-xl px-4 py-3">
          <div className="flex gap-1 items-center">
            <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
        AI
      </div>
      <div className="flex-1 space-y-2">
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">
          {msg.content}
        </div>
        {msg.sources && msg.sources.length > 0 && (
          <div className="space-y-1">
            <button
              onClick={() => setShowSources(!showSources)}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              {showSources ? "Hide" : "Show"} {msg.sources.length} source
              {msg.sources.length !== 1 ? "s" : ""} ·{" "}
              <span className="text-gray-400">{msg.searchType} search</span>
            </button>
            {showSources && (
              <div className="space-y-1">
                {msg.sources.map((src, i) => (
                  <SourceCard key={src.id} source={src} index={i} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [selectedDocId, setSelectedDocId] = useState<string>("all");
  const [searchType, setSearchType] = useState<"hybrid" | "semantic">("hybrid");
  const [uploading, setUploading] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchDocuments();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function fetchDocuments() {
    try {
      const res = await fetch("/api/documents");
      const data = await res.json();
      if (data.documents) setDocuments(data.documents);
    } catch {
      // silently ignore on initial load
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setUploadError(data.error ?? "Upload failed");
      } else {
        await fetchDocuments();
      }
    } catch {
      setUploadError("Network error during upload");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}" and all its chunks?`)) return;
    await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    if (selectedDocId === id) setSelectedDocId("all");
  }

  async function handleQuery(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || querying) return;

    const userMsg: ChatMessage = { role: "user", content: query.trim() };
    const loadingMsg: ChatMessage = {
      role: "assistant",
      content: "",
      loading: true,
    };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setQuery("");
    setQuerying(true);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: userMsg.content,
          document_id: selectedDocId !== "all" ? selectedDocId : undefined,
          search_type: searchType,
          match_count: 5,
        }),
      });

      const data: QueryResponse & { error?: string } = await res.json();

      setMessages((prev) => [
        ...prev.slice(0, -1), // remove loading placeholder
        {
          role: "assistant",
          content: data.error ?? data.answer,
          sources: data.sources,
          searchType: data.search_type,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: "Network error. Please try again." },
      ]);
    } finally {
      setQuerying(false);
    }
  }

  const selectedDocName =
    selectedDocId === "all"
      ? "All documents"
      : documents.find((d) => d.id === selectedDocId)?.name ?? "Unknown";

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
          KB
        </div>
        <div>
          <h1 className="text-base font-semibold text-gray-900">
            Company Knowledge Base
          </h1>
          <p className="text-xs text-gray-500">
            RAG · Gemini Embeddings · Supabase pgvector · Hybrid Search
          </p>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left panel: Documents ─────────────────────────────────────────── */}
        <aside className="w-72 shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              Documents
            </h2>

            {/* Upload button */}
            <label className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg cursor-pointer transition-colors">
              {uploading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Processing PDF…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Upload PDF
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleUpload}
                disabled={uploading}
              />
            </label>

            {uploadError && (
              <p className="mt-2 text-xs text-red-600 bg-red-50 rounded p-2">
                {uploadError}
              </p>
            )}
          </div>

          {/* Documents list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {/* "All documents" option */}
            <button
              onClick={() => setSelectedDocId("all")}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                selectedDocId === "all"
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              All documents ({documents.length})
            </button>

            {documents.map((doc) => (
              <div
                key={doc.id}
                className={`group flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  selectedDocId === doc.id
                    ? "bg-blue-50 text-blue-700"
                    : "hover:bg-gray-50 text-gray-700"
                }`}
                onClick={() => setSelectedDocId(doc.id)}
              >
                <svg
                  className="w-4 h-4 mt-0.5 shrink-0 text-red-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                  />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{doc.name}</p>
                  <p className="text-xs text-gray-400">
                    {doc.page_count}p · {formatBytes(doc.file_size)} ·{" "}
                    {timeAgo(doc.created_at)}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(doc.id, doc.name);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity shrink-0"
                  title="Delete"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}

            {documents.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-6 px-4">
                No documents yet. Upload a PDF to get started.
              </p>
            )}
          </div>

          {/* Search settings */}
          <div className="p-4 border-t border-gray-100 space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">
                Search type
              </label>
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                {(["hybrid", "semantic"] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setSearchType(type)}
                    className={`flex-1 text-xs py-1 rounded-md transition-colors font-medium ${
                      searchType === type
                        ? "bg-white text-gray-800 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {type === "hybrid" ? "Hybrid" : "Semantic"}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {searchType === "hybrid"
                  ? "Vector similarity + keyword (BM25) via RRF"
                  : "Pure vector cosine similarity"}
              </p>
            </div>
          </div>
        </aside>

        {/* ── Right panel: Chat ─────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Context banner */}
          <div className="px-6 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-700 font-medium">
            Context: <span className="font-semibold">{selectedDocName}</span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-gray-400">
                <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center text-2xl">
                  💬
                </div>
                <div>
                  <p className="font-medium text-gray-600">
                    Ask anything about your documents
                  </p>
                  <p className="text-sm mt-1">
                    Upload a PDF on the left, then ask a question here
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-2 mt-2 w-full max-w-md">
                  {[
                    "What are the main topics covered?",
                    "Summarise the key findings",
                    "What action items are mentioned?",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setQuery(suggestion)}
                      className="text-sm bg-white border border-gray-200 rounded-lg px-4 py-2 hover:bg-gray-50 text-gray-600 text-left"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) =>
              msg.role === "user" ? (
                <div key={i} className="flex gap-3 justify-end items-start">
                  <div className="max-w-[70%] bg-blue-600 text-white rounded-xl px-4 py-2.5 text-sm">
                    {msg.content}
                  </div>
                  <div className="w-7 h-7 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 text-xs font-bold shrink-0">
                    U
                  </div>
                </div>
              ) : (
                <AssistantMessage key={i} msg={msg} />
              )
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input form */}
          <div className="px-6 py-4 bg-white border-t border-gray-200">
            <form onSubmit={handleQuery} className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  documents.length === 0
                    ? "Upload a PDF first…"
                    : "Ask a question about your documents…"
                }
                disabled={querying || documents.length === 0}
                className="flex-1 px-4 py-2.5 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
              />
              <button
                type="submit"
                disabled={!query.trim() || querying || documents.length === 0}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {querying ? "…" : "Ask"}
              </button>
            </form>
            <p className="text-xs text-gray-400 mt-1.5 text-center">
              RAG · Gemini-embedding-001 · {searchType} search
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

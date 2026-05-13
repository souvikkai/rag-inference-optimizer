'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { extractTextFromPdf } from '@/lib/jdPdfExtract';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8000';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface SelectedChunk {
  chunk: string;
  score?: number;
  faiss_score?: number;
  rerank_score?: number;
  chunk_index?: number;
}

interface QualityBreakdown {
  score?: number;
  faithfulness?: number;
  relevance?: number;
  specificity?: number;
  reasoning?: string;
  judge_latency_ms?: number;
  judge_model?: string;
}

interface ConfigResult {
  config: string;
  answer: string;
  latency_ms: number;
  cost_usd: number;
  quality_score: number;
  cost_savings_vs_baseline: string;
  quality_breakdown?: QualityBreakdown;
  candidate_retrieve_latency_ms?: number;
  rerank_latency_ms?: number;
  llm_latency_ms?: number;
  candidate_chunks_count?: number;
  selected_chunk_buckets?: string[];
  selected_chunks?: SelectedChunk[];
}

interface RetrievedChunk {
  chunk: string;
  score?: number;
  faiss_score?: number;
  rerank_score?: number;
  chunk_index?: number;
}

interface BenchmarkResults {
  configs: ConfigResult[];
  retrieve_latency_ms: number;
  retrieved_chunks: RetrievedChunk[];
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function normalizeJdText(text: string): string {
  return text
    .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
    .replace(/\s{3,}/g, '\n')
    .trim();
}

function isAllowedJdUpload(file: File): boolean {
  const lower = file.name.toLowerCase();
  const t = file.type.toLowerCase();
  return (
    t.includes('pdf') ||
    t.includes('text') ||
    t === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.pdf') ||
    lower.endsWith('.docx') ||
    lower.endsWith('.txt')
  );
}

function formatAnswer(answer: string): string[] {
  const lines = answer.split('\n').filter(l => l.trim());
  const points = lines.filter(l =>
    l.match(/^\d+\./) || l.match(/^[-•*]/) || l.match(/^\*\*/)
  ).map(l =>
    l.replace(/^\d+\.\s*/, '')
     .replace(/^[-•*]\s*/, '')
     .replace(/\*\*/g, '')
     .trim()
  );
  return points.length > 0 ? points : lines.slice(0, 5);
}

function qualityGrade(score: number): { grade: string; color: string; bg: string } {
  if (score >= 88) return { grade: 'A', color: '#10b981', bg: '#d1fae5' };
  if (score >= 75) return { grade: 'B', color: '#f59e0b', bg: '#fef3c7' };
  return { grade: 'C', color: '#ef4444', bg: '#fee2e2' };
}

const CONFIGS = [
  {
    key: 'Claude Haiku',
    short: 'Haiku',
    accent: '#f97316',
    accentLight: '#fff7ed',
    tag: 'Baseline',
    icon: '◆',
  },
  {
    key: 'Llama 3 8B (Groq)',
    short: 'Groq',
    accent: '#8b5cf6',
    accentLight: '#f5f3ff',
    tag: 'Fast',
    icon: '⚡',
  },
  {
    key: 'Llama 3 8B + Reranker (Groq)',
    short: 'Groq + Rank',
    accent: '#10b981',
    accentLight: '#ecfdf5',
    tag: 'Optimized',
    icon: '◈',
  },
];

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
export default function Home() {
  const [jd, setJd] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BenchmarkResults | null>(null);
  const [error, setError] = useState('');
  const [showChunks, setShowChunks] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [activeTab, setActiveTab] = useState<'text' | 'pdf'>('text');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [resumeStatus, setResumeStatus] = useState('');
  const [resumeDragOver, setResumeDragOver] = useState(false);
  const resumeFileRef = useRef<HTMLInputElement>(null);
  const [loadingStep, setLoadingStep] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Simulate loading steps
  const runBenchmark = useCallback(async () => {
    if (jd.trim().length < 50) {
      setError('Please paste a full job description (at least 50 characters).');
      return;
    }
    setLoading(true);
    setError('');
    setResults(null);
    setLoadingStep(0);

    const stepInterval = setInterval(() => {
      setLoadingStep(prev => Math.min(prev + 1, 4));
    }, 3500);

    try {
      const cleanedJobDescription = jd
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 5000);

      const response = await axios.post(`${API_BASE_URL}/benchmark`, {
        job_description: cleanedJobDescription
      }, { timeout: 120000 });
      clearInterval(stepInterval);
      setLoadingStep(5);
      setResults(response.data);
    } catch (err: unknown) {
      clearInterval(stepInterval);
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail || 'Something went wrong. Is the backend running?');
      } else {
        setError('Something went wrong. Is the backend running?');
      }
    } finally {
      setLoading(false);
    }
  }, [jd]);

  const handleFile = useCallback((file: File) => {
    if (!isAllowedJdUpload(file)) {
      setError('Please upload a PDF, DOCX, or text file.');
      return;
    }
    setUploadedFileName(file.name);

    const lower = file.name.toLowerCase();
    const isPdf =
      file.type.includes('pdf') || lower.endsWith('.pdf');
    const isDocx =
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      lower.endsWith('.docx');

    if (isPdf) {
      const reader = new FileReader();
      reader.onload = async e => {
        const buffer = e.target?.result as ArrayBuffer;
        try {
          const raw = await extractTextFromPdf(buffer);
          setJd(normalizeJdText(raw));
          setError('');
        } catch {
          setError('Please upload a PDF, DOCX, or text file.');
        }
      };
      reader.onerror = () => {
        setError('Please upload a PDF, DOCX, or text file.');
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    if (isDocx) {
      const reader = new FileReader();
      reader.onload = async e => {
        const buffer = e.target?.result as ArrayBuffer;
        try {
          const mammoth = await import('mammoth');
          const { value } = await mammoth.extractRawText({ arrayBuffer: buffer });
          setJd(normalizeJdText(value));
          setError('');
        } catch {
          setError('Please upload a PDF, DOCX, or text file.');
        }
      };
      reader.onerror = () => {
        setError('Please upload a PDF, DOCX, or text file.');
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      setJd(normalizeJdText(text));
      setError('');
    };
    reader.readAsText(file);
  }, []);

  const handleResumeUpload = useCallback(async (file: File) => {
    setResumeFile(file);
    setResumeUploading(true);
    setResumeStatus('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post(
        `${API_BASE_URL}/update-resume`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setResumeStatus(
        `✓ Resume updated — ${response.data.chunks_created} chunks indexed`
      );
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setResumeStatus(`✗ ${err.response?.data?.detail || 'Upload failed'}`);
      } else {
        setResumeStatus('✗ Upload failed');
      }
    } finally {
      setResumeUploading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const STEPS = [
    'Embedding job description...',
    'Searching FAISS index for relevant resume chunks...',
    'Claude Haiku generating talking points...',
    'Llama 3.1 8B on Groq generating talking points...',
    'LLM-as-judge scoring all three configurations...',
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500&family=Instrument+Sans:wght@400;500;600;700&display=swap');

        :root {
          --bg: #0c0c10;
          --surface: #13131a;
          --surface2: #1a1a24;
          --border: #2a2a3a;
          --border2: #333345;
          --text: #e8e8f0;
          --text-dim: #6b6b85;
          --text-muted: #3a3a50;
          --accent: #6366f1;
          --accent2: #f59e0b;
          --success: #10b981;
          --danger: #ef4444;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: var(--bg);
          color: var(--text);
          font-family: 'Instrument Sans', sans-serif;
          min-height: 100vh;
          overflow-x: hidden;
        }

        body::before {
          content: '';
          position: fixed;
          inset: 0;
          background:
            radial-gradient(ellipse 80% 50% at 20% -10%, rgba(99,102,241,0.08) 0%, transparent 60%),
            radial-gradient(ellipse 60% 40% at 80% 110%, rgba(16,185,129,0.06) 0%, transparent 60%);
          pointer-events: none;
          z-index: 0;
        }

        .page { position: relative; z-index: 1; }

        /* Header */
        .header {
          border-bottom: 1px solid var(--border);
          padding: 20px 40px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(13,13,16,0.8);
          backdrop-filter: blur(12px);
          position: sticky;
          top: 0;
          z-index: 100;
        }

        .header-logo {
          font-family: 'DM Serif Display', serif;
          font-size: 20px;
          color: var(--text);
          letter-spacing: -0.5px;
          text-decoration: none;
          display: block;
        }

        .header-logo span { color: var(--accent); font-style: italic; }

        .header-meta {
          font-size: 11px;
          color: var(--text-dim);
          text-align: right;
          line-height: 1.6;
          font-family: 'DM Mono', monospace;
        }

        /* Main content */
        .container {
          max-width: 1100px;
          margin: 0 auto;
          padding: 48px 40px 80px;
        }

        /* Hero */
        .hero {
          margin-bottom: 48px;
          animation: fadeUp 0.6s ease both;
        }

        .hero-tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-family: 'DM Mono', monospace;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--accent);
          background: rgba(99,102,241,0.1);
          border: 1px solid rgba(99,102,241,0.2);
          padding: 4px 10px;
          border-radius: 20px;
          margin-bottom: 16px;
        }

        .hero h1 {
          font-family: 'DM Serif Display', serif;
          font-size: clamp(32px, 5vw, 52px);
          line-height: 1.1;
          color: var(--text);
          margin-bottom: 12px;
          letter-spacing: -1px;
        }

        .hero h1 em {
          color: var(--accent2);
          font-style: italic;
        }

        .hero p {
          font-size: 15px;
          color: var(--text-dim);
          max-width: 520px;
          line-height: 1.7;
        }

        /* Input card */
        .input-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 28px;
          margin-bottom: 32px;
          animation: fadeUp 0.6s 0.1s ease both;
        }

        /* Tabs */
        .tabs {
          display: flex;
          gap: 2px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 3px;
          width: fit-content;
          margin-bottom: 20px;
        }

        .tab {
          padding: 6px 16px;
          font-size: 13px;
          font-weight: 500;
          border-radius: 7px;
          cursor: pointer;
          border: none;
          transition: all 0.15s ease;
          background: transparent;
          color: var(--text-dim);
        }

        .tab.active {
          background: var(--surface2);
          color: var(--text);
          border: 1px solid var(--border2);
        }

        /* Textarea */
        .jd-textarea {
          width: 100%;
          height: 200px;
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 16px;
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          color: var(--text);
          resize: vertical;
          outline: none;
          transition: border-color 0.15s;
          line-height: 1.6;
        }

        .jd-textarea:focus { border-color: var(--accent); }
        .jd-textarea::placeholder { color: var(--text-muted); }

        /* Drop zone */
        .drop-zone {
          border: 2px dashed var(--border2);
          border-radius: 12px;
          padding: 40px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s ease;
          background: var(--surface2);
        }

        .drop-zone:hover, .drop-zone.dragover {
          border-color: var(--accent);
          background: rgba(99,102,241,0.05);
        }

        .drop-zone-icon {
          font-size: 36px;
          margin-bottom: 12px;
          display: block;
        }

        .drop-zone-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text);
          margin-bottom: 4px;
        }

        .drop-zone-sub {
          font-size: 12px;
          color: var(--text-dim);
        }

        .file-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-top: 12px;
          background: rgba(16,185,129,0.1);
          border: 1px solid rgba(16,185,129,0.2);
          color: var(--success);
          font-size: 12px;
          padding: 4px 10px;
          border-radius: 6px;
          font-family: 'DM Mono', monospace;
        }

        /* Input footer */
        .input-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 16px;
        }

        .char-count {
          font-size: 11px;
          color: var(--text-dim);
          font-family: 'DM Mono', monospace;
        }

        /* Run button */
        .run-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 24px;
          background: var(--accent);
          color: white;
          font-size: 14px;
          font-weight: 600;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.15s ease;
          font-family: 'Instrument Sans', sans-serif;
        }

        .run-btn:hover:not(:disabled) {
          background: #4f46e5;
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(99,102,241,0.35);
        }

        .run-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }

        .error-msg {
          margin-top: 12px;
          padding: 10px 14px;
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.2);
          border-radius: 8px;
          color: #fca5a5;
          font-size: 13px;
        }

        /* Loading */
        .loading-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 40px;
          margin-bottom: 32px;
          animation: fadeUp 0.4s ease both;
        }

        .loading-title {
          font-family: 'DM Serif Display', serif;
          font-size: 22px;
          color: var(--text);
          margin-bottom: 28px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .spinner {
          width: 20px;
          height: 20px;
          border: 2px solid var(--border2);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        .step-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .step {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 13px;
          color: var(--text-dim);
          transition: all 0.3s ease;
        }

        .step.done { color: var(--success); }
        .step.active { color: var(--text); }

        .step-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--border2);
          flex-shrink: 0;
          transition: all 0.3s ease;
        }

        .step.done .step-dot { background: var(--success); }
        .step.active .step-dot {
          background: var(--accent);
          box-shadow: 0 0 8px rgba(99,102,241,0.6);
          animation: pulse 1s ease infinite;
        }

        /* Summary table */
        .summary-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 28px;
          margin-bottom: 24px;
          animation: fadeUp 0.5s ease both;
        }

        .section-title {
          font-size: 11px;
          font-family: 'DM Mono', monospace;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: var(--text-dim);
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .section-title::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--border);
        }

        .summary-table {
          width: 100%;
          border-collapse: collapse;
        }

        .summary-table th {
          text-align: left;
          font-size: 11px;
          font-family: 'DM Mono', monospace;
          color: var(--text-dim);
          padding: 8px 12px;
          border-bottom: 1px solid var(--border);
          letter-spacing: 0.05em;
        }

        .summary-table th:not(:first-child) { text-align: right; }

        .summary-table td {
          padding: 12px 12px;
          font-size: 13px;
          border-bottom: 1px solid rgba(42,42,58,0.5);
        }

        .summary-table tr:last-child td { border-bottom: none; }
        .summary-table td:not(:first-child) {
          text-align: right;
          font-family: 'DM Mono', monospace;
        }

        .config-name-cell {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .config-icon {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          flex-shrink: 0;
        }

        .tag-pill {
          font-size: 10px;
          padding: 2px 8px;
          border-radius: 20px;
          font-weight: 600;
          letter-spacing: 0.05em;
          font-family: 'DM Mono', monospace;
        }

        .quality-score {
          font-weight: 700;
          font-size: 15px;
        }

        /* Config cards */
        .cards-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          margin-bottom: 24px;
          animation: fadeUp 0.5s 0.1s ease both;
        }

        @media (max-width: 900px) {
          .cards-grid { grid-template-columns: 1fr; }
        }

        .config-card {
          background: var(--surface);
          border-radius: 16px;
          border: 1px solid var(--border);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .card-header {
          padding: 18px 20px 14px;
          border-bottom: 1px solid var(--border);
        }

        .card-header-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 10px;
        }

        .card-config-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .grade-badge {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'DM Serif Display', serif;
          font-size: 22px;
          flex-shrink: 0;
        }

        .card-metrics {
          display: flex;
          gap: 16px;
        }

        .metric {
          font-size: 11px;
          font-family: 'DM Mono', monospace;
          color: var(--text-dim);
        }

        .metric span {
          display: block;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 1px;
          color: var(--text-muted);
        }

        .card-body {
          padding: 18px 20px;
          flex: 1;
        }

        .talking-point {
          display: flex;
          gap: 10px;
          margin-bottom: 10px;
          font-size: 12px;
          color: var(--text-dim);
          line-height: 1.6;
        }

        .point-num {
          flex-shrink: 0;
          width: 18px;
          height: 18px;
          border-radius: 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
          font-family: 'DM Mono', monospace;
          margin-top: 1px;
        }

        .card-footer {
          padding: 10px 20px;
          border-top: 1px solid var(--border);
          font-size: 11px;
          color: var(--text-dim);
          font-family: 'DM Mono', monospace;
          background: var(--surface2);
        }

        /* Chunks section */
        .chunks-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          overflow: hidden;
          animation: fadeUp 0.5s 0.2s ease both;
        }

        .chunks-toggle {
          width: 100%;
          padding: 18px 24px;
          background: transparent;
          border: none;
          color: var(--text-dim);
          font-size: 13px;
          font-family: 'Instrument Sans', sans-serif;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 10px;
          transition: color 0.15s;
          text-align: left;
        }

        .chunks-toggle:hover { color: var(--text); }

        .chunks-list {
          border-top: 1px solid var(--border);
        }

        .chunk-item {
          padding: 16px 24px;
          border-bottom: 1px solid var(--border);
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 12px;
          align-items: start;
        }

        .chunk-item:last-child { border-bottom: none; }

        .chunk-rank {
          font-size: 10px;
          font-family: 'DM Mono', monospace;
          color: var(--text-dim);
          white-space: nowrap;
          padding-top: 2px;
        }

        .chunk-text {
          font-size: 12px;
          color: var(--text-dim);
          line-height: 1.7;
          font-family: 'DM Mono', monospace;
        }

        /* Animations */
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      <div className="page">
        {/* Header */}
        <header className="header">
          <Link href="/" className="header-logo">
            RAG <span>Inference</span> Optimizer
          </Link>
          <div className="header-meta">
            Souvik Kundu · AI PM Portfolio · Product 3<br />
            github.com/souvikkai
          </div>
        </header>

        <div className="container">
          {/* Hero */}
          <div className="hero">
            <div className="hero-tag">
              ◆ RAG + LLM Benchmark
            </div>
            <h1>
              Resume × JD Matching<br />
              <em>Benchmarked</em> Across 3 Configs
            </h1>
            <p>
              Paste a job description. The system retrieves your most relevant
              experience and generates tailored talking points — then benchmarks
              Claude Haiku against Llama 3.1 8B on Groq for cost, latency, and quality
              (Sonnet as LLM judge; reranker path uses 25 candidates → diverse 5).
            </p>
          </div>

          {/* Resume upload */}
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            padding: '20px 28px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
            animation: 'fadeUp 0.6s 0.05s ease both'
          }}>
            <div>
              <div style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text)',
                marginBottom: 4
              }}>
                Resume
              </div>
              <div style={{
                fontSize: 12,
                color: 'var(--text-dim)',
                fontFamily: 'DM Mono, monospace'
              }}>
                {resumeFile
                  ? `${resumeFile.name} loaded`
                  : 'Using default resume · upload to change'}
              </div>
              {resumeStatus && (
                <div style={{
                  marginTop: 6,
                  fontSize: 11,
                  fontFamily: 'DM Mono, monospace',
                  color: resumeStatus.startsWith('✓')
                    ? 'var(--success)' : 'var(--danger)'
                }}>
                  {resumeUploading ? 'Indexing...' : resumeStatus}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {resumeUploading && (
                <div className="spinner" style={{ width: 16, height: 16 }} />
              )}
              <div
                style={{
                  border: '1px dashed var(--border2)',
                  borderRadius: 10,
                  padding: '10px 20px',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: 'var(--text-dim)',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                  background: resumeDragOver
                    ? 'rgba(99,102,241,0.08)' : 'transparent',
                  borderColor: resumeDragOver
                    ? 'var(--accent)' : 'var(--border2)'
                }}
                onDragOver={e => { e.preventDefault(); setResumeDragOver(true); }}
                onDragLeave={() => setResumeDragOver(false)}
                onDrop={e => {
                  e.preventDefault();
                  setResumeDragOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file) handleResumeUpload(file);
                }}
                onClick={() => resumeFileRef.current?.click()}
              >
                {resumeFile ? '↺ Update Resume' : '↑ Upload Resume'}
              </div>
              <input
                ref={resumeFileRef}
                type="file"
                accept=".txt,.pdf,.docx"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleResumeUpload(file);
                }}
              />
            </div>
          </div>

          {/* Input card */}
          <div className="input-card">
            <div className="tabs">
              <button
                className={`tab ${activeTab === 'text' ? 'active' : ''}`}
                onClick={() => setActiveTab('text')}
              >
                Paste Text
              </button>
              <button
                className={`tab ${activeTab === 'pdf' ? 'active' : ''}`}
                onClick={() => setActiveTab('pdf')}
              >
                Upload File
              </button>
            </div>

            {activeTab === 'text' ? (
              <textarea
                className="jd-textarea"
                placeholder="Paste the full job description here..."
                value={jd}
                onChange={e => { setJd(e.target.value); setError(''); }}
              />
            ) : (
              <div>
                <div
                  className={`drop-zone ${dragOver ? 'dragover' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span className="drop-zone-icon">📄</span>
                  <div className="drop-zone-title">Drop JD file here</div>
                  <div className="drop-zone-sub">or click to browse · PDF, DOCX, or TXT</div>
                  {uploadedFileName && (
                    <div className="file-badge">✓ {uploadedFileName}</div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />
                {jd && uploadedFileName && (
                  <div style={{
                    marginTop: 12,
                    padding: '10px 14px',
                    background: 'rgba(16,185,129,0.08)',
                    border: '1px solid rgba(16,185,129,0.15)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: '#6ee7b7',
                    fontFamily: 'DM Mono, monospace'
                  }}>
                    ✓ Extracted {jd.length} characters from {uploadedFileName}
                  </div>
                )}
              </div>
            )}

            <div className="input-footer">
              <div className="char-count">
                {jd.length} chars · standard top-5 retrieval · 3 LLM configs
              </div>
              <button
                className="run-btn"
                onClick={runBenchmark}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <div className="spinner" style={{ width: 14, height: 14 }} />
                    Running...
                  </>
                ) : (
                  <>▶ Run Benchmark</>
                )}
              </button>
            </div>

            {error && <div className="error-msg">{error}</div>}
          </div>

          {/* Loading */}
          {loading && (
            <div className="loading-card">
              <div className="loading-title">
                <div className="spinner" />
                Benchmarking...
              </div>
              <div className="step-list">
                {STEPS.map((step, i) => (
                  <div
                    key={i}
                    className={`step ${i < loadingStep ? 'done' : i === loadingStep ? 'active' : ''}`}
                  >
                    <div className="step-dot" />
                    {i < loadingStep ? '✓ ' : ''}{step}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Results */}
          {results && (
            <>
              {/* Summary table */}
              <div className="summary-card">
                <div className="section-title">Benchmark Results</div>
                <table className="summary-table">
                  <thead>
                    <tr>
                      <th>Configuration</th>
                      <th>Latency</th>
                      <th>Cost / Query</th>
                      <th>Quality</th>
                      <th>vs Baseline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.configs.map((config, i) => {
                      const meta = CONFIGS.find(c => c.key === config.config) || CONFIGS[i];
                      const { grade, color, bg } = qualityGrade(config.quality_score);
                      return (
                        <tr key={i}>
                          <td>
                            <div className="config-name-cell">
                              <div
                                className="config-icon"
                                style={{ background: meta.accentLight, color: meta.accent }}
                              >
                                {meta.icon}
                              </div>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                                  {config.config}
                                </div>
                                <span
                                  className="tag-pill"
                                  style={{
                                    background: meta.accentLight,
                                    color: meta.accent,
                                    border: `1px solid ${meta.accent}30`
                                  }}
                                >
                                  {meta.tag}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td style={{ color: 'var(--text)' }}>
                            {config.latency_ms.toFixed(0)}ms
                          </td>
                          <td style={{ color: 'var(--text)' }}>
                            ${config.cost_usd.toFixed(6)}
                          </td>
                          <td>
                            <span
                              className="quality-score"
                              style={{ color }}
                            >
                              {config.quality_score}
                              <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-dim)' }}>/100</span>
                            </span>
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 12,
                                fontWeight: 700,
                                background: bg,
                                color,
                                padding: '1px 6px',
                                borderRadius: 4,
                              }}
                            >
                              {grade}
                            </span>
                          </td>
                          <td style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                            {config.cost_savings_vs_baseline}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div style={{
                  marginTop: 16,
                  paddingTop: 16,
                  borderTop: '1px solid var(--border)',
                  fontSize: 11,
                  color: 'var(--text-dim)',
                  fontFamily: 'DM Mono, monospace',
                  display: 'flex',
                  gap: 24
                }}>
                  <span>retrieved {results.retrieved_chunks.length} chunks</span>
                  <span>retrieval: {results.retrieve_latency_ms}ms</span>
                  <span>judge: claude-sonnet-4-5</span>
                </div>
              </div>

              {/* Config cards */}
              <div className="cards-grid">
                {results.configs.map((config, i) => {
                  const meta = CONFIGS.find(c => c.key === config.config) || CONFIGS[i];
                  const { grade, color, bg } = qualityGrade(config.quality_score);
                  const points = formatAnswer(config.answer);

                  return (
                    <div
                      key={i}
                      className="config-card"
                      style={{ borderTop: `3px solid ${meta.accent}` }}
                    >
                      <div className="card-header">
                        <div className="card-header-top">
                          <div className="card-config-name">
                            <span style={{ color: meta.accent }}>{meta.icon}</span>
                            {meta.short}
                          </div>
                          <div
                            className="grade-badge"
                            style={{ background: bg, color }}
                          >
                            {grade}
                          </div>
                        </div>
                        <div className="card-metrics">
                          <div className="metric">
                            <span>Latency</span>
                            {config.latency_ms.toFixed(0)}ms
                          </div>
                          <div className="metric">
                            <span>Cost</span>
                            ${config.cost_usd.toFixed(6)}
                          </div>
                          <div className="metric">
                            <span>Quality</span>
                            <span style={{ color, fontWeight: 700 }}>
                              {config.quality_score}/100
                            </span>
                          </div>
                        </div>
                      </div>

                      {config.candidate_chunks_count != null && (
                        <div
                          style={{
                            padding: '10px 20px 12px',
                            borderBottom: '1px solid var(--border)',
                            background: 'var(--surface2)',
                          }}
                        >
                          <div
                            style={{
                              fontSize: 10,
                              letterSpacing: '0.06em',
                              textTransform: 'uppercase',
                              color: 'var(--text-muted)',
                              marginBottom: 6,
                              fontWeight: 600,
                            }}
                          >
                            Rerank diagnostics
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              fontFamily: "'DM Mono', monospace",
                              color: 'var(--text-dim)',
                              lineHeight: 1.45,
                              marginBottom: 8,
                            }}
                          >
                            <span style={{ color: 'var(--text-muted)' }}>Pipeline</span>{' '}
                            <span style={{ color: 'var(--text)' }}>
                              {config.candidate_chunks_count} candidates → rerank → diverse 5
                            </span>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '6px 14px',
                              fontSize: 11,
                              fontFamily: "'DM Mono', monospace",
                              color: 'var(--text-dim)',
                              marginBottom:
                                (config.selected_chunk_buckets?.length ?? 0) > 0 ||
                                (config.selected_chunks?.length ?? 0) > 0
                                  ? 8
                                  : 0,
                            }}
                          >
                            <span>
                              <span style={{ color: 'var(--text-muted)' }}>Candidate chunks</span>{' '}
                              {config.candidate_chunks_count}
                            </span>
                            <span>
                              <span style={{ color: 'var(--text-muted)' }}>Retrieval</span>{' '}
                              {typeof config.candidate_retrieve_latency_ms === 'number'
                                ? `${config.candidate_retrieve_latency_ms.toFixed(0)}ms`
                                : '—'}
                            </span>
                            <span>
                              <span style={{ color: 'var(--text-muted)' }}>Rerank</span>{' '}
                              {typeof config.rerank_latency_ms === 'number'
                                ? `${config.rerank_latency_ms.toFixed(0)}ms`
                                : '—'}
                            </span>
                            <span>
                              <span style={{ color: 'var(--text-muted)' }}>LLM</span>{' '}
                              {typeof config.llm_latency_ms === 'number'
                                ? `${config.llm_latency_ms.toFixed(0)}ms`
                                : '—'}
                            </span>
                          </div>
                          {(config.selected_chunk_buckets?.length ?? 0) > 0 && (
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                gap: 6,
                                marginBottom:
                                  (config.selected_chunks?.length ?? 0) > 0 ? 8 : 0,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 10,
                                  color: 'var(--text-muted)',
                                  fontFamily: "'DM Mono', monospace",
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.05em',
                                }}
                              >
                                Buckets
                              </span>
                              {(config.selected_chunk_buckets ?? []).map((b: string, bi: number) => (
                                <span
                                  key={bi}
                                  style={{
                                    fontSize: 10,
                                    fontFamily: "'DM Mono', monospace",
                                    color: meta.accent,
                                    padding: '2px 8px',
                                    borderRadius: 999,
                                    border: `1px solid ${meta.accent}`,
                                    background: 'rgba(0,0,0,0.25)',
                                  }}
                                >
                                  {b}
                                </span>
                              ))}
                            </div>
                          )}
                          {(config.selected_chunks?.length ?? 0) > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {(config.selected_chunks ?? []).slice(0, 2).map((ch: SelectedChunk, ci: number) => {
                                const raw = ch.chunk ?? '';
                                const preview =
                                  raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
                                const rs = ch.rerank_score;
                                return (
                                  <div
                                    key={ci}
                                    style={{
                                      fontSize: 10,
                                      lineHeight: 1.45,
                                      color: 'var(--text-dim)',
                                    }}
                                  >
                                    <span style={{ color: 'var(--text-muted)', fontFamily: "'DM Mono', monospace" }}>
                                      #{ci + 1}
                                    </span>{' '}
                                    <span style={{ fontFamily: "'DM Mono', monospace", color: meta.accent }}>
                                      {typeof rs === 'number' ? rs.toFixed(4) : '—'}
                                    </span>
                                    <span style={{ color: 'var(--text-muted)' }}> · </span>
                                    <span>{preview}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="card-body">
                        {points.slice(0, 5).map((point, j) => (
                          <div key={j} className="talking-point">
                            <div
                              className="point-num"
                              style={{
                                background: meta.accentLight,
                                color: meta.accent
                              }}
                            >
                              {j + 1}
                            </div>
                            <span>{point}</span>
                          </div>
                        ))}
                      </div>

                      <div className="card-footer">
                        {config.cost_savings_vs_baseline}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Retrieved chunks */}
              <div className="chunks-card">
                <button
                  className="chunks-toggle"
                  onClick={() => setShowChunks(!showChunks)}
                >
                  <span style={{ fontSize: 10 }}>{showChunks ? '▼' : '▶'}</span>
                  Retrieved Resume Chunks · {results.retrieved_chunks.length} segments
                  <span style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    fontFamily: 'DM Mono, monospace'
                  }}>
                    — first two configs use the chunks below; reranker picks 5 diverse chunks from top 25
                  </span>
                </button>

                {showChunks && (
                  <div className="chunks-list">
                    {results.retrieved_chunks.map((chunk, i) => (
                      <div key={i} className="chunk-item">
                        <div className="chunk-rank">
                          #{i + 1}<br />
                          <span style={{ color: 'var(--accent)', fontSize: 10 }}>
                           {(chunk.score ?? chunk.faiss_score ?? 0).toFixed(3)}
                          </span>
                        </div>
                        <div className="chunk-text">{chunk.chunk}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

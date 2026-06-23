/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  Download, 
  Loader2, 
  Plus, 
  Trash2, 
  Image as ImageIcon,
  Type,
  ChevronDown,
  ChevronUp,
  GraduationCap,
  Sparkles,
  BookOpen,
  Check,
  X,
  Languages,
  Key,
  Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ocrHandwrittenAnswer, correctAssignment, CorrectionItem, getStoredApiKey } from './services/gemini';

interface Assignment {
  id: string;
  file: File;
  preview: string;
  status: 'idle' | 'processing' | 'completed' | 'error';
  results?: CorrectionItem[];
  markedImage?: string;
}

export default function App() {
  const [answerType, setAnswerType] = useState<'text' | 'image'>('text');
  const [answerText, setAnswerText] = useState('');
  const [answerImage, setAnswerImage] = useState<{ file: File; preview: string } | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [isProcessingAnswer, setIsProcessingAnswer] = useState(false);
  const [isConvertingPdf, setIsConvertingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<{ [key: string]: boolean }>({});

  // API key configuration states
  const [apiKey, setApiKey] = useState(() => getStoredApiKey());
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');

  const saveApiKey = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('custom_gemini_api_key', tempApiKey.trim());
    }
    setApiKey(tempApiKey.trim());
    setShowApiKeyModal(false);
    setError(null);
  };

  const clearApiKey = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('custom_gemini_api_key');
    }
    setApiKey('');
    setShowApiKeyModal(false);
    setError(null);
  };

  const assignmentInputRef = useRef<HTMLInputElement>(null);
  const answerInputRef = useRef<HTMLInputElement>(null);

  const convertPdfToImages = async (file: File): Promise<{ preview: string; name: string }[]> => {
    const fileReader = new FileReader();
    return new Promise((resolve, reject) => {
      fileReader.onload = async () => {
        try {
          const typedarray = new Uint8Array(fileReader.result as ArrayBuffer);
          const pdfjsLib = (window as any).pdfjsLib;
          if (!pdfjsLib) {
            throw new Error("PDFJS 库未加载成功，请确保网络正常或稍候重试。");
          }
          
          const loadingTask = pdfjsLib.getDocument({ data: typedarray });
          const pdf = await loadingTask.promise;
          const pageImages: { preview: string; name: string }[] = [];
          
          const numPages = Math.min(pdf.numPages, 15);
          for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              await page.render({ canvasContext: ctx, viewport }).promise;
              pageImages.push({
                preview: canvas.toDataURL('image/jpeg', 0.95),
                name: pdf.numPages > 1 ? `${file.name.replace(/\.[^/.]+$/, "")}_第${i}页` : file.name
              });
            }
          }
          resolve(pageImages);
        } catch (err: any) {
          reject(err);
        }
      };
      fileReader.onerror = () => reject(new Error("读取 PDF 文件流失败"));
      fileReader.readAsArrayBuffer(file);
    });
  };

  const handleAnswerImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingAnswer(true);
    setError(null);

    try {
      if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
        const pages = await convertPdfToImages(file);
        if (pages.length > 0) {
          setAnswerImage({
            file: new File([file], pages[0].name, { type: "image/jpeg" }),
            preview: pages[0].preview
          });
          const parsedText = await ocrHandwrittenAnswer(pages[0].preview, "image/jpeg");
          setAnswerText(parsedText);
        } else {
          throw new Error("该答案 PDF 解析出 0 个可用页面");
        }
      } else {
        const reader = new FileReader();
        reader.onloadend = async () => {
          setAnswerImage({ file, preview: reader.result as string });
          try {
            const parsedText = await ocrHandwrittenAnswer(reader.result as string, file.type);
            setAnswerText(parsedText);
          } catch (err: any) {
            setError(`自动答案OCR识别失败，但已加载图片。你可以手动输入或重试: ${err.message}`);
          }
        };
        reader.readAsDataURL(file);
      }
    } catch (err: any) {
      console.error("Answer file processing/OCR failed:", err);
      setError(`从上传的答案中提取正确文本失败: ${err.message || "未知错误"}`);
    } finally {
      setIsProcessingAnswer(false);
      if (answerInputRef.current) {
        answerInputRef.current.value = "";
      }
    }
  };

  const handleAssignmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    setIsConvertingPdf(true);
    setError(null);

    const loadedAssignments: Assignment[] = [];

    try {
      for (const file of files) {
        if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
          const pages = await convertPdfToImages(file);
          pages.forEach((page) => {
            loadedAssignments.push({
              id: Math.random().toString(36).substr(2, 9),
              file: new File([file], page.name, { type: "image/jpeg" }),
              preview: page.preview,
              status: 'idle' as const
            });
          });
        } else {
          loadedAssignments.push({
            id: Math.random().toString(36).substr(2, 9),
            file,
            preview: URL.createObjectURL(file as Blob),
            status: 'idle' as const
          });
        }
      }

      setAssignments(prev => {
        const updated = [...prev, ...loadedAssignments];
        if (!selectedAssignmentId && updated.length > 0) {
          setSelectedAssignmentId(updated[0].id);
        }
        return updated;
      });
    } catch (err: any) {
      console.error("Scanned files translation error:", err);
      setError(`转换 PDF/图片扫描件失败: ${err.message || "文件格式不兼容"}`);
    } finally {
      setIsConvertingPdf(false);
      if (assignmentInputRef.current) {
        assignmentInputRef.current.value = "";
      }
    }
  };

  const removeAssignment = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAssignments(prev => {
      const filtered = prev.filter(a => a.id !== id);
      if (selectedAssignmentId === id) {
        setSelectedAssignmentId(filtered.length > 0 ? filtered[0].id : null);
      }
      return filtered;
    });
  };

  const processAll = async () => {
    let finalAnswerText = answerText;
    setError(null);

    if (answerType === 'image' && answerImage && !finalAnswerText.trim()) {
      setIsProcessingAnswer(true);
      try {
        finalAnswerText = await ocrHandwrittenAnswer(answerImage.preview, "image/jpeg");
        setAnswerText(finalAnswerText);
      } catch (err: any) {
        console.error("Answer OCR failed", err);
        setError(err.message || "答案标准内容提取错误，请尝试手动输入");
        setIsProcessingAnswer(false);
        return;
      }
      setIsProcessingAnswer(false);
    }

    if (!finalAnswerText.trim()) {
      setError("请先在左侧输入或上传标准答案内容。");
      return;
    }

    for (const assignment of assignments) {
      if (assignment.status === 'completed') continue;

      setAssignments(prev => prev.map(a => a.id === assignment.id ? { ...a, status: 'processing' } : a));

      try {
        const results = await correctAssignment(assignment.preview, "image/jpeg", finalAnswerText);
        
        // Draw checkmarks and crosses directly onto the student's submission sheet
        const markedImage = await drawMarksOnImage(assignment.preview, results);

        setAssignments(prev => prev.map(a => a.id === assignment.id ? { 
          ...a, 
          status: 'completed', 
          results,
          markedImage
        } : a));
      } catch (err: any) {
        console.error("Correction failed for", assignment.file.name, err);
        setError(`批改出错 (${assignment.file.name}): ${err.message}`);
        setAssignments(prev => prev.map(a => a.id === assignment.id ? { ...a, status: 'error' } : a));
      }
    }
  };

  const calculateScores = (results: CorrectionItem[]) => {
    let score = 0;
    let maxScore = results.length;
    results.forEach(item => {
      if (item.spellingCorrect) score += 0.5;
      if (item.posCorrect) score += 0.25;
      if (item.meaningCorrect) score += 0.25;
    });
    return { score, maxScore };
  };

  const drawMarksOnImage = (imageSrc: string, results: CorrectionItem[]): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(imageSrc);

        ctx.drawImage(img, 0, 0);

        results.forEach(res => {
          // If the item has a bounding box, draw it
          if (res.boundingBox && res.boundingBox.length > 0) {
            res.boundingBox.forEach(box => {
              const [ymin, xmin, ymax, xmax] = box.box_2d;
              const y = (ymin / 1000) * img.height;
              const x = (xmin / 1000) * img.width;
              const h = ((ymax - ymin) / 1000) * img.height;
              const w = ((xmax - xmin) / 1000) * img.width;

              const centerX = x + w / 2;
              const centerY = y + h / 2;
              const size = Math.max(15, Math.min(w, h, img.width * 0.05));

              if (res.isCorrect) {
                // Draw a beautiful green checkmark (勾)
                ctx.strokeStyle = '#22c55e';
                ctx.lineWidth = Math.max(4, img.width / 150);
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(centerX - size / 2, centerY);
                ctx.lineTo(centerX - size / 6, centerY + size / 3);
                ctx.lineTo(centerX + size / 2, centerY - size / 3);
                ctx.stroke();
              } else {
                // Draw an expressive red cross (叉)
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = Math.max(4, img.width / 150);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(centerX - size / 2, centerY - size / 2);
                ctx.lineTo(centerX + size / 2, centerY + size / 2);
                ctx.moveTo(centerX + size / 2, centerY - size / 2);
                ctx.lineTo(centerX - size / 2, centerY + size / 2);
                ctx.stroke();
              }
            });
          }
        });

        // DRAW HANDWRITTEN SCORE MARKER IN RED (Teacher's classic ink mark)
        if (results && results.length > 0) {
          const { score, maxScore } = calculateScores(results);
          ctx.strokeStyle = '#ef4444';
          ctx.fillStyle = '#ef4444';
          const scoreString = `${score.toFixed(2).replace(/\.00$/, '')} / ${maxScore}`;
          const fontSize = Math.max(26, Math.round(img.width * 0.045));
          ctx.font = `bold ${fontSize}px "Comic Sans MS", Arial, sans-serif`;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'top';

          const paddingRight = Math.max(30, img.width * 0.06);
          const paddingTop = Math.max(30, img.height * 0.05);
          ctx.fillText(`得分: ${scoreString}`, img.width - paddingRight, paddingTop);

          // Draw an elliptic hand-drawn circle around the score
          ctx.lineWidth = Math.max(3, img.width / 200);
          ctx.beginPath();
          const ellipseX = img.width - paddingRight - (fontSize * 1.5);
          const ellipseY = paddingTop + (fontSize * 0.6);
          const radiusX = fontSize * 2.2;
          const radiusY = fontSize * 0.9;
          
          if (ctx.ellipse) {
            ctx.ellipse(ellipseX, ellipseY, radiusX, radiusY, -0.06, 0, 2 * Math.PI);
          } else {
            ctx.arc(ellipseX, ellipseY, radiusX, 0, 2 * Math.PI);
          }
          ctx.stroke();
        }

        resolve(canvas.toDataURL('image/jpeg', 0.95));
      };
      img.src = imageSrc;
    });
  };

  const downloadResult = (assignment: Assignment) => {
    if (!assignment.markedImage) return;
    const link = document.createElement('a');
    link.href = assignment.markedImage;
    link.download = `批改结果_${assignment.file.name}`;
    link.click();
  };

  const toggleItemExpansion = (assignmentId: string) => {
    setExpandedItems(prev => ({
      ...prev,
      [assignmentId]: !prev[assignmentId]
    }));
  };

  const selectedAssignment = assignments.find(a => a.id === selectedAssignmentId);

  return (
    <div className="min-h-screen bg-[#faf9fe] text-[#2c1b4d] font-sans">
      {/* Top Banner Accent */}
      <div className="h-2 bg-gradient-to-r from-violet-600 via-amber-400 to-fuchsia-600 w-full" />

      <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8">
        
        {/* Header - Unified with Purple & Gold Theme */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-gradient-to-r from-violet-950 via-purple-900 to-violet-950 text-white rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden border-b-4 border-amber-400">
          <div className="absolute top-0 right-0 w-64 h-64 bg-violet-600/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute top-0 left-1/3 w-32 h-32 bg-amber-400/10 rounded-full blur-2xl pointer-events-none" />
          
          <div className="flex items-start gap-4">
            <div className="p-3.5 bg-amber-400 text-violet-950 rounded-2xl shadow-lg inline-flex mt-1">
              <GraduationCap className="w-8 h-8 font-black" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-widest bg-amber-400/20 text-amber-300 px-3 py-1 rounded-full border border-amber-400/30">
                  AI 智能辅导智能版
                </span>
              </div>
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mt-1 bg-gradient-to-r from-white via-yellow-250 to-amber-200 bg-clip-text text-transparent">
                听写成绩自动批改系统
              </h1>
              <p className="text-violet-200/80 text-sm mt-1 max-w-xl">
                高精度 OCR 智能识别手写文件。一键核对 <span className="text-amber-300 font-semibold underline decoration-wavy">英文拼写</span>、<span className="text-amber-300 font-semibold underline decoration-wavy">词性</span> 与 <span className="text-amber-300 font-semibold underline decoration-wavy">中文意思</span> 共三项内容，自动生成高清批改卷面。
              </p>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <button 
              onClick={() => {
                setTempApiKey(apiKey);
                setShowApiKeyModal(true);
              }}
              className={`px-5 py-3 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 border shadow-md transform active:scale-95 text-xs ${
                apiKey 
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/50 hover:bg-emerald-500/20' 
                : 'bg-amber-400/10 text-amber-300 border-amber-400/45 hover:bg-amber-400/25'
              }`}
            >
              <Key className="w-4 h-4 shrink-0" />
              {apiKey ? 'API密钥已配置 (本地安全瞬度)' : '配置 API 密钥'}
            </button>

            <button 
              onClick={processAll}
              disabled={assignments.length === 0 || isProcessingAnswer}
              className="px-8 py-3.5 bg-amber-400 hover:bg-amber-300 text-violet-950 font-bold rounded-2xl transition-all shadow-lg shadow-amber-400/15 hover:shadow-amber-400/30 disabled:bg-violet-90030 disabled:text-violet-400/60 disabled:shadow-none flex items-center justify-center gap-2 transform active:scale-95 whitespace-nowrap"
            >
              {isProcessingAnswer ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5 text-violet-950 fill-current" />}
              全部一键批改
            </button>
          </div>
        </header>

        {/* Error Alert bar */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 rounded-2xl flex items-start justify-between shadow-sm"
            >
              <div className="flex gap-3">
                <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-sm">操作提示错误</h4>
                  <p className="text-xs mt-0.5">{error}</p>
                </div>
              </div>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-700 p-1 rounded-lg transition-colors">
                <Plus className="w-5 h-5 rotate-45" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Core Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Set answer + file manager (4/12) */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* 1. Set Standard Answer */}
            <section className="bg-white border border-violet-100 rounded-3xl p-6 shadow-sm space-y-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between border-b border-violet-50 pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center">1</span>
                  <h3 className="font-bold text-violet-950 text-base flex items-center gap-1.5">
                    设置标准答案
                  </h3>
                </div>
                <div className="flex bg-violet-50 rounded-xl p-1 border border-violet-100">
                  <button 
                    onClick={() => setAnswerType('text')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${answerType === 'text' ? 'bg-violet-600 text-white shadow-sm' : 'text-violet-400 hover:text-violet-700'}`}
                  >
                    <Type className="w-3.5 h-3.5" />
                    文本输入
                  </button>
                  <button 
                    onClick={() => setAnswerType('image')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${answerType === 'image' ? 'bg-violet-600 text-white shadow-sm' : 'text-violet-400 hover:text-violet-700'}`}
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    手写识别
                  </button>
                </div>
              </div>

              {answerType === 'text' ? (
                <div className="space-y-2">
                  <textarea 
                    value={answerText}
                    onChange={(e) => setAnswerText(e.target.value)}
                    placeholder="请输入本轮听写标准答案，例如：&#10;1. spelling n. 拼写&#10;2. correct v. 纠正&#10;3. purple adj. 紫色的"
                    className="w-full h-40 p-4 bg-violet-50/30 border border-violet-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-violet-400 text-sm text-violet-950 placeholder-violet-400/85 resize-none font-medium transition-all"
                  />
                  <div className="text-[11px] text-violet-550 flex items-center gap-1 bg-violet-50/50 p-2 rounded-xl">
                    <BookOpen className="w-3.5 h-3.5 text-violet-500" />
                    支持多项标准录入，格式支持中文与词性
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div 
                    onClick={() => !isProcessingAnswer && answerInputRef.current?.click()}
                    className="w-full aspect-video border-2 border-dashed border-violet-300/60 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:bg-violet-50/30 hover:border-violet-400 transition-all overflow-hidden bg-violet-50/10 group"
                  >
                    {isProcessingAnswer ? (
                      <div className="p-4 text-center space-y-2">
                        <Loader2 className="w-8 h-8 animate-spin text-violet-600 inline-flex" />
                        <p className="text-xs font-semibold text-violet-950">智能提取/识别标准答案中...</p>
                      </div>
                    ) : answerImage ? (
                      <div className="relative w-full h-full group">
                        <img src={answerImage.preview} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1">
                          <Check className="w-4 h-4" /> 更换答案 PDF / 图片
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 text-center space-y-2">
                        <div className="p-3 bg-violet-50 rounded-full inline-flex text-violet-600 group-hover:scale-110 transition-transform">
                          <Upload className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-violet-950">上传手写老师答案 (PDF/图片)</p>
                          <p className="text-[10px] text-violet-400 mt-1">能识别 PDF 多页首版，提取词句要素</p>
                        </div>
                      </div>
                    )}
                    <input 
                      type="file" 
                      ref={answerInputRef} 
                      className="hidden" 
                      accept="application/pdf, image/*" 
                      onChange={handleAnswerImageUpload} 
                    />
                  </div>
                  
                  {answerText && (
                    <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200/50">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Languages className="w-4 h-4 text-amber-600" />
                        <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">自动识别出的答案内容:</span>
                      </div>
                      <pre className="text-xs font-mono text-amber-900 bg-white/60 p-2.5 rounded-xl border border-amber-100 max-h-32 overflow-y-auto whitespace-pre-wrap">
                        {answerText}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </section>
 
            {/* 2. Upload Student Dictations list */}
            <section className="bg-white border border-violet-100 rounded-3xl p-6 shadow-sm space-y-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between border-b border-violet-50 pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center">2</span>
                  <h3 className="font-bold text-violet-950 text-base">
                    上传听写作业
                  </h3>
                </div>
                <span className="text-xs bg-violet-100 text-violet-750 font-semibold px-2.5 py-1 rounded-full">
                  已加 {assignments.length} 份
                </span>
              </div>
 
              <div className="space-y-2">
                <button 
                  onClick={() => !isConvertingPdf && assignmentInputRef.current?.click()}
                  disabled={isConvertingPdf}
                  className="w-full py-4.5 border-2 border-dashed border-violet-200 hover:border-violet-400 rounded-2xl flex flex-col items-center justify-center gap-2 hover:bg-violet-50/20 active:scale-[0.98] transition-all text-violet-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConvertingPdf ? (
                    <>
                      <Loader2 className="w-6 h-6 animate-spin text-violet-600" />
                      <span className="text-xs font-bold text-violet-950">正在提取 PDF 扫描件页面...</span>
                      <span className="text-[10px] text-violet-400">我们将多页扫描文件智能解析为独立听写卷</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-6 h-6 p-1 bg-violet-100 rounded-full text-violet-700" />
                      <span className="text-xs font-bold text-violet-950">添加多页 PDF 扫描件或图片</span>
                      <span className="text-[10px] text-violet-400">支持批量选择（自适应提取多页内容）</span>
                    </>
                  )}
                </button>
                <input 
                  type="file" 
                  ref={assignmentInputRef} 
                  className="hidden" 
                  multiple 
                  accept="application/pdf, image/*" 
                  onChange={handleAssignmentUpload} 
                />
              </div>

              {/* Assignment stack view */}
              {assignments.length > 0 && (
                <div className="max-h-56 overflow-y-auto space-y-2 pr-1 pt-1">
                  {assignments.map(item => (
                    <div 
                      key={item.id}
                      onClick={() => setSelectedAssignmentId(item.id)}
                      className={`p-3 rounded-2xl flex items-center justify-between border cursor-pointer transition-all ${selectedAssignmentId === item.id ? 'border-violet-500 bg-violet-50/40 shadow-sm' : 'border-violet-100 bg-white hover:bg-violet-50/10'}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl overflow-hidden bg-violet-100 shrink-0 border border-violet-200">
                          <img src={item.preview} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        </div>
                        <div className="min-w-0 pr-2">
                          <p className="text-xs font-semibold truncate text-violet-950">{item.file.name}</p>
                          <div className="flex items-center gap-2 text-[10px] whitespace-nowrap">
                            <span className="text-violet-400">{(item.file.size / 1024).toFixed(0)} KB</span>
                            {item.status === 'completed' && item.results && (
                              <span className="text-emerald-700 font-extrabold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 shrink-0">
                                得分: {(() => {
                                  const { score } = calculateScores(item.results);
                                  return score.toFixed(2).replace(/\.00$/, '');
                                })()}分
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.status === 'processing' && (
                          <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
                        )}
                        {item.status === 'completed' && (
                          <CheckCircle2 className="w-4 h-4 text-violet-500 fill-violet-100" />
                        )}
                        <button 
                          onClick={(e) => removeAssignment(item.id, e)}
                          className="p-1.5 text-violet-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Right Column: Corrected outputs with detailed dimensions (8/12) */}
          <div className="lg:col-span-8 space-y-6">
            
            <section className="bg-white border border-violet-100 rounded-3xl p-6 shadow-sm min-h-[500px] flex flex-col justify-between">
              
              {/* Toolbar */}
              <div className="flex items-center justify-between border-b border-violet-50 pb-4 mb-4">
                <div>
                  <h3 className="font-extrabold text-violet-950 text-lg flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-violet-600" />
                    试卷批改结果 & 细则
                  </h3>
                  <p className="text-xs text-violet-400 mt-0.5">
                    选中作业后可查看 拼写、词性、词义 三重细目
                  </p>
                </div>
                {selectedAssignment && selectedAssignment.status === 'completed' && (
                  <button 
                    onClick={() => downloadResult(selectedAssignment)}
                    className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-violet-950 text-xs font-extrabold rounded-xl transition-all shadow-md flex items-center gap-1.5 transform active:scale-95"
                  >
                    <Download className="w-4 h-4 font-bold" />
                    从卷面下载结果
                  </button>
                )}
              </div>

              {/* No selected assignment fallback */}
              {!selectedAssignment ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                  <div className="w-16 h-16 bg-violet-50 rounded-full flex items-center justify-center text-violet-400 mb-4 animate-bounce">
                    <FileText className="w-8 h-8" />
                  </div>
                  <h4 className="font-bold text-violet-950 text-base">系统暂无待阅听写卡</h4>
                  <p className="text-xs text-violet-400 mt-1 max-w-sm">
                    请在左侧首先设置标准答案，然后点击“添加多份手写图片”按钮，加载学生们的图片进行智能分析。
                  </p>
                </div>
              ) : (
                <div className="space-y-6 flex-1 flex flex-col">
                  
                  {/* Selected Item header */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 bg-violet-50/50 rounded-2xl gap-3">
                    <div className="min-w-0">
                      <span className="text-[10px] font-bold text-violet-600 bg-violet-100/80 px-2 py-0.5 rounded-md">
                        当前选中试卷
                      </span>
                      <h4 className="font-bold text-violet-950 text-sm truncate mt-1">
                        {selectedAssignment.file.name}
                      </h4>
                    </div>
                    
                    {/* Status badges */}
                    <div className="flex items-center gap-2 shrink-0">
                      {selectedAssignment.status === 'idle' && (
                        <span className="text-xs bg-amber-100 text-amber-800 font-bold px-3 py-1 rounded-full">
                          排队就绪
                        </span>
                      )}
                      {selectedAssignment.status === 'processing' && (
                        <div className="text-xs bg-violet-600 text-white font-bold px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          正在识别整卷细节中...
                        </div>
                      )}
                      {selectedAssignment.status === 'completed' && selectedAssignment.results && (
                        <div className="flex gap-2">
                          <span className="text-xs bg-emerald-100 border border-emerald-200 text-emerald-800 font-bold px-3 py-1 rounded-full">
                            成功批改 : 对 {selectedAssignment.results.filter(r => r.isCorrect).length} 错 {selectedAssignment.results.filter(r => !r.isCorrect).length}
                          </span>
                        </div>
                      )}
                      {selectedAssignment.status === 'error' && (
                        <span className="text-xs bg-red-100 text-red-700 font-bold px-3 py-1 rounded-full">
                          识别批改失败
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Dynamic Score Calculator Dashboard */}
                  {selectedAssignment.status === 'completed' && selectedAssignment.results && (() => {
                    const { score, maxScore } = calculateScores(selectedAssignment.results);
                    const totalItems = selectedAssignment.results.length;
                    const spellingCorrectCount = selectedAssignment.results.filter(r => r.spellingCorrect).length;
                    const posCorrectCount = selectedAssignment.results.filter(r => r.posCorrect).length;
                    const meaningCorrectCount = selectedAssignment.results.filter(r => r.meaningCorrect).length;
                    
                    const spellingAccuracy = totalItems ? Math.round((spellingCorrectCount / totalItems) * 100) : 0;
                    const posAccuracy = totalItems ? Math.round((posCorrectCount / totalItems) * 100) : 0;
                    const meaningAccuracy = totalItems ? Math.round((meaningCorrectCount / totalItems) * 100) : 0;
                    
                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-4 bg-gradient-to-br from-violet-600 via-indigo-650 to-purple-700 text-white rounded-2xl shadow-sm border border-violet-500/10 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-xl pointer-events-none" />
                        
                        {/* Score display */}
                        <div className="flex flex-col items-center justify-center bg-white/10 backdrop-blur-md rounded-xl p-3 text-center border border-white/10">
                          <span className="text-[10px] text-amber-300 font-extrabold uppercase tracking-widest">听写得分</span>
                          <span className="text-3xl font-black text-white mt-0.5">{score.toFixed(2).replace(/\.00$/, '')}</span>
                          <span className="text-[9px] text-violet-200 mt-0.5 font-bold">满分: {maxScore}分</span>
                        </div>

                        {/* Spelling Stat */}
                        <div className="bg-white/5 rounded-xl p-3 flex flex-col justify-between">
                          <div className="flex justify-between items-center text-[10px] text-violet-200">
                            <span className="font-bold">拼写 (得0.5分)</span>
                            <span className="font-extrabold text-amber-300 text-xs">{spellingAccuracy}%</span>
                          </div>
                          <div className="mt-1 text-sm font-black flex items-baseline gap-1">
                            <span>{spellingCorrectCount} / {totalItems}</span>
                            <span className="text-[10px] text-violet-300 font-normal">对</span>
                          </div>
                          <div className="text-[10px] text-emerald-300 font-bold mt-1">
                            +{(spellingCorrectCount * 0.5).toFixed(2).replace(/\.00$/, '')}分
                          </div>
                        </div>

                        {/* Part of speech Stat */}
                        <div className="bg-white/5 rounded-xl p-3 flex flex-col justify-between">
                          <div className="flex justify-between items-center text-[10px] text-violet-200">
                            <span className="font-bold">词性 (得0.25分)</span>
                            <span className="font-extrabold text-amber-300 text-xs">{posAccuracy}%</span>
                          </div>
                          <div className="mt-1 text-sm font-black flex items-baseline gap-1">
                            <span>{posCorrectCount} / {totalItems}</span>
                            <span className="text-[10px] text-violet-300 font-normal">对</span>
                          </div>
                          <div className="text-[10px] text-emerald-300 font-bold mt-1">
                            +{(posCorrectCount * 0.25).toFixed(2).replace(/\.00$/, '')}分
                          </div>
                        </div>

                        {/* Meaning Stat */}
                        <div className="bg-white/5 rounded-xl p-3 flex flex-col justify-between">
                          <div className="flex justify-between items-center text-[10px] text-violet-200">
                            <span className="font-bold">中文 (得0.25分)</span>
                            <span className="font-extrabold text-amber-300 text-xs">{meaningAccuracy}%</span>
                          </div>
                          <div className="mt-1 text-sm font-black flex items-baseline gap-1">
                            <span>{meaningCorrectCount} / {totalItems}</span>
                            <span className="text-[10px] text-violet-300 font-normal">对</span>
                          </div>
                          <div className="text-[10px] text-emerald-300 font-bold mt-1">
                            +{(meaningCorrectCount * 0.25).toFixed(2).replace(/\.00$/, '')}分
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Split visualizer */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
                    
                    {/* Visual paper preview */}
                    <div className="space-y-2 flex flex-col">
                      <span className="text-xs font-bold text-violet-600 flex items-center gap-1.5">
                        <ImageIcon className="w-4 h-4 text-violet-500" />
                        批改成品高清预览
                      </span>
                      <div className="relative border border-violet-100 rounded-2xl bg-violet-50 overflow-hidden flex-1 min-h-[350px] max-h-[500px] flex items-center justify-center">
                        <img 
                          src={selectedAssignment.markedImage || selectedAssignment.preview} 
                          className="w-full h-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                        {selectedAssignment.status === 'processing' && (
                          <div className="absolute inset-0 bg-violet-950/45 flex flex-col items-center justify-center text-white p-4">
                            <Loader2 className="w-10 h-10 animate-spin text-amber-400 mb-2" />
                            <p className="text-sm font-bold">请稍候</p>
                            <p className="text-xs text-violet-200 mt-1">正在逐个核对英文、词性与中文义项...</p>
                          </div>
                        )}
                        {selectedAssignment.status === 'completed' && (
                          <div className="absolute bottom-3 left-3 bg-violet-950/80 backdrop-blur-md px-3 py-1.5 rounded-lg text-[10px] text-amber-400 font-bold flex items-center gap-1 select-none">
                            <Check className="w-3.5 h-3.5" />
                            绿勾与红叉标记已写入图层，支持保存导出！
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Detailed correction itemized dimensions (Spelling, Part of Speech, Meaning) */}
                    <div className="space-y-2 flex flex-col">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-violet-600 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-violet-500" />
                          三项详细批改（英文、词性、意思）
                        </span>
                        
                        {selectedAssignment.status === 'completed' && (
                          <button 
                            onClick={() => toggleItemExpansion(selectedAssignment.id)}
                            className="text-xs text-violet-600 hover:text-violet-800 font-bold flex items-center gap-0.5"
                          >
                            {expandedItems[selectedAssignment.id] ? "收起详情" : "展开详情"}
                            {expandedItems[selectedAssignment.id] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>

                      <div className="border border-violet-100 rounded-2xl bg-white/50 p-3 overflow-y-auto flex-1 max-h-[500px] space-y-3">
                        {selectedAssignment.status !== 'completed' ? (
                          <div className="h-full flex flex-col items-center justify-center text-center text-violet-400 p-8">
                            <BookOpen className="w-8 h-8 opacity-20 mb-2" />
                            <p className="text-xs">等待整卷批改完成后，此栏将呈递每一行英文、词性与中文的精准评价详情。</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {selectedAssignment.results?.map((item) => {
                              const isAllCorrect = item.spellingCorrect && item.posCorrect && item.meaningCorrect;
                              const itemSpellingScore = item.spellingCorrect ? 0.5 : 0;
                              const itemPosScore = item.posCorrect ? 0.25 : 0;
                              const itemMeaningScore = item.meaningCorrect ? 0.25 : 0;
                              const itemTotalScore = itemSpellingScore + itemPosScore + itemMeaningScore;

                              return (
                                <div 
                                  key={item.itemIndex} 
                                  className={`p-3.5 rounded-2xl border transition-all ${isAllCorrect ? 'bg-emerald-50/20 border-emerald-100' : 'bg-red-50/10 border-red-100/60'}`}
                                >
                                  {/* Item brief summary */}
                                  <div className="flex items-center justify-between pb-2 border-b border-violet-50">
                                    <div className="flex items-center gap-2">
                                      <span className={`w-5 h-5 rounded-md text-[10px] font-bold flex items-center justify-center ${isAllCorrect ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'}`}>
                                        {item.itemIndex}
                                      </span>
                                      <span className="text-xs font-extrabold text-violet-950">
                                        学生版: "{item.spellingActual || '(未写)'}"
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${itemTotalScore === 1 ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : itemTotalScore > 0 ? 'bg-amber-100 text-amber-800 border border-amber-250' : 'bg-red-100 text-red-800 border border-red-200'}`}>
                                        得分: {itemTotalScore} / 1 分
                                      </span>
                                      {isAllCorrect ? (
                                        <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold flex items-center gap-0.5">
                                          <Check className="w-3 h-3" /> 完美全对
                                        </span>
                                      ) : (
                                        <span className="text-[10px] bg-red-100 text-red-800 px-2 py-0.5 rounded-full font-bold flex items-center gap-0.5">
                                          <X className="w-3 h-3" /> 存在失误
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Triple Criterion Breakdown Grid */}
                                  <div className="grid grid-cols-3 gap-2 pt-2.5 font-sans">
                                    
                                    {/* 1. English Spelling */}
                                    <div className={`p-2 rounded-xl text-center space-y-1 relative ${item.spellingCorrect ? 'bg-emerald-50/40 text-emerald-850' : 'bg-red-50/40 text-red-800'}`}>
                                      <div className="flex justify-between items-center px-1 text-[9px] text-violet-400 font-semibold">
                                        <span>英文拼写</span>
                                        <span className={item.spellingCorrect ? 'text-emerald-600 font-bold' : 'text-red-500'}>
                                          +{itemSpellingScore}
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-center gap-1 py-0.5">
                                        {item.spellingCorrect ? (
                                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 fill-emerald-50" />
                                        ) : (
                                          <XCircle className="w-3.5 h-3.5 text-red-500 fill-red-50" />
                                        )}
                                        <p className="text-xs font-bold truncate max-w-full">
                                          {item.spellingExpected}
                                        </p>
                                      </div>
                                      {!item.spellingCorrect && item.spellingActual && (
                                        <p className="text-[9px] line-through text-red-400">
                                          写为: {item.spellingActual}
                                        </p>
                                      )}
                                    </div>

                                    {/* 2. Part of Speech */}
                                    <div className={`p-2 rounded-xl text-center space-y-1 relative ${item.posCorrect ? 'bg-emerald-50/40 text-emerald-850' : 'bg-red-50/40 text-red-800'}`}>
                                      <div className="flex justify-between items-center px-1 text-[9px] text-violet-400 font-semibold">
                                        <span>词性</span>
                                        <span className={item.posCorrect ? 'text-emerald-600 font-bold' : 'text-red-500'}>
                                          +{itemPosScore}
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-center gap-1 py-0.5">
                                        {item.posCorrect ? (
                                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 fill-emerald-50" />
                                        ) : (
                                          <XCircle className="w-3.5 h-3.5 text-red-500 fill-red-50" />
                                        )}
                                        <p className="text-xs font-bold truncate max-w-full">
                                          {item.posExpected || '(无)'}
                                        </p>
                                      </div>
                                      {!item.posCorrect && item.posActual && (
                                        <p className="text-[9px] line-through text-red-400">
                                          写为: {item.posActual}
                                        </p>
                                      )}
                                    </div>

                                    {/* 3. Chinese Meaning */}
                                    <div className={`p-2 rounded-xl text-center space-y-1 relative ${item.meaningCorrect ? 'bg-emerald-50/40 text-emerald-850' : 'bg-red-50/40 text-red-800'}`}>
                                      <div className="flex justify-between items-center px-1 text-[9px] text-violet-400 font-semibold">
                                        <span>中文意思</span>
                                        <span className={item.meaningCorrect ? 'text-emerald-600 font-bold' : 'text-red-500'}>
                                          +{itemMeaningScore}
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-center gap-1 py-0.5">
                                        {item.meaningCorrect ? (
                                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 fill-emerald-50" />
                                        ) : (
                                          <XCircle className="w-3.5 h-3.5 text-red-500 fill-red-50" />
                                        )}
                                        <p className="text-xs font-bold truncate max-w-full">
                                          {item.meaningExpected}
                                        </p>
                                      </div>
                                      {!item.meaningCorrect && item.meaningActual && (
                                        <p className="text-[9px] line-through text-red-400">
                                          写为: {item.meaningActual}
                                        </p>
                                      )}
                                    </div>

                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                  </div>
                </div>
              )}
              
            </section>
          </div>

        </div>
      </div>

      {/* API Key Configuration Modal Dialog */}
      <AnimatePresence>
        {showApiKeyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowApiKeyModal(false)}
              className="absolute inset-0 bg-violet-950/60 backdrop-blur-sm"
            />
            
            {/* Modal Box */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white rounded-3xl p-6 shadow-2xl relative w-full max-w-lg border border-violet-100 z-10 space-y-4 font-sans"
            >
              <div className="flex items-center justify-between border-b border-violet-50 pb-3">
                <h3 className="font-extrabold text-violet-950 text-base flex items-center gap-2">
                  <Key className="w-5 h-5 text-violet-600" />
                  配置 Gemini API 密钥
                </h3>
                <button 
                  onClick={() => setShowApiKeyModal(false)}
                  className="text-violet-400 hover:text-violet-600 p-1.5 rounded-lg hover:bg-violet-50 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-violet-500 leading-relaxed font-medium">
                  为保障您的信息安全，您的 API 密钥将<strong>仅直接从您当前的浏览器本地（localStorage）发起 AI 图像与文本识别请求</strong>。
                  不经过任何中转服务器或后端数据库，绝对不必担心泄漏，您可以随时自由清除此配置。
                </p>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-violet-950 block">Gemini API 密钥</label>
                  <input 
                    type="password"
                    value={tempApiKey}
                    onChange={(e) => setTempApiKey(e.target.value)}
                    placeholder="请输入以 AIzaSy... 开头的 Gemini API Key"
                    className="w-full p-3 bg-violet-50/50 border border-violet-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400 text-sm font-mono text-violet-950 placeholder-violet-400 transition-all shadow-inner"
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] bg-amber-50 rounded-xl p-3 border border-amber-200/40 text-amber-800">
                  <span>
                    还没有 API Key？您可以前往{" "}
                    <a 
                      href="https://aistudio.google.com/" 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="underline font-bold hover:text-amber-900"
                    >
                      Google AI Studio
                    </a>{" "}
                    免费申请获取。
                  </span>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2 border-t border-violet-50">
                {apiKey && (
                  <button 
                    onClick={clearApiKey}
                    className="px-4 py-2 border border-red-200 hover:bg-red-50 text-red-600 text-xs font-bold rounded-xl transition-all"
                  >
                    清除已有密钥
                  </button>
                )}
                <button 
                  onClick={() => setShowApiKeyModal(false)}
                  className="px-4 py-2 bg-violet-50 hover:bg-violet-100 text-violet-750 text-xs font-bold rounded-xl transition-all"
                >
                  关闭
                </button>
                <button 
                  onClick={saveApiKey}
                  className="px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-xl transition-all shadow-md active:scale-95"
                >
                  保存并生效
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .bg-violet-950 { background-color: #2c105c; }
        .text-violet-950 { color: #2c105c; }
        .text-violet-750 { color: #43217b; }
        .text-violet-550 { color: #6b43b6; }
        .border-violet-100 { border-color: #f1ecf9; }
        .border-violet-200 { border-color: #e5daf3; }
        .bg-violet-50 { background-color: #faf6ff; }
        .text-violet-400 { color: #9c89c8; }
        .text-yellow-250 { color: #fef08a; }
      `}</style>
    </div>
  );
}

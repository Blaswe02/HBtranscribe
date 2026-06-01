import React, { useState, useRef, useEffect, useMemo } from 'react';
import { TranscriptionResult, TranscriptionMode } from '../types';
import { Copy, Check, FileText, Sparkles, ListChecks, Download, ChevronDown, FileJson, FileCode, FileType, List, ClipboardList, Zap, RefreshCw, AlignLeft, Clock } from 'lucide-react';
import { generateView } from '../services/geminiService';

interface ResultDisplayProps {
  result: TranscriptionResult;
  mode: TranscriptionMode;
}

type ViewType = 'transcript' | 'minutes' | 'actionPoints' | 'shortSummary';
type TemplateType = 'standard' | 'sto-ijzk';

export const ResultDisplay: React.FC<ResultDisplayProps> = React.memo(({ result: initialResult, mode }) => {
  const [result, setResult] = useState<TranscriptionResult>(initialResult);
  const [activeTab, setActiveTab] = useState<ViewType>('transcript');
  const [templateType, setTemplateType] = useState<TemplateType>('standard');
  const [copied, setCopied] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const downloadMenuRef = useRef<HTMLDivElement>(null);

  // Sync with prop updates
  useEffect(() => {
    setResult(initialResult);
  }, [initialResult]);

  // When template type changes, clear cached minutes so it regenerates
  useEffect(() => {
    setResult(prev => ({ ...prev, minutes: undefined as any }));
    setGenerationError(null);
  }, [templateType]);

  // Lazy generation
  useEffect(() => {
    const generateIfNeeded = async () => {
      const needsGeneration =
        (activeTab === 'minutes' && !result.minutes) ||
        (activeTab === 'actionPoints' && !result.actionPoints) ||
        (activeTab === 'shortSummary' && !result.shortSummary);

      if (!needsGeneration) return;

      setIsGenerating(true);
      setGenerationError(null);
      try {
        if (activeTab === 'minutes') {
          const minutes = await generateView('minutes', result.transcript, undefined, undefined, templateType);
          setResult(prev => ({ ...prev, minutes }));
        } else if (activeTab === 'actionPoints') {
          const actionPoints = await generateView('actionPoints', result.transcript);
          setResult(prev => ({ ...prev, actionPoints }));
        } else if (activeTab === 'shortSummary') {
          const shortSummary = await generateView('shortSummary', result.transcript);
          setResult(prev => ({ ...prev, shortSummary }));
        }
      } catch (err: any) {
        setGenerationError(err?.message ?? "Genereren mislukt. Probeer het opnieuw.");
      } finally {
        setIsGenerating(false);
      }
    };

    generateIfNeeded();
  }, [activeTab, result.transcript, result.minutes, result.actionPoints, result.shortSummary, templateType]);

  // Close download menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(event.target as Node)) {
        setShowDownloadMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCopy = () => {
    const textToCopy = (result as any)[activeTab] || "";
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = (content: string, fileName: string, contentType: string) => {
    const a = document.createElement("a");
    const file = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
    setShowDownloadMenu(false);
  };

  const exportAsTxt = () => {
    const currentText = (result as any)[activeTab] || "";
    downloadFile(currentText, `transcriptie-${activeTab}.txt`, 'text/plain');
    setShowDownloadMenu(false);
  };

  const exportAsMarkdown = () => {
    const currentText = (result as any)[activeTab] || "";
    const content = `# HB∞ Transcribe Assistant Export - ${activeTab}\n\n${currentText}`;
    downloadFile(content, `transcriptie-${activeTab}.md`, 'text/markdown');
    setShowDownloadMenu(false);
  };

  const exportWithTimestamps = () => {
    downloadFile(result.transcript, 'transcriptie-met-tijdstempels.txt', 'text/plain');
    setShowDownloadMenu(false);
  };

  const exportWithoutTimestamps = () => {
    const cleaned = result.transcript.replace(/\[\d{1,2}:\d{2}\]\s*/g, '').trim();
    downloadFile(cleaned, 'transcriptie-zonder-tijdstempels.txt', 'text/plain');
    setShowDownloadMenu(false);
  };

  const exportSummary = async () => {
    let summary = result.shortSummary;
    if (!summary) {
      setIsGenerating(true);
      try {
        summary = await generateView('shortSummary', result.transcript);
        setResult(prev => ({ ...prev, shortSummary: summary }));
      } catch (err) {
        console.error("Failed to generate summary for export:", err);
        return;
      } finally {
        setIsGenerating(false);
      }
    }
    if (summary) {
      downloadFile(summary, 'samenvatting.txt', 'text/plain');
    }
    setShowDownloadMenu(false);
  };

  const exportAsWord = () => {
    const text = (result as any)[activeTab] || "";
    const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const htmlLines = text.split('\n').map((line: string) => {
      if (!line.trim()) return '<p>&nbsp;</p>';
      if (/^\d+\./.test(line.trim())) return `<p><b>${escapeHtml(line)}</b></p>`;
      if (line.trim().startsWith('Besluiten:') || line.trim().startsWith('Actiepunten:')) return `<p><b>${escapeHtml(line)}</b></p>`;
      if (line.trim().startsWith('•') || line.trim().startsWith('➢')) return `<p style="margin-left:24pt">${escapeHtml(line)}</p>`;
      return `<p>${escapeHtml(line)}</p>`;
    }).join('');
    const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt}p{margin:4pt 0}</style></head><body>${htmlLines}</body></html>`;
    const blob = new Blob(['﻿', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notulen-${new Date().toISOString().split('T')[0]}.doc`;
    a.click();
    URL.revokeObjectURL(url);
    setShowDownloadMenu(false);
  };

  const exportAsJson = () => {
    const content = JSON.stringify({
      metadata: {
        exportedAt: new Date().toISOString(),
        tool: "HB∞ Transcribe Assistant",
        view: activeTab
      },
      ...result
    }, null, 2);
    downloadFile(content, 'transcriptie-volledig.json', 'application/json');
    setShowDownloadMenu(false);
  };

  const exportAsSrt = () => {
    // Basic SRT parser for [MM:SS] format
    const lines = result.transcript.split('\n');
    let srtContent = '';
    let counter = 1;

    const parseTime = (timeStr: string) => {
      const parts = timeStr.replace('[', '').replace(']', '').split(':');
      const mins = parts[0].padStart(2, '0');
      const secs = parts[1].padStart(2, '0');
      return `00:${mins}:${secs},000`;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const timeMatch = line.match(/^\[(\d{1,2}:\d{2})\]/);
      
      if (timeMatch) {
        const startTime = parseTime(timeMatch[1]);
        // Estimate end time as 5 seconds later or next line's start time
        let endTime = '00:00:00,000';
        const addFiveSeconds = (srtTime: string) => {
          const [, m, s] = srtTime.split(':').map(p => parseInt(p));
          const totalSecs = m * 60 + s + 5;
          const mm = Math.floor(totalSecs / 60).toString().padStart(2, '0');
          const ss = (totalSecs % 60).toString().padStart(2, '0');
          return `00:${mm}:${ss},000`;
        };
        if (i < lines.length - 1) {
          const nextMatch = lines[i+1].match(/^\[(\d{1,2}:\d{2})\]/);
          if (nextMatch) {
            endTime = parseTime(nextMatch[1]);
          } else {
            endTime = addFiveSeconds(startTime);
          }
        } else {
          endTime = addFiveSeconds(startTime);
        }

        const text = line.replace(/^\[\d{1,2}:\d{2}\]\s*/, '');
        srtContent += `${counter}\n${startTime} --> ${endTime}\n${text}\n\n`;
        counter++;
      }
    }

    if (!srtContent) {
      // Fallback if no timestamps found
      srtContent = `1\n00:00:00,000 --> 00:00:10,000\n${result.transcript}`;
    }

    downloadFile(srtContent, 'transcriptie.srt', 'text/plain');
    setShowDownloadMenu(false);
  };

  const currentText = (result as any)[activeTab] || "";
  const lines = useMemo(() => currentText.split('\n'), [currentText]);
  
  // Virtualization constants
  const LINE_HEIGHT = 44; // 28px (leading-7) + 16px (mb-4)
  const BUFFER = 20; // Number of lines to buffer above and below

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const visibleContent = useMemo(() => {
    if (!containerRef.current) return lines.map((line: string, i: number) => ({ line, index: i }));
    
    const viewportHeight = containerRef.current.clientHeight;
    const startIndex = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - BUFFER);
    const endIndex = Math.min(lines.length, Math.ceil((scrollTop + viewportHeight) / LINE_HEIGHT) + BUFFER);
    
    return lines.slice(startIndex, endIndex).map((line: string, i: number) => ({
      line,
      index: startIndex + i
    }));
  }, [lines, scrollTop]);

  const renderLine = (line: string) => {
    if (!line.trim()) return '\u00A0';
    
    // Regex to find [MM:SS] timestamps
    const timestampRegex = /^(\[\d{1,2}:\d{2}\])(.*)/;
    const match = line.match(timestampRegex);
    
    if (match) {
      return (
        <span className="flex items-start gap-3">
          <span className="text-[11px] font-mono text-slate-400 mt-1.5 flex-shrink-0 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
            {match[1]}
          </span>
          <span className="flex-grow">{match[2].trim()}</span>
        </span>
      );
    }
    
    return line;
  };

  const totalHeight = lines.length * LINE_HEIGHT;
  const offsetY = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - BUFFER) * LINE_HEIGHT;

  const tabs = [
    { id: 'transcript', label: 'Transcript', icon: FileText },
    { id: 'minutes', label: 'Notulen', icon: List },
    { id: 'actionPoints', label: 'Actiepunten', icon: ClipboardList },
  ] as const;

  const modeLabels: Record<TranscriptionMode, string> = {
    [TranscriptionMode.VERBATIM]: 'Woordelijk',
    [TranscriptionMode.READABLE]: 'Leesbaar',
    [TranscriptionMode.SUMMARY]: 'Samenvatting'
  };

  return (
    <div className="w-full max-w-4xl mx-auto bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Header / Tabs */}
      <div className="flex flex-wrap border-b border-slate-100 bg-slate-50">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as ViewType);
                if (containerRef.current) containerRef.current.scrollTop = 0;
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-4 px-4 text-sm font-medium transition-colors duration-200 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${
                isActive
                  ? 'bg-white text-blue-700 border-t-2 border-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
              <span className="whitespace-nowrap">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex justify-between items-center px-6 py-3 border-b border-slate-100 bg-white">
        <div className="text-xs font-mono text-slate-400 uppercase tracking-wide flex items-center gap-2">
          {activeTab === 'transcript' ? modeLabels[mode] : 'Analyse'} Modus
          {isGenerating && (
            <span className="flex items-center gap-1 text-blue-500 animate-pulse">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Genereren...
            </span>
          )}
        </div>

        {activeTab === 'minutes' && (
          <div className="flex items-center gap-1 text-xs rounded-lg border border-slate-200 overflow-hidden">
            <button
              onClick={() => setTemplateType('standard')}
              disabled={isGenerating}
              className={`px-3 py-1.5 font-medium transition-colors ${
                templateType === 'standard'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Vergadernotulen
            </button>
            <button
              onClick={() => setTemplateType('sto-ijzk')}
              disabled={isGenerating}
              className={`px-3 py-1.5 font-medium transition-colors ${
                templateType === 'sto-ijzk'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              STO IJZK
            </button>
          </div>
        )}
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            disabled={isGenerating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors disabled:opacity-50"
            title="Kopieer naar klembord"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-green-600" />
                <span className="text-green-700">Gekopieerd</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Kopiëren</span>
              </>
            )}
          </button>

          <div className="relative" ref={downloadMenuRef}>
            <button
              onClick={() => setShowDownloadMenu(!showDownloadMenu)}
              disabled={isGenerating}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors shadow-sm disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showDownloadMenu ? 'rotate-180' : ''}`} />
            </button>

            {showDownloadMenu && (
              <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-lg shadow-xl z-20 py-2 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="px-4 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Huidige weergave</div>
                <button onClick={exportAsWord} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-blue-50 transition-colors">
                  <FileText className="w-4 h-4 text-blue-500" />
                  <span className="font-medium text-blue-700">Word (.doc)</span>
                </button>
                <button onClick={exportAsTxt} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <span>Tekst (.txt)</span>
                </button>
                <button onClick={exportAsMarkdown} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <FileCode className="w-4 h-4 text-slate-400" />
                  <span>Markdown (.md)</span>
                </button>
                
                <div className="h-px bg-slate-100 my-1"></div>
                <div className="px-4 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Specifieke exports</div>
                
                <button onClick={exportWithTimestamps} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <span>Met tijdstempels</span>
                </button>
                <button onClick={exportWithoutTimestamps} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <AlignLeft className="w-4 h-4 text-slate-400" />
                  <span>Zonder tijdstempels</span>
                </button>
                <button onClick={exportSummary} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <Sparkles className="w-4 h-4 text-slate-400" />
                  <span>Samenvatting apart</span>
                </button>
                
                <div className="h-px bg-slate-100 my-1"></div>
                <button onClick={exportAsJson} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <FileJson className="w-4 h-4 text-slate-400" />
                  <span>Volledig JSON (.json)</span>
                </button>
                <button onClick={exportAsSrt} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <FileType className="w-4 h-4 text-slate-400" />
                  <span>Ondertitels (.srt)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content Area with Virtualization */}
      <div 
        ref={containerRef}
        onScroll={onScroll}
        className="p-6 md:p-10 bg-white min-h-[400px] max-h-[70vh] overflow-y-auto custom-scrollbar relative"
      >
        {isGenerating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-10">
            <RefreshCw className="w-10 h-10 text-blue-500 animate-spin mb-4" />
            <p className="text-slate-600 font-medium">AI analyseert de transcriptie...</p>
            <p className="text-slate-400 text-sm">Dit kan enkele seconden duren.</p>
          </div>
        ) : generationError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-10 px-8">
            <p className="text-red-600 font-medium text-center mb-2">Genereren mislukt</p>
            <p className="text-slate-500 text-sm text-center mb-4">{generationError}</p>
            <button
              onClick={() => { setGenerationError(null); setResult(prev => ({ ...prev, [activeTab]: undefined as any })); }}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              Opnieuw proberen
            </button>
          </div>
        ) : null}

        <div 
          className="prose prose-slate max-w-none"
          style={{ height: `${totalHeight}px`, position: 'relative' }}
        >
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            {visibleContent.map(({ line, index }: { line: string, index: number }) => (
              <div 
                key={index} 
                className="mb-4 text-[15px] leading-7 text-slate-700 whitespace-pre-wrap" 
                style={{ minHeight: `${LINE_HEIGHT - 12}px` }}
              >
                {renderLine(line)}
              </div>
            ))}
          </div>
        </div>
      </div>
      
    </div>
  );
});

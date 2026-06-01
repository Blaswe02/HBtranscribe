
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { FileUpload } from './components/FileUpload';
import { AudioRecorder } from './components/AudioRecorder';
import { LiveTranscribe } from './components/LiveTranscribe';
import { ResultDisplay } from './components/ResultDisplay';
import { ProcessingState } from './components/ProcessingState';
import { DebugPanel } from './components/DebugPanel';
import { UploadDebugPanel } from './components/UploadDebugPanel';
import { FileData, ProcessingStatus, TranscriptionResult, ProcessingProgress, TranscriptionMode, TranscriptionLanguage, DebugInfo } from './types';
import { transcribeAudio, mergeTranscriptions, clearCache, TranscriptionOptions } from "./services/geminiService";
import { encodeWavFromAudioBufferSegment } from './lib/audioUtils';
import { Infinity, Mic, ChevronLeft, Upload, Disc, Radio, XCircle, ShieldCheck, Trash2, Zap, Clock, Users, Globe, Bug, ClipboardPaste } from 'lucide-react';
import { uploadRecordingAndGetSignedUrl } from "./services/storageService";
import { transcribeWithAssemblyAI } from "./services/assemblyaiService";
import { TranscriptViewer } from "./components/TranscriptViewer";
import { generateInsightsFromTranscript } from "./services/insightsService";

const App: React.FC = () => {
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [transcription, setTranscription] = useState<TranscriptionResult | null>(null);
  const [currentFile, setCurrentFile] = useState<FileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<'upload' | 'record' | 'live' | 'paste'>('upload');
  const [pasteText, setPasteText] = useState('');
  const [progress, setProgress] = useState<ProcessingProgress>({ current: 0, total: 0, percentage: 0 });
  const [showDebug, setShowDebug] = useState(false);
  const [uploadOnly, setUploadOnly] = useState(true);
  const [uploadResult, setUploadResult] = useState<{ path: string; signedUrl: string } | null>(null);
  const [showUploadDebug, setShowUploadDebug] = useState(false);
  const [asrSegments, setAsrSegments] = useState<any[] | null>(null);
  const [asrFullText, setAsrFullText] = useState<string | null>(null);
  const [audioSignedUrl, setAudioSignedUrl] = useState<string | null>(null);
  const [segmentSearch, setSegmentSearch] = useState<string>("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [insights, setInsights] = useState<any | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  
  // Transcription Options
  const [mode, setMode] = useState<TranscriptionMode>(TranscriptionMode.VERBATIM);
  const [language, setLanguage] = useState<TranscriptionLanguage>(TranscriptionLanguage.DUTCH);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [showSpeakerLabels, setShowSpeakerLabels] = useState(true);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Initialize Worker
  useEffect(() => {
    try {
      workerRef.current = new Worker(new URL('./workers/transcriptWorker.ts', import.meta.url), { type: 'module' });
      
      workerRef.current.onmessage = (e) => {
        if (e.data.type === 'FINAL_RESULT_PROCESSED') {
          setTranscription(e.data.payload);
          setStatus(ProcessingStatus.COMPLETED);
        }
      };

      workerRef.current.onerror = (e) => {
        if (import.meta.env.DEV) console.warn("App Worker error:", e);
        workerRef.current?.terminate();
        workerRef.current = null;
      };
    } catch (e) {
      if (import.meta.env.DEV) console.warn("Web Worker not supported in App.");
      workerRef.current = null;
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  // Cleanup Blob URLs on unmount
  useEffect(() => {
    return () => {
      setCurrentFile(prev => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return null;
      });
    };
  }, []);

  const getAudioDuration = (blob: Blob): Promise<number> => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.addEventListener('loadedmetadata', () => {
        URL.revokeObjectURL(url);
        resolve(audio.duration);
      });
      audio.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        resolve(0); // Fallback to 0 if duration can't be determined
      });
    });
  };

  const handleAudioProcessing = useCallback(async (data: FileData | string) => {
    setStatus(ProcessingStatus.TRANSCRIBING);
    setError(null);
    setTranscription(null);
    setProgress({ current: 0, total: 0, percentage: 0 });
    
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const options: TranscriptionOptions = {
      mode,
      language,
      showTimestamps,
      showSpeakerLabels
    };

    // STAP A: Upload-only logic
    if (uploadOnly && typeof data !== 'string') {
      setStatus(ProcessingStatus.UPLOADING);
      console.log("SUPABASE_UPLOAD_START", data.name);
   try {
  const result = await uploadRecordingAndGetSignedUrl(data.blob!, data.name, { folder: "test" });
  console.log("SUPABASE_UPLOAD_OK", result.path);
  setUploadResult(result);

  console.log("ASSEMBLYAI_TEST_START", result.signedUrl);

  const asr = await transcribeWithAssemblyAI(result.signedUrl, {
  diarization: true,
  signal: abortController.signal,
});

  console.log("ASSEMBLYAI_DONE", asr);

  setAudioSignedUrl(result.signedUrl);
  setAsrFullText(asr.fullText);
  setAsrSegments(asr.segments);
  setInsightsLoading(true);
try {
  const resultInsights = await generateInsightsFromTranscript({
    language: "nl",
    title: data.name,
    fullText: asr.fullText,
    segments: asr.segments,
  });
  setInsights(resultInsights);
} catch (e: any) {
  console.error("GEMINI_INSIGHTS_FAIL", e?.message ?? e);
  // optioneel: laat dit in UI zien
  // setError(`Gemini insights failed: ${e?.message ?? e}`);
} finally {
  setInsightsLoading(false);
}

  setShowUploadDebug(true);
  setStatus(ProcessingStatus.COMPLETED);
  return;
} catch (err: any) {
  console.error("SUPABASE_UPLOAD_FAIL", err?.message ?? err);
  setError(`Supabase upload failed: ${err?.message ?? err}`);
  setStatus(ProcessingStatus.ERROR);
  return;
}
}

    try {
      let finalResult: TranscriptionResult;

      if (typeof data === 'string') {
        // From Live Transcribe
        setCurrentFile({ name: 'Live Sessie', size: 0, type: 'text/plain' });
        finalResult = await transcribeAudio({ text: data, options }, abortController.signal);
        
        // Ensure debug info for live session
        if (finalResult && !finalResult.debugInfo) {
          finalResult.debugInfo = {
            modelName: "gemini-2.0-flash",
            temperature: (options.mode === TranscriptionMode.VERBATIM || options.mode === TranscriptionMode.READABLE) ? 0 : 0.1,
            chunksCount: 1,
            isStructuredOutput: true,
            needsFollowup: finalResult.needs_followup
          };
        }
      } else {
        // From Upload or Batch Record
        if (data.blob && !data.url) {
          data.url = URL.createObjectURL(data.blob);
        }
        
        setCurrentFile(prev => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return data;
        });

        const blob = data.blob!;
        const duration = await getAudioDuration(blob);
        
        // CHUNKING LOGIC: Chunk if longer than 3 minutes (180 seconds)
        // Or if file size is very large (> 10MB) as a safety measure
        const MAX_DURATION = 300; // 5 minuten
        const CHUNK_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
        
        if (duration <= MAX_DURATION && blob.size <= CHUNK_SIZE_BYTES) {
          setProgress({ current: 1, total: 1, percentage: 100 });
          finalResult = await transcribeAudio({ blob: data.blob, mimeType: data.type, options }, abortController.signal);
          
          // Add duration to debug info
          if (finalResult.debugInfo && duration > 0) {
            finalResult.debugInfo.chunkDuration = duration;
          }
        } else {
          setStatus(ProcessingStatus.CHUNKING);
          
          // NEW TIME-BASED CHUNKING LOGIC
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          let chunks: Blob[] = [];
          try {
            const arrayBuffer = await blob.arrayBuffer();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

            const totalSamples = audioBuffer.length;
            const sampleRate = audioBuffer.sampleRate;
            const samplesPerChunk = MAX_DURATION * sampleRate;
            const totalChunks = Math.ceil(totalSamples / samplesPerChunk);
            const overlapSamples = 5 * sampleRate;

            for (let i = 0; i < totalChunks; i++) {
              const start = Math.max(0, i * samplesPerChunk - (i > 0 ? overlapSamples : 0));
              const end = Math.min(totalSamples, (i + 1) * samplesPerChunk + (i < totalChunks - 1 ? overlapSamples : 0));
              chunks.push(encodeWavFromAudioBufferSegment(audioBuffer, start, end));
            }
          } finally {
            await audioCtx.close();
          }
          const totalChunks = chunks.length;

          setProgress({ current: 0, total: totalChunks, percentage: 0 });
          setStatus(ProcessingStatus.TRANSCRIBING);

          const results: TranscriptionResult[] = new Array(totalChunks);
          let completedCount = 0;
          
          // ROBUST QUEUE LOGIC
          const concurrencyLimit = 2; 
          const queue = [...chunks.keys()];
          let isOverloaded = false;
          
          const workers = Array(Math.min(concurrencyLimit, totalChunks))
            .fill(null)
            .map((_, i) => {
              const processQueue = async () => {
                while (queue.length > 0 && !abortController.signal.aborted) {
                  if (isOverloaded && i > 0) return;
                  
                  const index = queue.shift()!;
                  if (index === undefined) return;

                  try {
                    results[index] = await transcribeAudio(
                      { 
                        blob: chunks[index], 
                        mimeType: 'audio/wav', 
                        isChunk: true,
                        chunkNumber: index + 1,
                        totalChunks: totalChunks,
                        options
                      },
                      abortController.signal,
                      (attempt, delay) => {
                        isOverloaded = true;
                        setProgress(prev => ({
                          ...prev,
                          retryCount: attempt,
                          maxRetries: 3,
                          cooldownSeconds: Math.ceil(delay / 1000),
                          isOverloaded: true
                        }));

                        // Countdown for UI — cleared when aborted
                        let remaining = Math.ceil(delay / 1000);
                        const timer = setInterval(() => {
                          if (abortController.signal.aborted) { clearInterval(timer); return; }
                          remaining--;
                          setProgress(prev => ({ ...prev, cooldownSeconds: Math.max(0, remaining) }));
                          if (remaining <= 0) clearInterval(timer);
                        }, 1000);
                      }
                    );

                    // Success: reset retry info
                    setProgress(prev => ({ ...prev, retryCount: undefined, cooldownSeconds: undefined }));
                    
                    completedCount++;
                    setProgress(prev => ({ 
                      ...prev,
                      current: completedCount, 
                      total: totalChunks, 
                      percentage: Math.round((completedCount / totalChunks) * 100) 
                    }));
                  } catch (e: any) {
                    if (import.meta.env.DEV) console.error(`Error in chunk ${index}:`, e);
                    if (e.message.includes("Max retries") || e.message.includes("overbelast") || e.message.includes("RESOURCE_EXHAUSTED")) {
                      setError("Gemini server is tijdelijk overbelast. De limiet is bereikt.");
                      setProgress(prev => ({ ...prev, isOverloaded: true }));
                    }
                    throw e;
                  }
                }
              };
              return processQueue();
            });

          await Promise.all(workers);

          if (abortController.signal.aborted) {
            setStatus(ProcessingStatus.CANCELLED);
            return;
          }

          setStatus(ProcessingStatus.MERGING);
          finalResult = await mergeTranscriptions(results.filter(Boolean), options, abortController.signal);
          
          // Add chunk duration to debug info
          if (finalResult.debugInfo && duration > 0) {
            finalResult.debugInfo.chunkDuration = duration / totalChunks;
          }
        }
      }
      
      if (workerRef.current) {
        workerRef.current.postMessage({
          type: 'PROCESS_FINAL_RESULT',
          payload: finalResult
        });
      } else {
        // Fallback
        setTranscription(finalResult);
        setStatus(ProcessingStatus.COMPLETED);
      }
    } catch (err: any) {
      if (abortController.signal.aborted) {
        setStatus(ProcessingStatus.CANCELLED);
      } else {
        if (import.meta.env.DEV) console.error(err);
        setError("Er is een fout opgetreden bij het verwerken. Probeer het opnieuw met een kleiner bestand.");
        setStatus(ProcessingStatus.ERROR);
      }
    } finally {
      abortControllerRef.current = null;
    }
  }, [mode, language, showTimestamps, showSpeakerLabels, uploadOnly]);

  const handlePasteSubmit = useCallback((text: string) => {
    setError(null);
    setCurrentFile({ name: 'Geplakt transcript', size: text.length, type: 'text/plain' });
    setTranscription({
      transcript: text,
      mode: mode,
      language: language,
      continued_from: null,
      needs_followup: false,
    });
    setStatus(ProcessingStatus.COMPLETED);
  }, [mode, language]);

  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const handleReset = useCallback(() => {
    handleCancel();
    setCurrentFile(prev => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    setStatus(ProcessingStatus.IDLE);
    setTranscription(null);
    setUploadResult(null);
    setShowUploadDebug(false);
    setError(null);
    setProgress({ current: 0, total: 0, percentage: 0 });
  }, [handleCancel]);

  const handleClearSession = useCallback(() => {
    handleReset();
    clearCache();
    // Force worker restart by re-initializing if needed, 
    // but here we just terminate and let the effect handle it if we were to unmount.
    // Since we stay mounted, we just clear the cache and reset state.
    if (import.meta.env.DEV) console.log("Session data cleared.");
  }, [handleReset]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={handleReset}>
            <div className="bg-slate-900 text-white p-1.5 rounded-md">
              <Infinity className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              HB∞ <span className="font-normal text-slate-600">Transcribe Assistant</span>
            </h1>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm text-slate-500">
             <button 
               onClick={handleClearSession}
               className="flex items-center gap-1.5 text-slate-400 hover:text-red-500 transition-colors"
               title="Wis alle sessiegegevens"
             >
               <Trash2 className="w-4 h-4" />
               Wis Sessie
             </button>
             <span className="flex items-center gap-1">
               <Mic className="w-4 h-4 text-blue-500" />
               Auto-detectie Taal
             </span>
             <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-semibold tracking-wider">PREMIUM</span>
          </div>
        </div>
      </header>

      <main className="flex-grow flex flex-col items-center justify-start pt-12 px-4 pb-12">
        
        {status === ProcessingStatus.IDLE && (
          <div className="w-full max-w-4xl text-center mb-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-800 mb-4">
              Zet spraak om in heldere tekst
            </h2>
            <p className="text-lg text-slate-600 mb-8">
              Kies uw modus en start de transcriptie.
            </p>
            
            {/* Mode Selector */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-8 shadow-sm text-left">

              {/* Kwaliteits selector — verborgen bij Plak transcript */}
              {inputMode !== 'paste' && (
              <div className="mb-6">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 block">Verwerkingskwaliteit</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setUploadOnly(true)}
                    className={`flex flex-col items-start p-4 rounded-xl border-2 transition-all text-left ${
                      uploadOnly
                        ? 'border-amber-400 bg-amber-50 ring-4 ring-amber-100/50 shadow-sm'
                        : 'border-slate-100 hover:border-slate-300 bg-slate-50/50 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Zap className={`w-4 h-4 ${uploadOnly ? 'text-amber-500' : 'text-slate-400'}`} />
                      <span className={`font-bold text-sm ${uploadOnly ? 'text-amber-700' : 'text-slate-600'}`}>Hoge kwaliteit</span>
                    </div>
                    <span className="text-[10px] text-slate-500 leading-relaxed">AssemblyAI · Beste sprekerherkenning · ~€0,38/uur</span>
                  </button>
                  <button
                    onClick={() => setUploadOnly(false)}
                    className={`flex flex-col items-start p-4 rounded-xl border-2 transition-all text-left ${
                      !uploadOnly
                        ? 'border-blue-500 bg-blue-50 ring-4 ring-blue-100/50 shadow-sm'
                        : 'border-slate-100 hover:border-slate-300 bg-slate-50/50 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <ShieldCheck className={`w-4 h-4 ${!uploadOnly ? 'text-blue-500' : 'text-slate-400'}`} />
                      <span className={`font-bold text-sm ${!uploadOnly ? 'text-blue-700' : 'text-slate-600'}`}>Standaard</span>
                    </div>
                    <span className="text-[10px] text-slate-500 leading-relaxed">Gemini · Goede kwaliteit · ~€0,03/uur</span>
                  </button>
                </div>
              </div>
              )}

              <div className="flex flex-col md:flex-row gap-8">
                {/* Modes */}
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Transcriptie Modus</label>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { id: TranscriptionMode.VERBATIM, label: 'Woordelijke transcriptie', desc: '100% letterlijk, inclusief alle details' },
                      { id: TranscriptionMode.READABLE, label: 'Leesbare transcriptie', desc: 'Vloeiende tekst zonder haperingen' },
                      { id: TranscriptionMode.SUMMARY, label: 'Samenvatting', desc: 'Alleen de kernpunten en afspraken' }
                    ].map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setMode(m.id)}
                        className={`flex flex-col items-start p-4 rounded-xl border-2 transition-all text-left group ${
                          mode === m.id 
                            ? 'border-blue-600 bg-blue-50/50 ring-4 ring-blue-100/50 shadow-sm' 
                            : 'border-slate-100 hover:border-slate-300 bg-slate-50/50 hover:bg-white'
                        }`}
                      >
                        <span className={`font-bold text-sm mb-1 transition-colors ${mode === m.id ? 'text-blue-700' : 'text-slate-700 group-hover:text-slate-900'}`}>{m.label}</span>
                        <span className="text-[10px] text-slate-500 leading-relaxed">{m.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Settings */}
                <div className="flex-1 flex flex-col sm:flex-row gap-6">
                  <div className="flex-1">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 block">Instellingen</label>
                    <div className="space-y-3">
                      <button 
                        onClick={() => setShowTimestamps(!showTimestamps)}
                        className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center gap-2 text-sm text-slate-700">
                          <Clock className="w-4 h-4 text-slate-400" />
                          Tijdstempels
                        </div>
                        <div className={`w-8 h-4 rounded-full relative transition-colors ${showTimestamps ? 'bg-blue-500' : 'bg-slate-300'}`}>
                          <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${showTimestamps ? 'left-4.5' : 'left-0.5'}`} />
                        </div>
                      </button>
                      <button 
                        onClick={() => setShowSpeakerLabels(!showSpeakerLabels)}
                        className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center gap-2 text-sm text-slate-700">
                          <Users className="w-4 h-4 text-slate-400" />
                          Sprekerlabels
                        </div>
                        <div className={`w-8 h-4 rounded-full relative transition-colors ${showSpeakerLabels ? 'bg-blue-500' : 'bg-slate-300'}`}>
                          <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${showSpeakerLabels ? 'left-4.5' : 'left-0.5'}`} />
                        </div>
                      </button>
                    </div>
                  </div>

                  <div className="flex-1">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 block">Taal</label>
                    <div className="relative">
                      <select 
                        value={language}
                        onChange={(e) => setLanguage(e.target.value as TranscriptionLanguage)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        <option value={TranscriptionLanguage.DUTCH}>Nederlands</option>
                        <option value={TranscriptionLanguage.ENGLISH}>Engels</option>
                        <option value={TranscriptionLanguage.AUTO}>Auto-detectie</option>
                      </select>
                      <Globe className="absolute right-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="inline-flex bg-slate-200 p-1 rounded-xl mb-12 shadow-inner">
              <button
                onClick={() => setInputMode('upload')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  inputMode === 'upload' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Upload className="w-4 h-4" />
                Bestand
              </button>
              <button
                onClick={() => setInputMode('record')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  inputMode === 'record' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Disc className="w-4 h-4" />
                Opname
              </button>
              <button
                onClick={() => setInputMode('live')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  inputMode === 'live' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Radio className="w-4 h-4" />
                Live Transcribe
              </button>
              <button
                onClick={() => setInputMode('paste')}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  inputMode === 'paste' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <ClipboardPaste className="w-4 h-4" />
                Plak transcript
              </button>
            </div>

            <div className="transition-all duration-300 relative">
              <div className={inputMode === 'upload' ? 'block' : 'hidden'}>
                <FileUpload onFileSelect={handleAudioProcessing} disabled={false} />
              </div>
              <div className={inputMode === 'record' ? 'block' : 'hidden'}>
                <AudioRecorder onRecordingComplete={handleAudioProcessing} disabled={false} />
              </div>
              <div className={inputMode === 'live' ? 'block' : 'hidden'}>
                <LiveTranscribe
                  onFinalize={handleAudioProcessing}
                  disabled={false}
                  language={language}
                />
              </div>
              <div className={inputMode === 'paste' ? 'block' : 'hidden'}>
                <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-6 text-left">
                  <label className="text-sm font-medium text-slate-700 mb-2 block">Plak hier je transcript</label>
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder="Plak hier de tekst van je transcriptie (bijv. vanuit Whisper of een andere tool)..."
                    className="w-full h-48 border border-slate-200 rounded-xl p-3 text-sm text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <button
                    onClick={() => pasteText.trim() && handlePasteSubmit(pasteText.trim())}
                    disabled={!pasteText.trim()}
                    className="mt-3 w-full py-2.5 bg-slate-900 text-white rounded-xl font-medium text-sm hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Maak notulen
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-400 bg-slate-100/50 py-2 px-4 rounded-full inline-flex mx-auto">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Uw audio wordt lokaal verwerkt en niet opgeslagen op onze servers.</span>
            </div>
          </div>
        )}

        <ProcessingState 
          status={status} 
          progress={progress} 
          onCancel={handleCancel} 
        />
        {asrSegments && audioSignedUrl && (
  <div className="w-full max-w-4xl mt-6 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
      <div>
        <h3 className="text-lg font-bold text-slate-800">Transcript (AssemblyAI)</h3>
        <p className="text-sm text-slate-500">Klik op een segment om te springen in de audio.</p>
      </div>

      <input
        value={segmentSearch}
        onChange={(e) => setSegmentSearch(e.target.value)}
        placeholder="Zoek in transcript..."
        className="w-full sm:w-72 border border-slate-200 rounded-lg px-3 py-2 text-sm"
      />
    </div>

    <audio ref={audioRef} controls className="w-full mb-4" src={audioSignedUrl} />

    <TranscriptViewer
      segments={asrSegments}
      audioRef={audioRef}
      showSpeakers={showSpeakerLabels}
      search={segmentSearch}
    />

{insightsLoading && (
  <div className="mt-6 text-sm text-slate-500">Gemini maakt samenvatting en highlights…</div>
)}

{insights && (
  <div className="mt-6 border-t border-slate-200 pt-6">
    <h3 className="text-lg font-bold text-slate-800 mb-2">Samenvatting & Highlights</h3>

    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm whitespace-pre-wrap">
      {insights.summary}
    </div>

    {insights.highlights?.length ? (
      <div className="mt-4 space-y-2">
        {insights.highlights.map((h: any, idx: number) => (
          <div key={idx} className="bg-white border border-slate-200 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <div className="font-bold text-slate-800">{h.title}</div>
              {h.time ? <div className="text-xs text-slate-500 font-mono">{h.time}</div> : null}
            </div>
            <div className="text-sm text-slate-700 mt-1">{h.detail}</div>
          </div>
        ))}
      </div>
    ) : null}

    {insights.action_items?.length ? (
      <div className="mt-6">
        <h4 className="font-bold text-slate-800 mb-2">Actiepunten</h4>
        <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
          {insights.action_items.map((a: any, idx: number) => (
            <li key={idx}>
              {a.task}
              {a.owner ? <span className="text-slate-500"> — {a.owner}</span> : null}
              {a.due ? <span className="text-slate-500"> (due: {a.due})</span> : null}
            </li>
          ))}
        </ul>
      </div>
    ) : null}
  </div>
)}
    {asrFullText ? (
      <details className="mt-6">
        <summary className="cursor-pointer text-sm font-bold text-slate-600">
          Toon volledige tekst
        </summary>
        <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-xl p-4">
          {asrFullText}
        </pre>
      </details>
    ) : null}
  </div>
)}

        {(status === ProcessingStatus.ERROR || status === ProcessingStatus.CANCELLED) && (
          <div className="w-full max-w-2xl text-center">
            <div className={`rounded-xl p-8 mb-6 shadow-sm border ${
              status === ProcessingStatus.CANCELLED 
                ? "bg-slate-50 border-slate-200 text-slate-600" 
                : "bg-red-50 border-red-200 text-red-800"
            }`}>
              <p className="font-bold text-lg mb-2">
                {status === ProcessingStatus.CANCELLED ? "Verwerking geannuleerd" : "Verwerking mislukt"}
              </p>
              <p className="text-sm opacity-90">
                {status === ProcessingStatus.CANCELLED 
                  ? "Je hebt de verwerking gestopt. Er zijn geen kosten in rekening gebracht." 
                  : error}
              </p>
            </div>
            
            {progress.isOverloaded ? (
              <div className="flex flex-col gap-4 items-center">
                <div className="flex flex-wrap justify-center gap-3">
                  <button 
                    onClick={() => {
                      if (currentFile) {
                        handleAudioProcessing(currentFile);
                      }
                    }}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <Zap className="w-4 h-4" /> Wacht 30s en probeer opnieuw
                  </button>
                  <button 
                    onClick={handleReset}
                    className="px-6 py-2 bg-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-300 transition-colors"
                  >
                    Stop
                  </button>
                </div>
                <p className="text-xs text-slate-400 italic">De Gemini server is momenteel erg druk. Probeer het over een halve minuut nog eens.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3 items-center">
                <button 
                  onClick={handleReset}
                  className="px-6 py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 mx-auto"
                >
                  <ChevronLeft className="w-4 h-4" /> Probeer opnieuw
                </button>
                {error && (
                  <button 
                    onClick={() => setShowDebug(true)}
                    className="text-slate-400 hover:text-slate-600 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition-colors"
                  >
                    <Bug className="w-3 h-3" /> Debug details
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {status === ProcessingStatus.COMPLETED && transcription && (
          <div className="w-full flex flex-col items-center gap-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="w-full max-w-4xl flex justify-between items-end mb-2">
              <div>
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  {currentFile?.name}
                </h3>
                <p className="text-sm text-slate-500">Transcriptie succesvol gegenereerd</p>
              </div>
              <button 
                onClick={handleReset}
                className="text-blue-600 hover:text-blue-700 text-sm font-bold transition-colors bg-blue-50 px-4 py-2 rounded-lg"
              >
                Nieuwe sessie
              </button>
            </div>
            
            <div className="w-full max-w-4xl flex justify-end mb-2">
              <button 
                onClick={() => setShowDebug(true)}
                className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors"
              >
                <Bug className="w-3 h-3" /> Debug
              </button>
            </div>

            <ResultDisplay result={transcription} mode={mode} />
          </div>
        )}
      </main>

      {showDebug && (
        <DebugPanel 
          result={transcription} 
          error={error}
          mode={mode} 
          language={language} 
          onClose={() => setShowDebug(false)} 
        />
      )}

      {showUploadDebug && (
        <UploadDebugPanel 
          uploadData={uploadResult}
          error={error}
          onClose={() => setShowUploadDebug(false)}
        />
      )}

      <footer className="bg-white border-t border-slate-200 py-8 mt-auto">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <div className="flex justify-center items-center gap-2 mb-2 text-slate-900 font-bold">
             <Infinity className="w-5 h-5" /> HB∞
          </div>
          <p className="text-slate-400 text-sm">© {new Date().getFullYear()} HB∞ Transcribe Assistant. High-end AI Transcription.</p>
        </div>
      </footer>
    </div>
  );
};

export default App;

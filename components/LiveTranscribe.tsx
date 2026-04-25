
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Mic, StopCircle, Radio, Sparkles, AlertCircle, RefreshCw, History } from 'lucide-react';
import { TranscriptionLanguage } from '../types';

const SESSION_STORAGE_KEY = 'hb_transcribe_live_session';
const MAX_RECONNECT_ATTEMPTS = 5;

interface LiveTranscribeProps {
  onFinalize: (fullText: string) => void;
  disabled: boolean;
  language: TranscriptionLanguage;
}

export const LiveTranscribe: React.FC<LiveTranscribeProps> = React.memo(({ onFinalize, disabled, language }) => {
  const [isActive, setIsActive] = useState(false);
  const [finalSegments, setFinalSegments] = useState<string[]>([]);
  const [partialText, setPartialText] = useState('');
  const [processedTranscript, setProcessedTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hasRestorableSession, setHasRestorableSession] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [hasApiKey, setHasApiKey] = useState(true);
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const accumulatedTextRef = useRef('');
  const workerRef = useRef<Worker | null>(null);
  const wakeLockRef = useRef<any>(null);
  
  // Performance tracking
  const renderCountRef = useRef(0);
  const commitCountRef = useRef(0);
  const lastLogTimeRef = useRef(Date.now());
  
  // Buffering logic
  const bufferRef = useRef('');
  const flushIntervalRef = useRef<number | null>(null);

  renderCountRef.current++;

  // Initialize Worker and Check API Key
  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
      }
    };
    checkApiKey();

    // Check for restorable session
    const saved = localStorage.getItem(SESSION_STORAGE_KEY);
    if (saved) {
      setHasRestorableSession(true);
    }

    try {
      // Vite-compatible worker initialization
      workerRef.current = new Worker(new URL('../workers/transcriptWorker.ts', import.meta.url), { type: 'module' });
      
      workerRef.current.onmessage = (e) => {
        if (e.data.type === 'LIVE_TRANSCRIPT_PROCESSED') {
          setProcessedTranscript(e.data.payload.processedText);
        }
      };

      workerRef.current.onerror = (e) => {
        console.warn("Worker error, falling back to main thread:", e);
        workerRef.current = null;
      };
    } catch (e) {
      console.warn("Web Worker not supported, falling back to main thread.");
      workerRef.current = null;
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  // Periodic Checkpoint (every 30s)
  useEffect(() => {
    if (!isActive) return;

    const checkpointInterval = setInterval(() => {
      const sessionData = {
        finalSegments,
        accumulatedText: accumulatedTextRef.current,
        timestamp: Date.now()
      };
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionData));
      if (import.meta.env.DEV) console.log("[LiveTranscribe] Session checkpoint saved.");
    }, 30000);

    return () => clearInterval(checkpointInterval);
  }, [isActive, finalSegments]);

  // Wake Lock Logic
  useEffect(() => {
    const requestWakeLock = async () => {
      if ('wakeLock' in navigator && isActive) {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        } catch (err) {
          if (import.meta.env.DEV) console.warn("Wake Lock failed:", err);
        }
      }
    };

    if (isActive) {
      requestWakeLock();
    } else {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().then(() => {
          wakeLockRef.current = null;
        });
      }
    }

    return () => {
      if (wakeLockRef.current) wakeLockRef.current.release();
    };
  }, [isActive]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    
    const logInterval = setInterval(() => {
      const now = Date.now();
      const delta = (now - lastLogTimeRef.current) / 1000;
      if (delta >= 1) {
        console.log(`[LiveTranscribe Perf] Renders/sec: ${(renderCountRef.current / delta).toFixed(1)}, Commits/sec: ${(commitCountRef.current / delta).toFixed(1)}`);
        renderCountRef.current = 0;
        commitCountRef.current = 0;
        lastLogTimeRef.current = now;
      }
    }, 1000);
    return () => clearInterval(logInterval);
  }, []);

  const flushBuffer = useCallback(() => {
    const currentBuffer = bufferRef.current;
    if (currentBuffer !== partialText) {
      commitCountRef.current++;
      
      let nextPartial = currentBuffer;
      let nextSegments = [...finalSegments];

      if (currentBuffer.length > 500) {
        const lastSpace = currentBuffer.lastIndexOf(' ');
        const splitIndex = lastSpace > 400 ? lastSpace : 400;
        
        const stable = currentBuffer.substring(0, splitIndex);
        const remaining = currentBuffer.substring(splitIndex);
        
        nextSegments = [...finalSegments, stable];
        nextPartial = remaining;
        
        setFinalSegments(nextSegments);
        bufferRef.current = remaining;
        setPartialText(remaining);
      } else {
        setPartialText(currentBuffer);
      }

      // Send to worker or fallback
      if (workerRef.current) {
        workerRef.current.postMessage({
          type: 'PROCESS_LIVE_TRANSCRIPT',
          payload: { segments: nextSegments, partialText: nextPartial }
        });
      } else {
        // Fallback: manual processing
        const combined = [...nextSegments, nextPartial].join(' ');
        const cleaned = combined.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
        setProcessedTranscript(cleaned);
      }
    }
  }, [partialText, finalSegments]);

  const encode = (bytes: Uint8Array) => {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  };

  const createBlob = (data: Float32Array) => {
    const int16 = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
    return {
      data: encode(new Uint8Array(int16.buffer)),
      mimeType: 'audio/pcm;rate=16000',
    };
  };

  const handleOpenKeySelector = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionAliveRef = useRef(false);

  const startLiveSession = async (isRestoring = false) => {
    setError(null);

    if (window.aistudio?.hasSelectedApiKey) {
      const selected = await window.aistudio.hasSelectedApiKey();
      if (!selected) {
        setHasApiKey(false);
        return;
      }
    }

    if (!isRestoring) {
      setFinalSegments([]);
      setPartialText('');
      accumulatedTextRef.current = '';
      bufferRef.current = '';
      setReconnectAttempt(0);
    } else {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) {
        try {
          const { finalSegments: savedSegments, accumulatedText: savedText } = JSON.parse(saved);
          setFinalSegments(savedSegments);
          accumulatedTextRef.current = savedText;
        } catch {}
        setPartialText('');
        bufferRef.current = '';
        setHasRestorableSession(false);
      }
    }

    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;

    try {
      const ai = new GoogleGenAI({ apiKey: (import.meta as any).env?.VITE_GEMINI_API_KEY || process.env.API_KEY });
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;

      sessionAliveRef.current = false;

      const session = await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setReconnectAttempt(0);
            sessionAliveRef.current = true;

            if (!audioCtx) return;
            const source = audioCtx.createMediaStreamSource(stream!);
            const processor = audioCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              if (!sessionAliveRef.current || !sessionRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              try {
                sessionRef.current.sendRealtimeInput({ audio: pcmBlob });
              } catch {
                sessionAliveRef.current = false;
              }
            };

            source.connect(processor);
            processor.connect(audioCtx.destination);

            // Start flush interval after session is open
            if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);
            flushIntervalRef.current = window.setInterval(flushBuffer, 150);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const newText = message.serverContent.inputTranscription.text;
              accumulatedTextRef.current += newText;
              bufferRef.current += newText;
            }
          },
          onerror: (e) => {
            if (import.meta.env.DEV) console.error("Live API Error:", e);
            sessionAliveRef.current = false;

            if (reconnectAttempt < MAX_RECONNECT_ATTEMPTS) {
              const backoff = Math.pow(2, reconnectAttempt) * 1000;
              setError(`Verbinding verbroken. Opnieuw verbinden in ${backoff/1000}s...`);
              setTimeout(() => {
                setReconnectAttempt(prev => prev + 1);
                startLiveSession(true);
              }, backoff);
            } else {
              setError("Maximale herverbindingspogingen bereikt.");
              stopLiveSession();
            }
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          systemInstruction: `Je luistert naar een gebruiker en transcribeert de tekst live in het ${language === TranscriptionLanguage.ENGLISH ? 'Engels' : 'Nederlands'}. Reageer zelf niet met audio, luister alleen en transcribeer.`,
        },
      });

      sessionRef.current = session;
      setIsActive(true);

    } catch (err) {
      if (import.meta.env.DEV) console.error("Failed to start live session:", err);
      // Clean up resources on failure
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (audioCtx) audioCtx.close();
      mediaStreamRef.current = null;
      audioContextRef.current = null;
      setError("Kon microfoon niet activeren of verbinden met de server.");
    }
  };

  const stopLiveSession = useCallback(() => {
    // Stop sending audio first
    sessionAliveRef.current = false;

    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = null;
    }

    // Disconnect processor before closing session
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    // Stop media stream tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }

    // Close session after audio is stopped
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch {}
      sessionRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Final flush of remaining buffer
    const finalBuffer = bufferRef.current;
    if (finalBuffer) {
      setFinalSegments(prev => [...prev, finalBuffer]);
      bufferRef.current = '';
      setPartialText('');
    }

    setIsActive(false);
    localStorage.removeItem(SESSION_STORAGE_KEY);
    if (accumulatedTextRef.current.trim()) {
      onFinalize(accumulatedTextRef.current);
    }
  }, [onFinalize]);

  // Ensure cleanup on unmount
  useEffect(() => {
    return () => {
      sessionAliveRef.current = false;
      if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);
      if (processorRef.current) { try { processorRef.current.disconnect(); } catch {} }
      if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
      if (sessionRef.current) { try { sessionRef.current.close(); } catch {} }
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  return (
    <div className="w-full max-w-2xl mx-auto mb-8">
      <div className={`relative flex flex-col w-full min-h-[16rem] border-2 border-dashed rounded-xl transition-all duration-300 overflow-hidden ${
        isActive ? "border-blue-400 bg-slate-900" : "border-slate-300 bg-white"
      }`}>
        
        {!isActive ? (
          <div className="flex flex-col items-center justify-center flex-grow p-8 space-y-4">
            {!hasApiKey ? (
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm max-w-sm">
                  <p className="font-bold mb-1">Betaalde API Key Vereist</p>
                  <p>Voor live transcriptie is een API key uit een betaald Google Cloud project nodig.</p>
                  <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-amber-600 underline mt-2 block">
                    Bekijk billing documentatie
                  </a>
                </div>
                <button
                  onClick={handleOpenKeySelector}
                  className="px-6 py-3 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-all flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> Selecteer API Key
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-4">
                  <button
                    onClick={() => startLiveSession(false)}
                    disabled={disabled}
                    className="p-6 rounded-full bg-blue-600 text-white hover:bg-blue-700 shadow-xl shadow-blue-100 transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                    title="Start nieuwe sessie"
                  >
                    <Radio className="w-8 h-8 animate-pulse" />
                  </button>
                  
                  {hasRestorableSession && (
                    <button
                      onClick={() => startLiveSession(true)}
                      disabled={disabled}
                      className="p-6 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 shadow-xl shadow-emerald-100 transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                      title="Herstel vorige sessie"
                    >
                      <History className="w-8 h-8" />
                    </button>
                  )}
                </div>
                
                <div className="text-center">
                  <p className="text-lg font-semibold text-slate-700">
                    {hasRestorableSession ? "Sessie herstellen of nieuw starten?" : "Start Live Sessie"}
                  </p>
                  <p className="text-sm text-slate-500">
                    {hasRestorableSession 
                      ? "Er is een eerdere sessie gevonden die niet is afgerond." 
                      : "Spraak wordt direct omgezet in tekst op het scherm."}
                  </p>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col h-full p-6 animate-in fade-in duration-500">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2 text-blue-400 text-xs font-bold uppercase tracking-widest">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                Live Transcribing
              </div>
              <button
                onClick={stopLiveSession}
                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Sparkles className="w-4 h-4 text-blue-300" />
                Stop & Analyseer
              </button>
            </div>

            <div className="flex-grow bg-white/5 rounded-lg p-4 font-mono text-blue-100/90 leading-relaxed overflow-y-auto max-h-48 custom-scrollbar">
              {processedTranscript || <span className="text-blue-100/30">Begin met praten...</span>}
            </div>
            
            <div className="mt-4 flex justify-center gap-1 h-6">
              {[...Array(12)].map((_, i) => (
                <div 
                  key={i} 
                  className="w-1 bg-blue-500/50 rounded-full animate-bounce" 
                  style={{ 
                    height: `${Math.random() * 100}%`, 
                    animationDuration: `${0.5 + Math.random()}s`,
                    animationDelay: `${i * 0.05}s`
                  }} 
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p className="text-sm">{error}</p>
        </div>
      )}
    </div>
  );
});

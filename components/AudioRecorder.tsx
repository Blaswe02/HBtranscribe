import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Trash2, Clock, AlertCircle } from 'lucide-react';
import { FileData } from '../types';

interface AudioRecorderProps {
  onRecordingComplete: (fileData: FileData) => void;
  disabled: boolean;
}

export const AudioRecorder: React.FC<AudioRecorderProps> = React.memo(({ onRecordingComplete, disabled }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        processAudioBlob(audioBlob);
        
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      
      timerIntervalRef.current = window.setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error("Error accessing microphone:", err);
      setError("Kan geen toegang krijgen tot de microfoon. Controleer je browserinstellingen.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      // Stop but don't process
      mediaRecorderRef.current.onstop = null; // Remove handler
      mediaRecorderRef.current.stop();
      // Stop tracks
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      
      setIsRecording(false);
      setDuration(0);
      audioChunksRef.current = [];
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
  };

  const processAudioBlob = (blob: Blob) => {
    onRecordingComplete({
      name: `Opname ${new Date().toLocaleString('nl-NL')}`,
      size: blob.size,
      type: blob.type,
      blob: blob
    });
    setDuration(0);
  };

  return (
    <div className="w-full max-w-2xl mx-auto mb-8">
      <div className={`relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-xl transition-all duration-300 ${
        isRecording ? "border-red-400 bg-red-50" : "border-slate-300 bg-white"
      }`}>
        
        {!isRecording ? (
          <div className="flex flex-col items-center space-y-4">
            <button
              onClick={startRecording}
              disabled={disabled}
              className={`p-6 rounded-full transition-transform hover:scale-105 ${
                disabled ? "bg-slate-200 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200"
              }`}
            >
              <Mic className="w-8 h-8 text-white" />
            </button>
            <div className="text-center">
              <p className="text-lg font-semibold text-slate-700">Start Opname</p>
              <p className="text-sm text-slate-500">Klik om direct in te spreken</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-6 w-full max-w-md animate-in fade-in duration-300">
             {/* Visualizer Animation */}
             <div className="flex items-center gap-1 h-12">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="w-2 bg-red-500 rounded-full animate-[pulse_1s_ease-in-out_infinite]" style={{ height: `${Math.random() * 100}%`, animationDelay: `${i * 0.1}s` }}></div>
                ))}
             </div>

             <div className="text-4xl font-mono font-bold text-slate-800 tracking-wider">
               {formatTime(duration)}
             </div>

             <div className="flex gap-4">
               <button
                 onClick={cancelRecording}
                 className="p-3 rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300 transition-colors"
                 title="Annuleren"
               >
                 <Trash2 className="w-6 h-6" />
               </button>
               <button
                 onClick={stopRecording}
                 className="p-3 rounded-full bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-200 transition-colors"
                 title="Stop en Verwerk"
               >
                 <Square className="w-6 h-6 fill-current" />
               </button>
             </div>
             <p className="text-sm text-red-600 font-medium animate-pulse">Opnemen...</p>
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

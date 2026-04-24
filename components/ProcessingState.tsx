import React from 'react';
import { Layers, AudioWaveform, BrainCircuit, PenTool, XCircle, Upload } from 'lucide-react';
import { ProcessingStatus, ProcessingProgress } from '../types';

interface ProcessingStateProps {
  status: ProcessingStatus;
  progress: ProcessingProgress;
  onCancel: () => void;
}

export const ProcessingState: React.FC<ProcessingStateProps> = React.memo(({ status, progress, onCancel }) => {
  if (status === ProcessingStatus.IDLE || status === ProcessingStatus.COMPLETED || status === ProcessingStatus.ERROR || status === ProcessingStatus.CANCELLED) return null;

  const getStatusTitle = () => {
    switch (status) {
      case ProcessingStatus.READING_FILE: return "Bestand inlezen...";
      case ProcessingStatus.CHUNKING: return "Audio opdelen...";
      case ProcessingStatus.UPLOADING: return "Uploaden naar Supabase...";
      case ProcessingStatus.TRANSCRIBING: return "HB∞ AI transcribeert...";
      case ProcessingStatus.MERGING: return "Resultaten samenvoegen...";
      default: return "Verwerken...";
    }
  };

  const getStatusDescription = () => {
    switch (status) {
      case ProcessingStatus.READING_FILE: return "We bereiden je bestand voor op verwerking.";
      case ProcessingStatus.CHUNKING: return "Grote bestanden worden in stukjes gehakt voor snellere verwerking.";
      case ProcessingStatus.UPLOADING: return "Je audio wordt veilig opgeslagen in de cloud.";
      case ProcessingStatus.TRANSCRIBING: 
        if (progress.retryCount) {
          return (
            <span className="flex flex-col items-center gap-1">
              <span className="text-orange-600 font-bold">
                Fragment {progress.current + 1}/{progress.total}: retry {progress.retryCount}/{progress.maxRetries || 3}
              </span>
              {progress.cooldownSeconds !== undefined && progress.cooldownSeconds > 0 && (
                <span className="text-xs text-slate-400">
                  Wachten op Gemini... ({progress.cooldownSeconds}s)
                </span>
              )}
            </span>
          );
        }
        return progress.total > 1 
          ? `Fragment ${progress.current + 1} van ${progress.total} wordt verwerkt.`
          : "De AI herkent sprekers en analyseert de inhoud.";
      case ProcessingStatus.MERGING: return "De verschillende fragmenten worden gesmeed tot één verslag.";
      default: return "Even geduld a.u.b.";
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto my-12 text-center animate-in fade-in zoom-in duration-300">
      <div className="relative flex justify-center items-center mb-6">
        <div className="absolute inset-0 bg-blue-100 rounded-full blur-xl opacity-50 animate-pulse"></div>
        <div className="relative bg-white p-6 rounded-full shadow-lg border border-blue-100">
           {status === ProcessingStatus.READING_FILE && <AudioWaveform className="w-10 h-10 text-blue-600 animate-pulse" />}
           {status === ProcessingStatus.CHUNKING && <Layers className="w-10 h-10 text-orange-600 animate-pulse" />}
           {status === ProcessingStatus.UPLOADING && <Upload className="w-10 h-10 text-amber-600 animate-bounce" />}
           {status === ProcessingStatus.TRANSCRIBING && <BrainCircuit className="w-10 h-10 text-purple-600 animate-spin-slow" />}
           {status === ProcessingStatus.MERGING && <PenTool className="w-10 h-10 text-emerald-600 animate-bounce" />}
        </div>
      </div>
      
      <h3 className="text-xl font-semibold text-slate-800 mb-2">
        {getStatusTitle()}
      </h3>
      
      <p className="text-slate-500 max-w-md mx-auto mb-8">
        {getStatusDescription()}
      </p>

      {/* Progress Bar */}
      {(status === ProcessingStatus.TRANSCRIBING || status === ProcessingStatus.MERGING) && progress.total > 1 && (
        <div className="w-full max-w-md mx-auto mb-8">
          <div className="flex justify-between text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
            <span>Voortgang</span>
            <span>{progress.percentage}%</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-600 transition-all duration-500 ease-out"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
        </div>
      )}

      <button
        onClick={onCancel}
        className="flex items-center gap-2 px-4 py-2 text-slate-400 hover:text-red-600 transition-colors mx-auto text-sm font-medium"
      >
        <XCircle className="w-4 h-4" />
        Annuleren
      </button>
    </div>
  );
});

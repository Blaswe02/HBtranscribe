import React from 'react';
import { TranscriptionResult, TranscriptionMode, TranscriptionLanguage } from '../types';
import { Bug, Info, CheckCircle2, AlertCircle } from 'lucide-react';

interface DebugPanelProps {
  result?: TranscriptionResult | null;
  error?: string | null;
  mode: TranscriptionMode;
  language: TranscriptionLanguage;
  onClose: () => void;
}

export const DebugPanel: React.FC<DebugPanelProps> = ({ result, error, mode, language, onClose }) => {
  const debugInfo = result?.debugInfo;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300">
        <div className="bg-slate-900 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Bug className="w-5 h-5 text-blue-400" />
            <h3 className="font-bold">Debug Informatie</h3>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <span className="text-2xl">&times;</span>
          </button>
        </div>
        
        <div className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-red-700 text-xs font-mono">
              <p className="font-bold mb-1">Foutmelding:</p>
              <p>{error}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <DebugItem label="Modus" value={mode} />
            <DebugItem label="Taal" value={language} />
            {debugInfo ? (
              <>
                <DebugItem label="Model" value={debugInfo.modelName} />
                <DebugItem label="Temperature" value={debugInfo.temperature.toString()} />
                {debugInfo.thinkingLevel && (
                  <DebugItem label="Thinking Budget" value={debugInfo.thinkingLevel} />
                )}
                <DebugItem label="Chunks" value={debugInfo.chunksCount.toString()} />
                {debugInfo.chunkDuration && (
                  <DebugItem label="Chunk Duur" value={`${Math.round(debugInfo.chunkDuration)}s`} />
                )}
                <DebugStatusItem 
                  label="Structured Output" 
                  active={debugInfo.isStructuredOutput} 
                />
                <DebugStatusItem 
                  label="Needs Followup" 
                  active={debugInfo.needsFollowup} 
                />
              </>
            ) : (
              <div className="col-span-2 text-xs text-slate-400 italic pt-2">
                Geen AI-debug info beschikbaar (verwerking mislukt).
              </div>
            )}
          </div>
          
          <div className="mt-6 pt-6 border-t border-slate-100">
            <div className="flex items-start gap-3 text-xs text-slate-500 bg-slate-50 p-3 rounded-lg">
              <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
              <p>Deze gegevens worden gegenereerd tijdens de verwerking om de stabiliteit en nauwkeurigheid van de AI te monitoren.</p>
            </div>
          </div>
        </div>
        
        <div className="bg-slate-50 px-6 py-4 flex justify-end">
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            Sluiten
          </button>
        </div>
      </div>
    </div>
  );
};

const DebugItem = ({ label, value }: { label: string; value: string }) => (
  <div className="space-y-1">
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
    <p className="text-sm font-mono text-slate-700 bg-slate-50 px-2 py-1 rounded border border-slate-100 truncate">
      {value}
    </p>
  </div>
);

const DebugStatusItem = ({ label, active }: { label: string; active: boolean }) => (
  <div className="space-y-1">
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
    <div className={`flex items-center gap-1.5 text-sm font-medium ${active ? 'text-emerald-600' : 'text-slate-500'}`}>
      {active ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
      {active ? 'Actief' : 'Inactief'}
    </div>
  </div>
);

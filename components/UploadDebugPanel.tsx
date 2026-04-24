
import React from 'react';
import { CheckCircle, Copy, ExternalLink, FileText, AlertCircle } from 'lucide-react';

interface UploadDebugPanelProps {
  uploadData: {
    path: string;
    signedUrl: string;
  } | null;
  error: string | null;
  onClose: () => void;
}

export const UploadDebugPanel: React.FC<UploadDebugPanelProps> = ({ uploadData, error, onClose }) => {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="bg-slate-900 px-6 py-4 flex items-center justify-between">
          <h3 className="text-white font-bold flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-400" />
            Supabase Upload Debug
          </h3>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            Sluiten
          </button>
        </div>

        <div className="p-6">
          {error ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 text-red-800 mb-4">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <div>
                <p className="font-bold text-sm">Upload mislukt</p>
                <p className="text-xs opacity-90">{error}</p>
              </div>
            </div>
          ) : uploadData ? (
            <div className="space-y-6">
              <div className="flex items-center gap-3 text-emerald-600 bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                <CheckCircle className="w-6 h-6" />
                <div>
                  <p className="font-bold">Upload succesvol!</p>
                  <p className="text-xs opacity-80">Bestand is opgeslagen in de 'recordings' bucket.</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Storage Path</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-grow bg-slate-100 p-2.5 rounded-lg text-xs text-slate-700 border border-slate-200 break-all">
                      {uploadData.path}
                    </code>
                    <button 
                      onClick={() => copyToClipboard(uploadData.path)}
                      className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors border border-slate-200"
                      title="Kopieer pad"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Signed URL (1 uur geldig)</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-grow bg-slate-100 p-2.5 rounded-lg text-xs text-slate-700 border border-slate-200 break-all max-h-24 overflow-y-auto">
                      {uploadData.signedUrl}
                    </code>
                    <div className="flex flex-col gap-2">
                      <button 
                        onClick={() => copyToClipboard(uploadData.signedUrl)}
                        className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors border border-slate-200"
                        title="Kopieer URL"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <a 
                        href={uploadData.signedUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="p-2.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg transition-colors border border-blue-100"
                        title="Open in nieuw tabblad"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-slate-400">
              <p>Geen upload data beschikbaar.</p>
            </div>
          )}
        </div>

        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-end">
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-slate-900 text-white rounded-lg font-bold hover:bg-slate-800 transition-colors"
          >
            Begrepen
          </button>
        </div>
      </div>
    </div>
  );
};

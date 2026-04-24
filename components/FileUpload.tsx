import React, { useRef, useState } from 'react';
import { Upload, FileAudio, AlertCircle } from 'lucide-react';
import { FileData } from '../types';

interface FileUploadProps {
  onFileSelect: (fileData: FileData) => void;
  disabled: boolean;
}

export const FileUpload: React.FC<FileUploadProps> = React.memo(({ onFileSelect, disabled }) => {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const processFile = (file: File) => {
    setError(null);
    
    // Basic validation
    if (!file.type.startsWith('audio/') && !file.type.startsWith('video/')) {
      setError("Upload a.u.b. een geldig audio- of videobestand (mp3, wav, m4a, mp4).");
      return;
    }

    onFileSelect({
      name: file.name,
      size: file.size,
      type: file.type,
      blob: file
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const onButtonClick = () => {
    inputRef.current?.click();
  };

  return (
    <div className="w-full max-w-2xl mx-auto mb-8">
      <div
        className={`relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-xl transition-all duration-300 ease-in-out ${
          dragActive 
            ? "border-blue-500 bg-blue-50 scale-[1.02]" 
            : "border-slate-300 bg-white hover:bg-slate-50"
        } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        onDragEnter={!disabled ? handleDrag : undefined}
        onDragLeave={!disabled ? handleDrag : undefined}
        onDragOver={!disabled ? handleDrag : undefined}
        onDrop={!disabled ? handleDrop : undefined}
        onClick={!disabled ? onButtonClick : undefined}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept="audio/*,video/*"
          onChange={handleChange}
          disabled={disabled}
        />

        <div className="flex flex-col items-center text-center p-6 space-y-4">
          <div className={`p-4 rounded-full ${dragActive ? 'bg-blue-100' : 'bg-slate-100'}`}>
            <FileAudio className={`w-8 h-8 ${dragActive ? 'text-blue-600' : 'text-slate-500'}`} />
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-700">
              Sleep je audiobestand hierheen
            </p>
            <p className="text-sm text-slate-500 mt-1">
              of klik om te bladeren (MP3, WAV, M4A)
            </p>
          </div>
          <div className="text-xs text-slate-400">
            Maximale verwerking hangt af van bestandsgrootte.
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-700 animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p className="text-sm">{error}</p>
        </div>
      )}
    </div>
  );
});

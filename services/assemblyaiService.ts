const ASSEMBLYAI_API_URL = "https://api.assemblyai.com/v2";

type AnyEnv = Record<string, any>;
const env: AnyEnv = (import.meta as any).env || {};

const API_KEY: string | undefined =
  env.VITE_ASSEMBLYAI_API_KEY ||
  env.ASSEMBLYAI_API_KEY;

export type Segment = {
  start_ms: number;
  end_ms: number;
  speaker?: string;
  text: string;
};

export type AsrResult = {
  id: string;
  fullText: string;
  segments: Segment[];
  raw: any;
};

export type AssemblyOptions = {
  diarization?: boolean;          // speaker labels
  timeoutMs?: number;             // total polling timeout
  pollIntervalMs?: number;        // base poll interval
  speechModels?: string[];        // Assembly speech model list
  signal?: AbortSignal;           // allow cancel from UI
};

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => resolve(), ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true }
      );
    }
  });
}

async function safeReadError(res: Response): Promise<string> {
  // AssemblyAI often returns JSON with { error: "..." }, but not always.
  const text = await res.text().catch(() => "");
  if (!text) return res.statusText || "Unknown error";

  try {
    const json = JSON.parse(text);
    if (json?.error) return String(json.error);
    return JSON.stringify(json);
  } catch {
    return text.slice(0, 500);
  }
}

function mapUtterancesToSegments(utterances: any[]): Segment[] {
  if (!Array.isArray(utterances)) return [];
  return utterances
    .map((u) => ({
      start_ms: Number(u?.start ?? 0),
      end_ms: Number(u?.end ?? 0),
      speaker: u?.speaker != null ? String(u.speaker) : undefined,
      text: String(u?.text ?? "").trim(),
    }))
    .filter((s) => s.text.length > 0 && s.end_ms >= s.start_ms);
}

/**
 * Transcribeert audio via AssemblyAI (pre-recorded).
 * Input: audioUrl = Supabase signed URL
 */
export async function transcribeWithAssemblyAI(
  audioUrl: string,
  options: AssemblyOptions = {}
): Promise<AsrResult> {
  if (!API_KEY) {
    throw new Error(
      "AssemblyAI API key ontbreekt. Stel VITE_ASSEMBLYAI_API_KEY in als Vercel environment variable."
    );
  }

  if (!audioUrl || !audioUrl.startsWith("http")) {
    throw new Error("audioUrl is ongeldig. Verwacht een (signed) https URL.");
  }

  const diarization = options.diarization ?? true;
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const basePoll = options.pollIntervalMs ?? 2000;

  // Per API error: must be non-empty list
  const speechModels = options.speechModels ?? ["universal-3-pro", "universal-2"];

  if (import.meta.env.DEV) console.log("ASSEMBLYAI_START");

  // 1) Submit transcript job
  const submitRes = await fetch(`${ASSEMBLYAI_API_URL}/transcript`, {
    method: "POST",
    headers: {
      Authorization: API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speaker_labels: diarization,
      speech_models: speechModels,
      // You can add more config here later:
      // language_code: "nl",
      // punctuate: true,
      // format_text: true,
    }),
    signal: options.signal,
  });

  if (!submitRes.ok) {
    const msg = await safeReadError(submitRes);
    throw new Error(`AssemblyAI Submit Error (${submitRes.status}): ${msg}`);
  }

  const submitJson = await submitRes.json();
  const transcriptId: string = submitJson?.id;
  if (!transcriptId) {
    throw new Error("AssemblyAI: geen transcript ID teruggekregen.");
  }

  // 2) Poll until completed/error/timeout
  const started = Date.now();
  let pollCount = 0;

  while (Date.now() - started < timeoutMs) {
    pollCount++;
    if (import.meta.env.DEV && (pollCount === 1 || pollCount % 5 === 0)) {
      console.log("ASSEMBLYAI_POLL", `#${pollCount}`);
    }

    const pollRes = await fetch(`${ASSEMBLYAI_API_URL}/transcript/${transcriptId}`, {
      headers: { Authorization: API_KEY },
      signal: options.signal,
    });

    if (!pollRes.ok) {
      const msg = await safeReadError(pollRes);
      throw new Error(`AssemblyAI Poll Error (${pollRes.status}): ${msg}`);
    }

    const transcript = await pollRes.json();

    const status = transcript?.status;
    if (status === "completed") {
      if (import.meta.env.DEV) console.log("ASSEMBLYAI_DONE");

      const segments = mapUtterancesToSegments(transcript?.utterances ?? []);
      const fullText = String(transcript?.text ?? "");

      return {
        id: String(transcript?.id ?? transcriptId),
        fullText,
        segments,
        raw: transcript,
      };
    }

    if (status === "error") {
      const errMsg = transcript?.error ? String(transcript.error) : "Unknown processing error";
      throw new Error(`AssemblyAI Processing Error: ${errMsg}`);
    }

    // adaptive polling: small backoff + jitter to reduce spam & rate issues
    const jitter = Math.floor(Math.random() * 250);
    const backoff = Math.min(6000, basePoll + Math.floor(pollCount / 6) * 500);
    await sleep(backoff + jitter, options.signal);
  }

  throw new Error(`AssemblyAI Transcription timed out after ${Math.round(timeoutMs / 1000)}s.`);
}
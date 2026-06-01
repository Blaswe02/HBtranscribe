
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { TranscriptionResult, TranscriptionMode, TranscriptionLanguage } from "../types";

const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || process.env.API_KEY;
const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1beta' } });

export interface TranscriptionOptions {
  mode: TranscriptionMode;
  language: TranscriptionLanguage;
  showTimestamps: boolean;
  showSpeakerLabels: boolean;
}

const MAX_CACHE_SIZE = 50;

// Simple cache for deduplication
let requestCache = new Map<string, Promise<TranscriptionResult>>();

export const clearCache = () => {
  requestCache.clear();
};

const addToCache = (key: string, value: Promise<TranscriptionResult>) => {
  if (requestCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry
    requestCache.delete(requestCache.keys().next().value!);
  }
  requestCache.set(key, value);
};

const TRANSCRIPTION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    mode: { 
      type: Type.STRING,
      description: "De geselecteerde transcriptiemodus (VERBATIM, READABLE, SUMMARY)."
    },
    language: { 
      type: Type.STRING,
      description: "De gedetecteerde of geselecteerde taal."
    },
    transcript: {
      type: Type.STRING,
      description: "De volledige transcriptietekst volgens de regels van de modus.",
    },
    continued_from: {
      type: Type.STRING,
      description: "Tijdstempel [MM:SS] als de output is afgebroken en vervolgd moet worden, anders null.",
    },
    needs_followup: {
      type: Type.BOOLEAN,
      description: "True als de transcriptie niet volledig paste in één antwoord en er meer tekst volgt.",
    }
  },
  required: ["mode", "language", "transcript", "continued_from", "needs_followup"],
};

function cleanJsonString(jsonString: string): string {
  let cleaned = jsonString.trim();
  
  // 1. Strip code fences if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  
  // 2. Extract first complete JSON object if there's extra text around it
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  
  return cleaned.trim();
}

const mapError = (error: any): string => {
  const message = error?.message || "";
  const status = error?.status || 0;
  
  if (message.includes("429") || message.includes("quota") || message.includes("RESOURCE_EXHAUSTED")) {
    return "Te veel aanvragen. Wacht even en probeer het opnieuw (Rate limit).";
  }
  if (message.includes("500") || message.includes("503") || message.includes("overbelast")) {
    return "Gemini server is tijdelijk overbelast. We proberen het automatisch opnieuw...";
  }
  if (message.includes("413") || message.includes("too large") || message.includes("Payload Too Large")) {
    return "Bestand is te groot voor één verwerking. We proberen het op te delen in kleinere stukken.";
  }
  if (message.includes("abort") || message.includes("CANCELLED")) {
    return "Verwerking geannuleerd door gebruiker.";
  }
  if (message.includes("Network") || message.includes("fetch")) {
    return "Netwerkfout. Controleer je internetverbinding en probeer het opnieuw.";
  }
  if (message.includes("valide JSON")) {
    return "AI gaf geen valide JSON terug. De output was mogelijk te lang of vervuild.";
  }
  if (message.includes("max tokens limit") || message.includes("token limit")) {
    return "De transcriptie is te lang voor één verwerking (Token limit). We proberen het automatisch in kleinere stukken.";
  }
  
  if (import.meta.env.DEV) console.error("Unmapped Gemini Error:", error);
  return "Er is een onbekende fout opgetreden bij de AI. Probeer een korter fragment of een kleiner bestand.";
};

const BACKOFF_SCHEDULE = [2000, 5000, 12000];

const isRetryableError = (error: any): boolean => {
  const message = error?.message || "";
  return (
    message.includes("429") || 
    message.includes("500") || 
    message.includes("503") || 
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("overbelast") ||
    message.includes("quota") ||
    message.includes("fetch") ||
    message.includes("Network")
  );
};

const withRetry = async <T>(
  fn: () => Promise<T>, 
  retries = 3, 
  signal?: AbortSignal,
  onRetry?: (attempt: number, delay: number) => void
): Promise<T> => {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      if (signal?.aborted) throw new Error("aborted");
      return await fn();
    } catch (error: any) {
      if (signal?.aborted) throw error;
      
      const retryable = isRetryableError(error);
      if (attempt < retries && retryable) {
        const baseDelay = BACKOFF_SCHEDULE[attempt] || 12000;
        const jitter = Math.random() * 500;
        const totalDelay = baseDelay + jitter;
        
        if (import.meta.env.DEV) {
          console.log(`[Gemini Retry] Attempt ${attempt + 1}/${retries} after ${Math.round(totalDelay)}ms. Error: ${error.message}`);
        }
        
        if (onRetry) onRetry(attempt + 1, totalDelay);
        
        await new Promise(resolve => setTimeout(resolve, totalDelay));
        attempt++;
      } else {
        throw error;
      }
    }
  }
  throw new Error("Max retries reached");
};

export const transcribeAudio = async (
  input: { 
    blob?: Blob; 
    mimeType?: string; 
    text?: string; 
    isChunk?: boolean;
    chunkNumber?: number;
    totalChunks?: number;
    options: TranscriptionOptions;
  },
  signal?: AbortSignal,
  onRetry?: (attempt: number, delay: number) => void
): Promise<TranscriptionResult> => {
  // Deduplication hash (simple version)
  const hash = input.text
    ? `text-${input.options.mode}-${input.options.language}-${input.text.slice(0, 100)}`
    : input.blob
    ? `blob-${input.blob.size}-${input.blob.type}-${input.chunkNumber ?? 0}-${input.totalChunks ?? 1}-${input.options.mode}-${input.options.language}-${input.options.showTimestamps}-${input.options.showSpeakerLabels}`
    : 'empty';
  if (requestCache.has(hash)) return requestCache.get(hash)!;

  const task = withRetry(async () => {
    const modelId = "gemini-2.5-flash";

    const langMap = {
      [TranscriptionLanguage.DUTCH]: "Nederlands",
      [TranscriptionLanguage.ENGLISH]: "Engels",
      [TranscriptionLanguage.AUTO]: "Automatisch detecteren"
    };
    const targetLang = langMap[input.options.language];
    let systemInstruction = "";
    if (input.options.mode === TranscriptionMode.VERBATIM) {
      systemInstruction = `Je bent een nauwkeurige transcriptie-assistent.

Je taak is om audio om te zetten naar een VOLLEDIGE, WOORDELIJKE transcriptie in het Nederlands.

BELANGRIJKE REGELS:
- Vat niets samen.
- Laat niets bewust weg.
- Maak de tekst niet korter of mooier dan uitgesproken.
- Gebruik alleen leestekens en alinea’s om de transcriptie leesbaar te maken.
- Behoud de oorspronkelijke inhoud zo volledig mogelijk.
- Gebruik Nederlands als outputtaal.
- Als iets niet goed verstaanbaar is, schrijf: [onverstaanbaar].
- Als meerdere sprekers hoorbaar zijn, gebruik labels zoals:
  Spreker 1:
  Spreker 2:
- ${input.options.showTimestamps ? "Voeg tijdstempels toe per logisch segment in formaat [MM:SS]." : "Voeg GEEN tijdstempels toe."}
- Geef alleen transcriptie terug in het JSON veld 'transcript', geen uitleg, analyse of samenvatting.
- Als het antwoord te lang wordt, stop dan niet met een samenvatting maar eindig exact met:
  [VERVOLG NODIG VANAF MM:SS]
- Zet in dat geval 'needs_followup' op true en geef de laatste tijdstempel in 'continued_from'.

Volledigheid en woordelijke weergave gaan altijd vóór mooi schrijven.

Retourneer strikt JSON volgens het schema.`;
    }
 else if (input.options.mode === TranscriptionMode.READABLE) {
      systemInstruction = `Je bent een zorgvuldige tekstredacteur.

Je taak is om een transcriptie om te zetten naar goed leesbare tekst, zonder inhoud te verliezen.

BELANGRIJKE REGELS:
- Laat niets weg.
- Vat niets samen.
- Maak zinnen leesbaarder, maar behoud alle betekenis.
- Verwijder alleen kleine stopwoorden of herhalingen als ze geen inhoud toevoegen.
- Behoud de volgorde van de informatie.
- Voeg geen nieuwe informatie toe.
- Gebruik Nederlands als outputtaal.
- Geef de herschreven tekst terug in het JSON veld 'transcript'.
- Als het antwoord te lang wordt, stop dan niet met een samenvatting maar eindig exact met:
  [VERVOLG NODIG VANAF MM:SS]
- Zet in dat geval 'needs_followup' op true en geef de laatste tijdstempel in 'continued_from'.

Retourneer strikt JSON volgens het schema.`;
    } else if (input.options.mode === TranscriptionMode.SUMMARY) {
      systemInstruction = `Je bent een assistent voor notulen en samenvattingen.

Je taak is om een transcriptie samen te vatten in helder Nederlands.

BELANGRIJKE REGELS:
- Gebruik alleen informatie uit de transcriptie.
- Voeg niets toe dat niet genoemd is.
- Maak een duidelijke, compacte samenvatting.
- Benoem hoofdonderwerpen, belangrijke afspraken en opvallende punten.
- Geef de samenvatting terug in het JSON veld 'transcript'.
- Als het antwoord te lang wordt, eindig exact met:
  [VERVOLG NODIG VANAF MM:SS]

Retourneer strikt JSON volgens het schema.`;
    } else {
      const transcriptionRules = `
- Vat niets samen in het 'transcript' veld.
- Laat niets bewust weg.
- Maak de tekst niet korter of mooier dan uitgesproken.
- Gebruik alleen leestekens en alinea’s om de transcriptie leesbaar te maken.
- Behoud de oorspronkelijke inhoud zo volledig mogelijk.
- Gebruik ${targetLang} als outputtaal.
- Als iets niet goed verstaanbaar is, schrijf: [onverstaanbaar].
${input.options.showSpeakerLabels ? "- Gebruik labels voor sprekers zoals: Spreker 1:, Spreker 2:." : "- Gebruik GEEN sprekerlabels."}
${input.options.showTimestamps ? "- Voeg tijdstempels toe per logisch segment in formaat [MM:SS]." : "- Voeg GEEN tijdstempels toe."}
- Als het antwoord te lang wordt, stop dan niet met een samenvatting maar eindig exact met:
  [VERVOLG NODIG VANAF MM:SS]
- Zet in dat geval 'needs_followup' op true en geef de laatste tijdstempel in 'continued_from'.
- Volledigheid gaat altijd vóór mooi schrijven.`;

      const modeInstructions = {
        [TranscriptionMode.VERBATIM]: "", // Handled above
        [TranscriptionMode.READABLE]: "Focus op een goed leesbare tekst in het 'transcript' veld. Verwijder stopwoorden en haperingen, maar behoud de volledige inhoud.",
        [TranscriptionMode.SUMMARY]: "Focus op de essentie in het 'transcript' veld. Maak een gestructureerde samenvatting."
      };

      systemInstruction = input.isChunk 
        ? `Je bent een nauwkeurige transcriptie-assistent. Je verwerkt een DEEL van een audiobestand.
           Modus: ${input.options.mode}. ${modeInstructions[input.options.mode]}
           
           Volg deze regels strikt voor het 'transcript' veld:${transcriptionRules}
           
           Retourneer strikt JSON volgens het schema.`
        : `Je bent een nauwkeurige transcriptie-assistent.
           Modus: ${input.options.mode}. ${modeInstructions[input.options.mode]}
           
           Volg deze regels strikt voor het 'transcript' veld:${transcriptionRules}
           
           Retourneer strikt JSON volgens het schema.`;
    }

    let base64Data = "";
    if (input.blob) {
      const reader = new FileReader();
      base64Data = await new Promise((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(input.blob!);
      });
    }

    let userPrompt = "";
    if (input.options.mode === TranscriptionMode.VERBATIM) {
      userPrompt = "Transcribeer deze audio VOLLEDIG en WOORDELIJK volgens de instructies hierboven. NOOIT samenvatten. NIETS weglaten. Geef ALLEEN de transcriptie terug.";
      if (input.isChunk && input.chunkNumber !== undefined && input.totalChunks !== undefined) {
        userPrompt += `\n\nDit is deel ${input.chunkNumber} van ${input.totalChunks}.`;
      }
    } else if (input.options.mode === TranscriptionMode.READABLE) {
      userPrompt = "Herschrijf deze transcriptie naar leesbare, nette tekst zonder inhoud te verliezen. Geen samenvatting. Geen verkorting.";
      if (input.isChunk && input.chunkNumber !== undefined && input.totalChunks !== undefined) {
        userPrompt += `\n\nDit is deel ${input.chunkNumber} van ${input.totalChunks}.`;
      }
    } else if (input.options.mode === TranscriptionMode.SUMMARY) {
      userPrompt = "Maak van deze transcriptie een duidelijke samenvatting in het Nederlands met:\n1. Korte samenvatting\n2. Belangrijkste besproken punten\n3. Eventuele afspraken of besluiten";
      if (input.isChunk && input.chunkNumber !== undefined && input.totalChunks !== undefined) {
        userPrompt += `\n\nDit is deel ${input.chunkNumber} van ${input.totalChunks}.`;
      }
    } else if (input.text) {
      userPrompt = `Verwerk de volgende live getranscribeerde tekst naar een gestructureerd verslag in het ${targetLang}: ${input.text}`;
    } else if (input.isChunk && input.chunkNumber !== undefined && input.totalChunks !== undefined) {
      userPrompt = `Transcribeer dit audiodeel volledig in het ${targetLang}.

Extra regels:
- Dit is deel ${input.chunkNumber} van ${input.totalChunks}.
- Begin direct met transcriptie.
- Laat geen inhoud weg.
${input.options.showTimestamps ? "- Gebruik tijdstempels [MM:SS] binnen dit fragment." : "- Gebruik GEEN tijdstempels."}
- Geef alleen transcriptie terug.

Belangrijk:
Dit fragment moet zo volledig mogelijk worden uitgeschreven, ook als zinnen onaf zijn.`;
    } else {
      userPrompt = input.isChunk ? "Transcribeer dit audiofragment." : "Transcribeer en analyseer dit audiobestand.";
    }

    const contents = { 
      parts: [
        ...(input.blob ? [{ inlineData: { mimeType: input.mimeType || 'audio/mp3', data: base64Data } }] : []),
        { text: userPrompt }
      ]
    };

    const isTranscriptionMode = input.options.mode === TranscriptionMode.VERBATIM || input.options.mode === TranscriptionMode.READABLE;

    const response = await ai.models.generateContent({
      model: modelId,
      contents,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: TRANSCRIPTION_SCHEMA,
        temperature: isTranscriptionMode ? 0 : 0.1,
        topP: isTranscriptionMode ? 0.1 : 0.95,
        topK: isTranscriptionMode ? 1 : 64,
        maxOutputTokens: 16384,
      },
    });

    const text = response.text;
    if (!text) throw new Error("Geen antwoord ontvangen van Gemini.");

    let result: TranscriptionResult;
    try {
      result = JSON.parse(cleanJsonString(text)) as TranscriptionResult;
    } catch (parseError) {
      console.error("JSON Parse Error. Raw text snippet:", text.slice(0, 300) + " ... " + text.slice(-300));
      throw new Error("AI gaf geen valide JSON terug");
    }

    result.debugInfo = {
      modelName: modelId,
      temperature: isTranscriptionMode ? 0 : 0.1,
      chunksCount: input.totalChunks || 1,
      isStructuredOutput: true,
      needsFollowup: result.needs_followup
    };

    return result;
  }, 3, signal, onRetry).catch(err => {
    requestCache.delete(hash);
    throw new Error(mapError(err));
  });

  addToCache(hash, task);
  return task;
};

export const mergeTranscriptions = async (
  chunks: TranscriptionResult[],
  options: TranscriptionOptions,
  signal?: AbortSignal
): Promise<TranscriptionResult> => {
  if (chunks.length === 1) return chunks[0];

  return withRetry(async () => {
    const modelId = "gemini-2.5-flash";
    const combinedTranscript = chunks.map((c, i) => `[Fragment ${i+1}]\n${c.transcript}`).join("\n\n");

    const langMap = {
      [TranscriptionLanguage.DUTCH]: "Nederlands",
      [TranscriptionLanguage.ENGLISH]: "Engels",
      [TranscriptionLanguage.AUTO]: "Automatisch gedetecteerd"
    };
    const targetLang = langMap[options.language];

    const prompt = `
      Smeed deze transcripties samen tot één vloeiend geheel in het ${targetLang}.
      
      TRANSCRIPTIE DELEN (CHUNKS):
      ${combinedTranscript}
      
      Zorg dat de overgangen tussen de fragmenten naadloos zijn en dat er geen tekst dubbel staat door de overlap.
    `;

    const isTranscriptionMode = options.mode === TranscriptionMode.VERBATIM || options.mode === TranscriptionMode.READABLE;

    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        systemInstruction: `Je bent een gespecialiseerde transcriptie-redacteur.
        
Je taak is om meerdere opeenvolgende transcriptie-chunks (die met overlap zijn gemaakt) samen te voegen tot één logisch, doorlopend document.

STRIKTE REGELS VOOR HET 'transcript' VELD:
1. LAAT GEEN INHOUD WEG. Elke zin uit de bron-chunks moet in het eindresultaat staan.
2. VAT NIETS SAMEN. De tekst moet woordelijk (of leesbaar, afhankelijk van de bron) blijven.
3. VERWIJDER OVERLAP: Omdat de chunks met overlap zijn gemaakt, zul je aan het eind van chunk N en het begin van chunk N+1 dezelfde tekst zien. Verwijder deze dubbelingen zodat de zin vloeiend doorloopt.
4. BEHOUD DE VOLGORDE: De chronologische volgorde van de fragmenten is heilig.
5. BEHOUD TIJDSTEMPELS: Als er tijdstempels ([MM:SS]) in de bron staan, neem deze dan over in het eindresultaat.
6. GEEN EXTRA TEKST: Voeg geen eigen commentaar, inleidingen of conclusies toe.
7. Als het antwoord te lang wordt, eindig exact met: [VERVOLG NODIG VANAF MM:SS]

Het resultaat moet één schone, volledige transcriptie zijn.`,
        responseMimeType: "application/json",
        responseSchema: TRANSCRIPTION_SCHEMA,
        // TECHNICAL SETTINGS FOR MERGING
        temperature: isTranscriptionMode ? 0 : 0.1,
        topP: isTranscriptionMode ? 0.1 : 0.95,
        topK: isTranscriptionMode ? 1 : 64,
        maxOutputTokens: 16384, // Increased to avoid token limit errors
        // Thinking budget 0 for Gemini 2.5 Flash in transcription mode
      },
    });

    const text = response.text;
    if (!text) throw new Error("Fout bij samenvoegen.");
    
    let result: TranscriptionResult;
    try {
      result = JSON.parse(cleanJsonString(text)) as TranscriptionResult;
    } catch (parseError) {
      console.error("JSON Parse Error (Merge). Raw text snippet:", text.slice(0, 300) + " ... " + text.slice(-300));
      throw new Error("AI gaf geen valide JSON terug");
    }
    
    result.debugInfo = {
      modelName: modelId,
      temperature: isTranscriptionMode ? 0 : 0.1,
      chunksCount: chunks.length,
      isStructuredOutput: true,
      needsFollowup: result.needs_followup
    };

    return result;
  }, 3, signal).catch(err => {
    throw new Error(mapError(err));
  });
};

export const generateView = async (
  type: 'minutes' | 'actionPoints' | 'shortSummary',
  fullTranscript: string,
  signal?: AbortSignal,
  onRetry?: (attempt: number, delay: number) => void
): Promise<string> => {
  const cacheKey = `view-${type}-${fullTranscript.length}-${fullTranscript.substring(0, 50)}`;
  if (requestCache.has(cacheKey)) {
    const cached = await requestCache.get(cacheKey);
    return (cached as any)[type] || "";
  }

  const task = withRetry(async () => {
    const modelId = "gemini-2.5-flash";

    let prompt = "";
    let systemInstruction = "";

    if (type === 'minutes') {
      systemInstruction = `Je bent een professionele notulist die formele vergaderverslagen opstelt in zakelijk Nederlands.

Je schrijft altijd in de derde persoon en attribueert uitspraken aan de juiste persoon als de naam bekend is uit de transcriptie ("Jan geeft aan dat...", "De voorzitter stelt voor...", "De groep besluit...").

Je volgt ALTIJD exact het onderstaande format — niet meer, niet minder. Geen markdown-opmaak zoals ** of ##. Gewone tekst met nummers en bullets.`;

      prompt = `Stel een volledig vergaderverslag op op basis van deze transcriptie.

TRANSCRIPTIE:
${fullTranscript}

VERPLICHT FORMAT (volg dit exact):

Verslag vergadering [naam van de vergadering of onderwerp]
[Dag] [datum], [starttijd] – [eindtijd]
Locatie: [locatie, of weglaten als onbekend]

Aanwezig: [namen gescheiden door komma's, of "Onbekend" als niet vermeld]
Afgemeld: [namen, of deze regel weglaten als niemand afgemeld]

VERSLAG, ACTIE- EN BESLUITENLIJST:

[Nummer elk agendapunt dat besproken is. Gebruik bullets (•) voor inhoud. Sluit elk punt met besluiten af als die genomen zijn.]

1. [Naam agendapunt]
• [Besproken punt]
• [Besproken punt, met naam als duidelijk wie het zei]

Besluiten:
  ➢ [Besluit 1]
  ➢ [Besluit 2]

2. [Naam agendapunt]
• [Besproken punt]

[Geen besluiten = geen "Besluiten:" blok voor dit punt]

[Ga door voor alle besproken agendapunten]

REGELS:
- Gebruik GEEN markdown (geen **, geen ##, geen ---)
- Noem namen als duidelijk is wie iets zei
- Besluiten altijd onder "Besluiten:" met ➢
- Actiepunten zijn ook besluiten: benoem wie de actie oppakt
- Als een agendapunt geen inhoud had: één korte zin volstaat
- Sluit af met datum/tijd van afsluiting als die bekend is`;

    } else if (type === 'actionPoints') {
      systemInstruction = "Je bent een nauwkeurige notulist. Extraheer actiepunten in zakelijk Nederlands.";
      prompt = `Extraheer alle actiepunten en besluiten met een eigenaar uit deze transcriptie als een genummerde checklist.

TRANSCRIPTIE:
${fullTranscript}

FORMAT:
Actiepunten & besluiten:

1. [ ] [Actiepunt] — [Eigenaar of "TBD"]
2. [ ] [Actiepunt] — [Eigenaar of "TBD"]

Neem alleen concrete acties en besluiten op, geen discussiepunten.`;

    } else if (type === 'shortSummary') {
      systemInstruction = "Je bent een bondige samenvatten in zakelijk Nederlands.";
      prompt = `Geef een korte samenvatting van deze vergadering in maximaal 5 bullets. Noem alleen de belangrijkste besproken onderwerpen en genomen besluiten.

TRANSCRIPTIE:
${fullTranscript}

FORMAT:
• [Punt 1]
• [Punt 2]
• [Punt 3]`;
    }

    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        systemInstruction,
        temperature: 0.1,
        topP: 0.95,
        topK: 64,
        maxOutputTokens: 8192,
      },
    });

    const text = response.text || "";
    return text;
  }, 2, signal, onRetry);

  // Store in cache as a pseudo-TranscriptionResult for compatibility with the existing cache map
  addToCache(cacheKey, task.then(text => ({ [type]: text } as any)));
  return task;
};

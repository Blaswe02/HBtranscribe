
/**
 * Transcript Worker
 * Handles heavy string processing and formatting off the main thread.
 */

const formatTranscript = (text: string): string => {
  // 1. Basic Cleanup & Stopword removal (fillers)
  // Dutch fillers: ehm, uh, even kijken, zeg maar, weet je, eigenlijk, gewoon
  let cleaned = text
    .replace(/\b(ehm|uh|uhm|even kijken|zeg maar|weet je|eigenlijk|gewoon)\b/gi, '')
    .replace(/[ \t]+/g, ' ')             // Normalize spaces/tabs
    .replace(/\n\s*\n/g, '\n\n')         // Normalize double newlines
    .trim();

  // 2. Auto-paragraphing
  // We want to split the text into paragraphs every ~3-5 sentences or ~500 characters
  // but only if there aren't already explicit paragraphs.
  if (!cleaned.includes('\n\n')) {
    const sentences = cleaned.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [cleaned];
    let currentParagraph = '';
    let paragraphs: string[] = [];
    let charCount = 0;
    let sentenceCount = 0;

    sentences.forEach((sentence) => {
      const trimmedSentence = sentence.trim();
      if (!trimmedSentence) return;

      currentParagraph += (currentParagraph ? ' ' : '') + trimmedSentence;
      charCount += trimmedSentence.length;
      sentenceCount++;

      if (sentenceCount >= 4 || charCount >= 500) {
        paragraphs.push(currentParagraph);
        currentParagraph = '';
        charCount = 0;
        sentenceCount = 0;
      }
    });

    if (currentParagraph) {
      paragraphs.push(currentParagraph);
    }

    cleaned = paragraphs.join('\n\n');
  }

  return cleaned;
};

onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'PROCESS_LIVE_TRANSCRIPT') {
    const { segments, partialText } = payload;
    
    // 1. Merge segments and partial text
    const combined = [...segments, partialText].join(' ');
    
    // 2. Process
    const processed = formatTranscript(combined);

    postMessage({
      type: 'LIVE_TRANSCRIPT_PROCESSED',
      payload: {
        processedText: processed,
        formattedText: processed
      }
    });
  }

  if (type === 'PROCESS_FINAL_RESULT') {
    const result = payload;
    const isVerbatim = result.mode === 'verbatim';

    // For verbatim, we don't want to remove fillers or change the text too much
    // as the model was instructed to be exact.
    const processedTranscript = isVerbatim 
      ? result.transcript.replace(/[ \t]+/g, ' ').trim() 
      : formatTranscript(result.transcript);

    postMessage({
      type: 'FINAL_RESULT_PROCESSED',
      payload: {
        ...result,
        transcript: processedTranscript,
        minutes: result.minutes ? formatTranscript(result.minutes) : undefined,
        actionPoints: result.actionPoints ? formatTranscript(result.actionPoints) : undefined,
        shortSummary: result.shortSummary ? formatTranscript(result.shortSummary) : undefined
      }
    });
  }
};

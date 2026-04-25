import meta from "../metadata.json";
import { GoogleGenAI } from "@google/genai";

const env: Record<string, any> = (import.meta as any).env || {};

function getGeminiKey(): string | undefined {
  return (
    env.VITE_GEMINI_API_KEY ||
    env.GEMINI_API_KEY ||
    (meta as any)?.gemini?.apiKey ||
    (meta as any)?.GEMINI_API_KEY
  );
}

export type InsightResult = {
  summary: string;
  highlights: { title: string; detail: string; time?: string }[];
  action_items: { task: string; owner?: string; due?: string }[];
  key_quotes: { quote: string; speaker?: string; time?: string }[];
  tags: string[];
};

function msToTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export async function generateInsightsFromTranscript(input: {
  language?: "nl" | "en";
  title?: string;
  fullText: string;
  segments?: { start_ms: number; end_ms: number; speaker?: string; text: string }[];
}): Promise<InsightResult> {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    throw new Error(
      "Gemini API key ontbreekt. Zet VITE_GEMINI_API_KEY (AI Studio env) of metadata.json → gemini.apiKey."
    );
  }

  const ai = new GoogleGenAI({ apiKey });

  const language = input.language ?? "nl";

  const compactSegments =
    input.segments?.slice(0, 400).map((s) => ({
      t: msToTime(s.start_ms),
      sp: s.speaker ?? "",
      tx: s.text,
    })) ?? [];

  const system = `You are a precise analyst. Return ONLY valid JSON. No markdown. No extra text.
Language for all fields: ${language === "nl" ? "Dutch" : "English"}.
Keep it concise and useful.`;

  const payload = {
    title: input.title ?? "Transcript",
    transcript: input.fullText.slice(0, 20000),
    segments_hint: compactSegments,
    output_schema: {
      summary: "string",
      highlights: [{ title: "string", detail: "string", time: "MM:SS optional" }],
      action_items: [{ task: "string", owner: "string optional", due: "string optional" }],
      key_quotes: [{ quote: "string", speaker: "string optional", time: "MM:SS optional" }],
      tags: ["string"],
    },
  };

  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: system }, { text: JSON.stringify(payload) }] }],
    config: { temperature: 0.2 },
  });

  const text = (res.text ?? "").trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  const jsonStr = first >= 0 && last > first ? text.slice(first, last + 1) : text;

  try {
    const parsed = JSON.parse(jsonStr);
    return parsed as InsightResult;
  } catch {
    console.error("GEMINI_INSIGHTS_PARSE_FAIL", text.slice(0, 400));
    throw new Error("Gemini gaf geen valide JSON terug voor insights.");
  }
}
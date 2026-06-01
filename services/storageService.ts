import { supabase } from "../lib/supabaseClient";

export const RECORDINGS_BUCKET = "recordings";

// Kleine helper: veilige bestandsnaam
function safeFilename(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
}

/**
 * Upload een audio file naar Supabase Storage (private bucket)
 * en geef een signed URL terug (tijdelijk linkje).
 */
export async function uploadRecordingAndGetSignedUrl(
  file: Blob,
  name: string,
  opts?: { folder?: string; expiresInSeconds?: number }
): Promise<{ path: string; signedUrl: string }> {
  const folder = opts?.folder ?? "uploads";
  const expiresIn = opts?.expiresInSeconds ?? 60 * 60; // 1 uur

  const filename = `${Date.now()}-${safeFilename(name)}`;
  const path = `${folder}/${filename}`;

  // Upload
  const { error: uploadError } = await supabase.storage
    .from(RECORDINGS_BUCKET)
    .upload(path, file, {
      upsert: false,
      contentType: file.type || "application/octet-stream",
      cacheControl: "3600",
    });

  if (uploadError) {
    throw new Error(`Supabase upload failed: ${uploadError.message}`);
  }

  if (import.meta.env.DEV) console.log("SIGNED_URL_FOR_PATH:", path);

// Signed URL (voor private bucket)
  const { data, error: signedError } = await supabase.storage
  .from(RECORDINGS_BUCKET)
  .createSignedUrl(path, expiresIn);

  if (signedError || !data?.signedUrl) {
    throw new Error(
      `Create signed URL failed: ${signedError?.message ?? "unknown"}`
    );
  }

  return { path, signedUrl: data.signedUrl };
}
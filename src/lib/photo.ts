export interface PreparedFile {
  blob: Blob;
  mime: string;
  ext: string;
  originalFormat: string | null; // e.g. "HEIC" when the phone gave us a format we could not shrink
}

const isHeic = (f: File) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);

/**
 * Shrinks a camera photo to a JPEG of at most `maxEdge` pixels (about 300-600 KB) before upload,
 * so reports and the dashboard stay fast on mobile data. Non-images are returned unchanged.
 * If the browser cannot decode the picture (for example HEIC), the original file is kept.
 */
export async function prepareFile(file: File, maxEdge = 1600, quality = 0.8): Promise<PreparedFile> {
  const extOf = (n: string, fallback: string) => (/\.([a-z0-9]{2,5})$/i.exec(n)?.[1] ?? fallback).toLowerCase();

  if (!file.type.startsWith("image/") && !isHeic(file)) {
    return { blob: file, mime: file.type || "application/octet-stream", ext: extOf(file.name, "bin"), originalFormat: null };
  }

  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("no canvas");
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob) throw new Error("no blob");
    // Keep the original when it is already smaller (tiny screenshots and the like).
    if (file.type === "image/jpeg" && file.size < blob.size && scale === 1) {
      return { blob: file, mime: "image/jpeg", ext: "jpg", originalFormat: null };
    }
    return { blob, mime: "image/jpeg", ext: "jpg", originalFormat: isHeic(file) ? "HEIC" : null };
  } catch {
    const heic = isHeic(file);
    return {
      blob: file,
      mime: heic ? (file.type || "image/heic") : file.type || "image/jpeg",
      ext: extOf(file.name, heic ? "heic" : "jpg"),
      originalFormat: heic ? "HEIC" : null,
    };
  }
}

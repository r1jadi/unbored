/**
 * Getting a chosen photo under the avatar bucket's limits.
 *
 * The `avatars` bucket takes at most 2 MB of PNG, JPEG or WebP. A photo straight
 * off a phone camera is usually several times that, and refusing it would make
 * the most common upload fail. So the picture is scaled down in the browser —
 * nothing larger than `AVATAR_MAX_SIDE` on its longest side, which is still sharp
 * at the biggest size an avatar is drawn — and re-encoded as WebP (JPEG where the
 * browser cannot encode WebP). That also means any image the browser can decode
 * is accepted, not only the three types the bucket stores.
 */

import { ApiError } from "@/lib/api/client";

/** The bucket's own limits, repeated here so a bad file fails before it is sent. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** The longest side an uploaded avatar keeps. */
export const AVATAR_MAX_SIDE = 1024;
/** Encoder quality: visually clean, a few hundred KB at most. */
const QUALITY = 0.86;

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };

/** Decodes an image file, honouring its EXIF orientation. Null if it cannot be read. */
async function decode(file: File): Promise<Decoded | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Fall through to the <img> decoder, which some browsers handle better.
    }
  }
  if (typeof Image === "undefined" || typeof URL.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) return null;
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, type, QUALITY);
    } catch {
      resolve(null);
    }
  });
}

/** Draws `image` at `width × height` and encodes it, WebP first, else JPEG. */
async function render(image: Decoded, width: number, height: number): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingQuality = "high";
  context.drawImage(image.source, 0, 0, width, height);

  const webp = await encode(canvas, "image/webp");
  // A browser that cannot encode WebP quietly returns a PNG instead.
  if (webp && webp.type === "image/webp") return webp;

  // JPEG has no transparency: paint the transparent parts white, not black.
  context.globalCompositeOperation = "destination-over";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  const jpeg = await encode(canvas, "image/jpeg");
  return jpeg && jpeg.type === "image/jpeg" ? jpeg : null;
}

function unsupported(): ApiError {
  return new ApiError("Choose a PNG, JPEG or WebP image.", { code: "bad_request" });
}
function tooLarge(): ApiError {
  return new ApiError("That image is over 2 MB and couldn't be resized. Try a different photo.", {
    code: "bad_request",
  });
}

/**
 * The file to upload for `file`: scaled to fit `AVATAR_MAX_SIDE` and re-encoded,
 * or the file itself when it already fits and is a type the bucket stores.
 * Rejects with an `ApiError` for something that is not a readable image the
 * bucket could store, or an image that cannot be brought under the size limit.
 */
export async function prepareAvatar(file: File): Promise<File> {
  const storable = file.type in AVATAR_TYPES;
  const image = file.type.startsWith("image/") ? await decode(file) : null;

  if (!image) {
    // Undecodable here. A storable file that already fits is still worth
    // sending as it is: the bucket is the final judge of its contents.
    if (!storable) throw unsupported();
    if (file.size > MAX_AVATAR_BYTES) throw tooLarge();
    return file;
  }

  try {
    const longest = Math.max(image.width, image.height);
    if (storable && file.size <= MAX_AVATAR_BYTES && longest <= AVATAR_MAX_SIDE) return file;

    // Shrink until it fits. One pass is almost always enough; the loop only
    // matters for pathological images that compress badly.
    let side = Math.min(longest, AVATAR_MAX_SIDE);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const scale = side / longest;
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const blob = await render(image, width, height);
      if (!blob) break;
      if (blob.size <= MAX_AVATAR_BYTES) {
        const extension = AVATAR_TYPES[blob.type];
        const base = file.name.replace(/\.[^.]*$/, "") || "avatar";
        return new File([blob], `${base}.${extension}`, { type: blob.type });
      }
      side = Math.round(side * 0.7);
    }
  } finally {
    image.close();
  }

  // The browser could not re-encode it. Send the original only if the bucket
  // would take it anyway.
  if (storable && file.size <= MAX_AVATAR_BYTES) return file;
  throw tooLarge();
}

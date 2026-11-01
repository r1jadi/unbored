import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import { AVATAR_MAX_SIDE, MAX_AVATAR_BYTES, prepareAvatar } from "@/lib/users/avatar-image";

/**
 * Shrinking a chosen photo to fit the avatar bucket.
 *
 * jsdom has neither an image decoder nor a canvas encoder, so both are stubbed:
 * `createImageBitmap` reports the photo's dimensions, and `toBlob` returns a blob
 * of whatever type and size the test says the browser would produce. What is
 * asserted is the decision — when a file is sent as it is, what size it is drawn
 * at, which format it is re-encoded to — not the pixels.
 */

function photo(bytes: number, type = "image/jpeg", name = "IMG_0001.jpg") {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** Stubs the decoder (`width × height`) and the encoder (`encoded(type, w, h)`). */
function stubBrowser(
  width: number,
  height: number,
  encoded: (type: string, w: number, h: number) => { type: string; bytes: number } | null,
) {
  const drawn: { width: number; height: number }[] = [];
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width, height, close })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const { width: w, height: h } = this;
    return {
      drawImage: () => drawn.push({ width: w, height: h }),
      fillRect: () => {},
    } as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
  ) {
    const out = encoded(type ?? "image/png", this.width, this.height);
    callback(out ? new Blob([new Uint8Array(out.bytes)], { type: out.type }) : null);
  });
  return { drawn, close };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("prepareAvatar", () => {
  it("shrinks a large phone photo to the maximum side and re-encodes it as WebP", async () => {
    const { drawn, close } = stubBrowser(4032, 3024, (type) => ({ type, bytes: 180_000 }));

    const out = await prepareAvatar(photo(6 * 1024 * 1024));

    expect(drawn).toEqual([{ width: AVATAR_MAX_SIDE, height: 768 }]);
    expect(out.type).toBe("image/webp");
    expect(out.name).toBe("IMG_0001.webp");
    expect(out.size).toBeLessThanOrEqual(MAX_AVATAR_BYTES);
    expect(close).toHaveBeenCalled();
  });

  it("keeps a portrait photo's proportions", async () => {
    const { drawn } = stubBrowser(3000, 4000, (type) => ({ type, bytes: 200_000 }));

    await prepareAvatar(photo(5 * 1024 * 1024));

    expect(drawn).toEqual([{ width: 768, height: AVATAR_MAX_SIDE }]);
  });

  it("falls back to JPEG where the browser cannot encode WebP", async () => {
    // Such a browser quietly hands back a PNG when asked for WebP.
    stubBrowser(4000, 4000, (type) =>
      type === "image/webp" ? { type: "image/png", bytes: 3_000_000 } : { type, bytes: 250_000 },
    );

    const out = await prepareAvatar(photo(4 * 1024 * 1024, "image/png", "scan.png"));

    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("scan.jpg");
  });

  it("sends a small picture that already fits exactly as it is", async () => {
    const { drawn } = stubBrowser(400, 400, (type) => ({ type, bytes: 10 }));
    const small = photo(90_000, "image/png", "me.png");

    expect(await prepareAvatar(small)).toBe(small);
    expect(drawn).toEqual([]);
  });

  it("accepts an image type the bucket does not store, by converting it", async () => {
    stubBrowser(800, 600, (type) => ({ type, bytes: 50_000 }));

    const out = await prepareAvatar(photo(300_000, "image/gif", "wave.gif"));

    expect(out.type).toBe("image/webp");
    expect(out.name).toBe("wave.webp");
  });

  it("shrinks further if the first pass is still over the limit", async () => {
    const { drawn } = stubBrowser(4000, 4000, (type, w) => ({
      type,
      bytes: w >= AVATAR_MAX_SIDE ? MAX_AVATAR_BYTES + 1 : 400_000,
    }));

    const out = await prepareAvatar(photo(8 * 1024 * 1024));

    expect(drawn.map((d) => d.width)).toEqual([AVATAR_MAX_SIDE, 717]);
    expect(out.size).toBeLessThanOrEqual(MAX_AVATAR_BYTES);
  });

  it("refuses something that is not an image", async () => {
    const failure = await prepareAvatar(
      new File(["%PDF"], "cv.pdf", { type: "application/pdf" }),
    ).catch((e) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.message).toMatch(/png, jpeg or webp/i);
  });

  it("refuses an oversized image the browser cannot decode", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("cannot decode");
      }),
    );

    const failure = await prepareAvatar(photo(3 * 1024 * 1024)).catch((e) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.message).toMatch(/over 2 MB/);
  });
});

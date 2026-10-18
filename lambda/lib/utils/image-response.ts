import {
  GenerateImageSchema,
  IMAGE_MEDIA_TYPES,
  ImageMediaType,
} from "../provider";

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export function normalizeImageContentType(
  contentType?: string,
): ImageMediaType | null {
  const normalized = contentType?.split(";", 1)[0].trim().toLowerCase();
  return IMAGE_MEDIA_TYPES.find((type) => type === normalized) ?? null;
}

export function hasValidImageSignature(
  bytes: Uint8Array,
  contentType: ImageMediaType,
): boolean {
  const signature =
    contentType === "image/jpeg" ? JPEG_SIGNATURE : PNG_SIGNATURE;
  return (
    bytes.byteLength >= signature.length &&
    signature.every((value, index) => bytes[index] === value)
  );
}

export function validateImageResponse(
  bytes: Uint8Array,
  contentType: string | undefined,
  accept: ImageMediaType,
  providerName: string,
): ReturnType<typeof GenerateImageSchema.output.parse> {
  if (!bytes || bytes.byteLength === 0) {
    throw new Error(`${providerName} returned an empty image response body.`);
  }

  const normalized = normalizeImageContentType(contentType);
  if (!normalized || normalized !== accept) {
    throw new Error(
      `${providerName} returned an invalid image content type: ${contentType ?? "missing"}.`,
    );
  }

  if (!hasValidImageSignature(bytes, normalized)) {
    throw new Error(
      `${providerName} returned a malformed ${normalized} response body.`,
    );
  }

  return GenerateImageSchema.output.parse({ bytes, contentType: normalized });
}

export interface OcrResult {
  text: string;
  /** 0-100, as reported by the engine. */
  confidence: number;
}

/** Reads the text of an image (photo, scan, or a rendered PDF page). */
export interface OcrEngine {
  recognize(image: Buffer): Promise<OcrResult>;
  /** Loads the engine ahead of time so the first scanned document doesn't wait for it. */
  warmUp(): Promise<void>;
  close(): Promise<void>;
}

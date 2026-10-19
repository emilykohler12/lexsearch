import { SourceConnectionError, SourceRateLimitedError, SourceUnavailableError } from './normative-source.js';

/** Who is asking: a public service deserves to know. */
const USER_AGENT = 'LexSearch/0.1 (+https://github.com/emilykohler12/lexsearch; uso personal)';

/** The sites' limits aren't published: when one answers «too many requests» without saying for how long, this is waited. */
const DEFAULT_RETRY_AFTER_MS = 10 * 60_000;

/** The biggest file read (a bulletin edition of a few hundred pages is a few MB). */
const MAX_BYTES = 40 * 1024 * 1024;

export interface PoliteClientOptions {
  baseUrl: string;
  /** How the site is named in the messages for the lawyer: «Boletín Oficial», «Boletín Oficial de Misiones». */
  siteName: string;
  fetchImpl?: typeof fetch | undefined;
  /** Pause between requests: these are public services, so they are read slowly. */
  delayMs?: number | undefined;
  timeoutMs?: number | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

/**
 * Reads public pages one at a time and with pauses, says who is asking, and leaves the site alone for as
 * long as it asked when it answers «too many requests».
 */
export class PoliteClient {
  private readonly baseUrl: string;
  private readonly siteName: string;
  private readonly fetchImpl: typeof fetch;
  private readonly delayMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastRequestAt = 0;
  /** After a «too many requests» the site is left alone until then. */
  private blockedUntil = 0;

  constructor(options: PoliteClientOptions) {
    this.baseUrl = options.baseUrl;
    this.siteName = options.siteName;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.delayMs = options.delayMs ?? 1_500;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** A page as text. `cookies` carries the session between the requests of one consultation. */
  async text(path: string, cookies: Map<string, string> = new Map()): Promise<string> {
    return (await this.request(path, 'text/html', cookies)).text();
  }

  /** A file (a PDF) as bytes. */
  async bytes(path: string): Promise<Uint8Array> {
    const response = await this.request(path, 'application/pdf,*/*', new Map());
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) throw new SourceUnavailableError(`El ${this.siteName} devolvió un archivo demasiado grande.`);
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > MAX_BYTES) throw new SourceUnavailableError(`El ${this.siteName} devolvió un archivo demasiado grande.`);
    return data;
  }

  private async request(path: string, accept: string, cookies: Map<string, string>): Promise<Response> {
    // The site asked to wait: no request goes out until it passes (pressing a button again changes nothing).
    if (Date.now() < this.blockedUntil) throw this.tooManyRequests(this.blockedUntil - Date.now());

    const wait = this.lastRequestAt + this.delayMs - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = Date.now();

    const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: accept };
    if (cookies.size > 0) headers.Cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');

    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl + path, { headers, redirect: 'follow', signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      throw new SourceConnectionError(`No se pudo conectar con el ${this.siteName}.`, { cause: error });
    }

    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0] ?? '';
      const separator = pair.indexOf('=');
      if (separator > 0) cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1));
    }

    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : DEFAULT_RETRY_AFTER_MS;
      this.blockedUntil = Date.now() + waitMs;
      throw this.tooManyRequests(waitMs);
    }
    if (!response.ok) throw new SourceUnavailableError(`El ${this.siteName} respondió con el error ${response.status}.`);
    return response;
  }

  private tooManyRequests(waitMs: number): SourceRateLimitedError {
    return new SourceRateLimitedError(`El ${this.siteName} pidió esperar unos minutos antes de seguir leyendo (recibió demasiados pedidos).`, waitMs);
  }
}

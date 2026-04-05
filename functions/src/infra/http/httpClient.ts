import { request, type Dispatcher } from "undici";
import pRetry, { AbortError } from "p-retry";

export type HttpRetryOptions = {
  retries?: number;
  minTimeoutMs?: number;
  maxTimeoutMs?: number;
};

export type RequestJsonParams = {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  bodyJson?: unknown;
  bodyText?: string;
  timeoutMs?: number;
  retry?: HttpRetryOptions | false;
  dispatcher?: Dispatcher;
};

export type RequestRawParams = {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
  retry?: HttpRetryOptions | false;
  dispatcher?: Dispatcher;
};

export class HttpError extends Error {
  public readonly statusCode: number | null;
  public readonly responseBody: string | null;

  constructor(message: string, statusCode: number | null, responseBody: string | null) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

function shouldRetryStatus(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 429 || (statusCode >= 500 && statusCode <= 599);
}

function shouldRetryError(err: any): boolean {
  const code = String(err?.code ?? "");
  const name = String(err?.name ?? "");
  if (name.includes("AbortError") || name.includes("TimeoutError")) return true;
  return ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"].includes(code);
}

async function doRequestRaw(params: RequestRawParams): Promise<{
  statusCode: number;
  headers: Record<string, string | string[]>;
  bodyText: string;
  bodyBuffer: Buffer;
}> {
  const controller = new AbortController();
  const timeoutMs = Number(params.timeoutMs ?? 10000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { statusCode, headers, body } = await request(params.url, {
      method: params.method,
      headers: params.headers,
      body: params.body,
      signal: controller.signal,
      dispatcher: params.dispatcher,
    });

    const arrayBuffer = await body.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const bodyText = buffer.toString("utf8");
    return { statusCode, headers: headers as any, bodyText, bodyBuffer: buffer };
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestRaw(params: RequestRawParams): Promise<{
  statusCode: number;
  headers: Record<string, string | string[]>;
  bodyText: string;
  bodyBuffer: Buffer;
}> {
  const retry = params.retry === false ? null : params.retry ?? {};
  const retries = retry ? retry.retries ?? 2 : 0;
  const minTimeoutMs = retry ? retry.minTimeoutMs ?? 200 : 0;
  const maxTimeoutMs = retry ? retry.maxTimeoutMs ?? 2000 : 0;

  const run = async () => {
    try {
      const result = await doRequestRaw(params);
      if (result.statusCode >= 400) {
        const err = new HttpError(
          `HTTP ${result.statusCode} for ${params.method} ${params.url}`,
          result.statusCode,
          result.bodyText,
        );
        if (!shouldRetryStatus(result.statusCode)) {
          throw new AbortError(err);
        }
        throw err;
      }
      return result;
    } catch (err: any) {
      if (err instanceof AbortError) throw err;
      if (err instanceof HttpError) throw err;
      if (!shouldRetryError(err)) {
        throw new AbortError(err);
      }
      throw err;
    }
  };

  if (!retry) return run();

  return pRetry(run, {
    retries,
    minTimeout: minTimeoutMs,
    maxTimeout: maxTimeoutMs,
    randomize: true,
  });
}

export async function requestJson<T>(params: RequestJsonParams): Promise<{
  statusCode: number;
  headers: Record<string, string | string[]>;
  data: T | null;
  bodyText: string;
}> {
  const headers = { ...(params.headers ?? {}) };
  let body: string | undefined;
  if (params.bodyJson !== undefined) {
    body = JSON.stringify(params.bodyJson);
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
  } else if (params.bodyText !== undefined) {
    body = params.bodyText;
  }

  const raw = await requestRaw({
    url: params.url,
    method: params.method,
    headers,
    body,
    timeoutMs: params.timeoutMs,
    retry: params.retry,
    dispatcher: params.dispatcher,
  });

  let data: T | null = null;
  if (raw.bodyText) {
    try {
      data = JSON.parse(raw.bodyText) as T;
    } catch {
      data = null;
    }
  }

  return {
    statusCode: raw.statusCode,
    headers: raw.headers,
    data,
    bodyText: raw.bodyText,
  };
}

export function isRetryableStatus(statusCode: number): boolean {
  return shouldRetryStatus(statusCode);
}

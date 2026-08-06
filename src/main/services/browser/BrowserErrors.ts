import type { BrowserError, BrowserErrorCode } from "../../../shared/contracts.ts";

export class BrowserKernelError extends Error {
  readonly code: BrowserErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, string | number | boolean | null>;

  constructor(
    code: BrowserErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      details?: Record<string, string | number | boolean | null>;
      cause?: unknown;
    } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "BrowserKernelError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function browserError(error: unknown): BrowserError {
  if (error instanceof BrowserKernelError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details ? { details: error.details } : {})
    };
  }

  if (isAbortError(error)) {
    return {
      code: "CANCELED",
      message: "Browser command was canceled.",
      retryable: true
    };
  }

  return {
    code: "BRIDGE_UNAVAILABLE",
    message: "Browser command failed inside the protected browser runtime.",
    retryable: true
  };
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new DOMException("Browser command was canceled.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && error.name === "AbortError";
}

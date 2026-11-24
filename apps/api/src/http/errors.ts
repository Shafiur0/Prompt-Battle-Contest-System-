import type { NextFunction, Request, Response } from 'express';
import { TxError } from '../db/pool';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

/** Stable domain errors from architecture s.5. */
export const errors = {
  unauthenticated: () => new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue'),
  forbidden: () => new ApiError(403, 'FORBIDDEN', 'You do not have access to this resource'),
  notFound: (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`),
  sealed: () => new ApiError(409, 'WORKSPACE_SEALED', 'This workspace is closed to new generation'),
  deadline: (what = 'deadline') => new ApiError(409, 'DEADLINE_PASSED', `The ${what} has passed`),
  idempotencyConflict: () =>
    new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was used with a different payload'),
  attemptNotReady: () => new ApiError(409, 'ATTEMPT_NOT_READY', 'This attempt has no selectable answer yet'),
  usagePending: () => new ApiError(409, 'USAGE_PENDING', 'Usage for this attempt is still settling'),
  providerUnavailable: () =>
    new ApiError(503, 'PROVIDER_UNAVAILABLE', 'The generation provider is not available')
};

export function errorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (error instanceof TxError) {
    res.status(error.status).json({ error: error.code, message: error.message, details: error.details });
    return;
  }
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.code, message: error.message, details: error.details });
    return;
  }
  const message = error instanceof Error ? error.message : 'Unexpected error';
  // Constraint names are useful to the operator and never contain participant content.
  const code = /IMMUTABLE_TABLE/.test(message)
    ? 'IMMUTABLE_VIOLATION'
    : /violates/.test(message)
      ? 'CONSTRAINT_VIOLATION'
      : 'INTERNAL_ERROR';
  if (code === 'INTERNAL_ERROR') console.error('[api] unhandled', error);
  res.status(code === 'INTERNAL_ERROR' ? 500 : 409).json({ error: code, message });
}

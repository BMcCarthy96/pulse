export const ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}

export class ApiError extends Error {
  code: ErrorCode;
  status: number;

  constructor(code: ErrorCode, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }

  static unauthorized(message = "Authentication required") {
    return new ApiError("UNAUTHORIZED", message, 401);
  }
  static forbidden(message = "Insufficient role") {
    return new ApiError("FORBIDDEN", message, 403);
  }
  static notFound(message = "Not found") {
    return new ApiError("NOT_FOUND", message, 404);
  }
  static validation(message = "Validation failed") {
    return new ApiError("VALIDATION", message, 400);
  }
  static conflict(message = "Conflict") {
    return new ApiError("CONFLICT", message, 409);
  }
  static internal(message = "Internal error") {
    return new ApiError("INTERNAL", message, 500);
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

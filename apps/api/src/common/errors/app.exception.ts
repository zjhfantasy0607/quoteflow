import { HttpException } from '@nestjs/common';
import { ApiErrorBody, ERROR_HTTP_STATUS, ErrorCode } from '@quoteflow/shared';

/**
 * 业务异常。HTTP 状态码由错误码决定（shared/errors.ts），前端按 code 翻译。
 * message 只给开发者看，默认用 code 本身。
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    public readonly params?: Record<string, unknown>,
    public readonly details?: unknown,
    message?: string,
  ) {
    const body: ApiErrorBody = { code, message: message ?? code };
    if (params) body.params = params;
    if (details !== undefined) body.details = details;
    super(body, ERROR_HTTP_STATUS[code]);
  }
}

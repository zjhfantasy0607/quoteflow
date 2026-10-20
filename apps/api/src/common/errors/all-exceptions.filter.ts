import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiErrorBody, ERROR_HTTP_STATUS, ErrorCode, ValidationIssue } from '@quoteflow/shared';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { AppException } from './app.exception';

/** 把所有异常转换成统一的错误响应体（docs/03 §3） */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (body.code === 'INTERNAL_ERROR') {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    res.status(ERROR_HTTP_STATUS[body.code]).json(body);
  }

  private toBody(exception: unknown): ApiErrorBody {
    if (exception instanceof AppException) {
      return exception.getResponse() as ApiErrorBody;
    }
    if (exception instanceof ZodError) {
      return error('VALIDATION_FAILED', 'Validation failed', undefined, zodIssues(exception));
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return error('CONFLICT', 'Unique constraint violation', { fields: exception.meta?.target });
      }
      if (exception.code === 'P2025') {
        return error('NOT_FOUND', 'Record not found');
      }
      return error('INTERNAL_ERROR', 'Internal server error');
    }
    if (exception instanceof HttpException) {
      return fromHttpException(exception);
    }
    return error('INTERNAL_ERROR', 'Internal server error');
  }
}

function error(code: ErrorCode, message: string, params?: Record<string, unknown>, details?: unknown): ApiErrorBody {
  const body: ApiErrorBody = { code, message };
  if (params) body.params = params;
  if (details !== undefined) body.details = details;
  return body;
}

export function zodIssues(err: ZodError): ValidationIssue[] {
  return err.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }));
}

function fromHttpException(exception: HttpException): ApiErrorBody {
  const status = exception.getStatus();
  switch (status) {
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return error('VALIDATION_FAILED', exception.message);
    case HttpStatus.UNAUTHORIZED:
      return error('UNAUTHENTICATED', exception.message);
    case HttpStatus.FORBIDDEN:
      return error('FORBIDDEN', exception.message);
    case HttpStatus.NOT_FOUND:
      return error('NOT_FOUND', exception.message);
    case HttpStatus.CONFLICT:
      return error('CONFLICT', exception.message);
    case HttpStatus.TOO_MANY_REQUESTS:
      return error('RATE_LIMITED', exception.message);
    default:
      return error('INTERNAL_ERROR', 'Internal server error');
  }
}

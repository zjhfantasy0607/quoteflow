import { PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { zodIssues } from '../errors/all-exceptions.filter';
import { AppException } from '../errors/app.exception';

/** 用 shared 里的 zod schema 校验并转换 body / query */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException('VALIDATION_FAILED', undefined, zodIssues(result.error), 'Validation failed');
    }
    return result.data;
  }
}

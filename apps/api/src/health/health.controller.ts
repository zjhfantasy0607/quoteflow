import { Controller, Get, HttpStatus, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/auth/decorators';
import { ClockService } from '../common/clock/clock.service';
import { PrismaService } from '../prisma/prisma.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const time = this.clock.now().toISOString();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'ok', time };
    } catch {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'error', db: 'error', time };
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}

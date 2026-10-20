import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Env, validateEnv } from './env';

/** 类型化的配置读取 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }
}

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, envFilePath: ['.env'], validate: validateEnv })],
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}

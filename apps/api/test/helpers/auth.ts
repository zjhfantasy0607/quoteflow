import request from 'supertest';
import { LoginRateLimiter } from '../../src/common/auth/login-rate-limiter';
import { TEST_PASSWORD } from './fixtures';
import type { TestContext } from './test-app';

export type Agent = ReturnType<typeof request.agent>;

/** 未登录的 agent（带 CSRF 头） */
export function anonymous(ctx: TestContext): Agent {
  return request.agent(ctx.app.getHttpServer()).set('X-Requested-With', 'XMLHttpRequest');
}

/** 以某个用户登录，返回带会话 cookie 的 agent（会清空登录限流计数） */
export async function loginAs(
  ctx: TestContext,
  user: { username: string },
  password: string = TEST_PASSWORD,
): Promise<Agent> {
  ctx.app.get(LoginRateLimiter).reset();
  const agent = anonymous(ctx);
  await agent.post('/api/auth/login').send({ username: user.username, password }).expect(200);
  return agent;
}

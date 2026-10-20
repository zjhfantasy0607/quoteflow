import bcrypt from 'bcryptjs';

// 测试环境降低轮数以加快用例；生产与开发用 10
const ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 10;

/** 用于"用户不存在"时做一次等耗时的比较，避免通过响应时间探测账号 */
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', ROUNDS);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(password, hash);
}

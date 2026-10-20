import type { MessageSchema } from './zh-CN';

type DeepStringRecord<T> = { [K in keyof T]: T[K] extends string ? string : DeepStringRecord<T[K]> };

/** en-US 必须满足的结构：缺键会在类型检查时报错，多余键由单元测试发现 */
export type LocaleMessages = DeepStringRecord<MessageSchema>;

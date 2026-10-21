import { DB_ENUMS } from '@quoteflow/shared';
import { $Enums } from '../generated/prisma/client';

describe('shared 枚举与 Prisma 枚举一致', () => {
  for (const [name, values] of Object.entries(DB_ENUMS)) {
    it(name, () => {
      const prismaEnum = ($Enums as Record<string, Record<string, string>>)[name];
      expect(prismaEnum).toBeDefined();
      expect(Object.values(values).sort()).toEqual(Object.values(prismaEnum).sort());
    });
  }
});

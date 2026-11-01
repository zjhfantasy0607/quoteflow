import type { WorkbenchDto } from '@quoteflow/shared';
import { get } from './http';

/** 采购方工作台（M16）：一次返回当前用户能看到的全部卡片 */
export const workbenchApi = {
  overview: () => get<WorkbenchDto>('/workbench'),
};

import type { Directive } from 'vue';
import { useAuthStore } from '@/stores/auth';

function toggle(el: HTMLElement, perm: string | string[] | undefined): void {
  el.style.display = useAuthStore().hasPerm(perm) ? '' : 'none';
}

/**
 * 按钮级权限：v-perm="'inquiry:approve'" 或 v-perm="['a', 'b']"（全部满足才显示）。
 * 业务状态相关的按钮以后端返回的 allowedActions 为准，这里只管功能权限。
 */
export const vPerm: Directive<HTMLElement, string | string[] | undefined> = {
  mounted: (el, binding) => toggle(el, binding.value),
  updated: (el, binding) => toggle(el, binding.value),
};

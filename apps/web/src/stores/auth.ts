import type { Locale, MeDto } from '@quoteflow/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { authApi } from '@/api/auth';
import { applyLocale } from '@/i18n';

export const useAuthStore = defineStore('auth', () => {
  const me = ref<MeDto | null>(null);
  /** 是否已经向后端确认过登录状态 */
  const loaded = ref(false);

  const isLoggedIn = computed(() => me.value !== null);
  const userType = computed(() => me.value?.user.userType ?? null);
  const homePath = computed(() => (userType.value === 'SUPPLIER' ? '/portal' : '/workbench'));

  function setMe(value: MeDto | null): void {
    me.value = value;
    loaded.value = true;
    if (value) applyLocale(value.user.locale);
  }

  async function fetchMe(): Promise<void> {
    try {
      setMe(await authApi.me());
    } catch {
      setMe(null);
    }
  }

  async function login(username: string, password: string): Promise<void> {
    setMe(await authApi.login({ username, password }));
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout();
    } finally {
      me.value = null;
    }
  }

  /** 会话失效（401）时清空本地状态 */
  function reset(): void {
    me.value = null;
  }

  function hasPerm(perm?: string | string[]): boolean {
    if (!perm || (Array.isArray(perm) && perm.length === 0)) return true;
    const granted = me.value?.permissions ?? [];
    return (Array.isArray(perm) ? perm : [perm]).every((p) => granted.includes(p));
  }

  function hasField(code: string): boolean {
    return me.value?.fieldPermissions.includes(code) ?? false;
  }

  /** 切换语言：立即生效；已登录时同时保存到账号（R01-13） */
  async function setLocale(locale: Locale): Promise<void> {
    applyLocale(locale);
    if (me.value) me.value = await authApi.updateLocale(locale);
  }

  return { me, loaded, isLoggedIn, userType, homePath, fetchMe, login, logout, reset, hasPerm, hasField, setLocale };
});

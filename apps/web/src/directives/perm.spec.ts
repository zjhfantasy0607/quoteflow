import type { MeDto } from '@quoteflow/shared';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { vPerm } from './perm';

function me(permissions: string[]): MeDto {
  return {
    user: {
      id: 'u1',
      username: 'u1',
      name: 'U1',
      email: null,
      userType: 'INTERNAL',
      locale: 'zh-CN',
      departmentCode: null,
      supplier: null,
    },
    roles: [],
    permissions,
    fieldPermissions: [],
    dataScope: 'SELF',
  };
}

const Probe = defineComponent({
  directives: { perm: vPerm },
  template: `<div><button id="a" v-perm="'inquiry:approve'">A</button><button id="b" v-perm="['inquiry:view', 'inquiry:open']">B</button></div>`,
});

describe('v-perm（M01 web 测试）', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('没有权限时隐藏，权限变化后重新判断', async () => {
    const auth = useAuthStore();
    auth.me = me(['inquiry:view']);
    const wrapper = mount(Probe);
    expect((wrapper.find('#a').element as HTMLElement).style.display).toBe('none');
    expect((wrapper.find('#b').element as HTMLElement).style.display).toBe('none');

    auth.me = me(['inquiry:view', 'inquiry:open', 'inquiry:approve']);
    await wrapper.vm.$forceUpdate();
    await nextTick();
    expect((wrapper.find('#a').element as HTMLElement).style.display).toBe('');
    expect((wrapper.find('#b').element as HTMLElement).style.display).toBe('');
  });
});

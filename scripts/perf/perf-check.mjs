#!/usr/bin/env node
// M17 §2.1 性能抽查：列表接口 < 1 秒，统计接口 < 3 秒（每个接口先热身 1 次，再测 5 次取中位数与最大值）。
//
// 只对测试库做（不要往开发库里灌数据）：
//   1. 测试库清空后 prisma db seed + seed-demo（与浏览器验收同样的数据），再灌 1000 张询价单、5000 张报价单：
//      docker exec -i quoteflow-dev-postgres-1 psql -U quoteflow -d quoteflow_test -v ON_ERROR_STOP=1 < scripts/perf/perf-data.sql
//   2. 让 API 连测试库启动（apps/api：nest build 后 DATABASE_URL=<测试库> JOBS_ENABLED=false node dist/main.js）
//   3. node scripts/perf/perf-check.mjs [API 地址，默认 http://127.0.0.1:3000/api]
// 2026-11-01 结果：列表接口最慢 78 ms（物流报价明细），统计与导出最慢 578 ms（统计导出）
const API = process.argv[2] ?? 'http://127.0.0.1:3000/api';

async function login(username) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ username, password: 'Passw0rd!' }),
  });
  if (res.status !== 200) throw new Error(`login ${username}: ${res.status}`);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

async function time(cookie, url) {
  const t0 = performance.now();
  const res = await fetch(`${API}${url}`, { headers: { Cookie: cookie } });
  const buf = await res.arrayBuffer();
  const ms = performance.now() - t0;
  if (res.status !== 200)
    throw new Error(`${url} → ${res.status} ${Buffer.from(buf).toString().slice(0, 200)}`);
  return { ms, bytes: buf.byteLength };
}

const year = new Date().getFullYear();
const range = `from=${year - 1}-11-01&to=${year}-12-31`;
const cases = [
  // [用户, 地址, 上限 ms]
  ['manager.zhang', '/inquiries?page=1&pageSize=20', 1000],
  ['manager.zhang', '/inquiries?page=1&pageSize=100&tab=completed', 1000],
  ['manager.zhang', '/inquiries?page=26&pageSize=20&keyword=%E6%80%A7%E8%83%BD', 1000],
  ['buyer.zhang', '/inquiries?page=1&pageSize=20', 1000],
  ['manager.zhang', '/inquiries/approvals/pending', 1000],
  ['manager.zhang', '/contracts?page=1&pageSize=20', 1000],
  ['manager.zhang', '/contracts?page=1&pageSize=100&status=APPROVED', 1000],
  ['manager.zhang', '/suppliers?page=1&pageSize=20', 1000],
  ['manager.zhang', '/materials?page=1&pageSize=20', 1000],
  ['manager.zhang', '/workbench', 1000],
  ['buyer.zhang', '/workbench', 1000],
  ['manager.zhang', '/reports/inquiries?page=1&pageSize=20', 1000],
  ['manager.zhang', `/reports/inquiries?page=1&pageSize=100&${range}`, 1000],
  ['manager.zhang', '/reports/logistics?page=1&pageSize=50', 1000],
  ['manager.zhang', '/reports/points-summary?page=1&pageSize=20', 1000],
  ['manager.zhang', '/reports/points-ledger?page=1&pageSize=20', 1000],
  ['manager.zhang', '/suppliers/SUPID/quotes?page=1&pageSize=20', 1000],
  ['admin', '/system/audit-logs?page=1&pageSize=20', 1000],
  ['admin', '/system/emails?page=1&pageSize=20', 1000],
  ['sales@huaxin.example.com', '/portal/quotes?page=1&pageSize=20', 1000],
  ['sales@huaxin.example.com', '/portal/quotes?page=1&pageSize=20&tab=closed', 1000],
  ['sales@huaxin.example.com', '/portal/workbench', 1000],
  ['manager.zhang', '/stats/projects', 3000],
  ['manager.zhang', `/stats/projects?year=${year}`, 3000],
  ['manager.zhang', `/stats/response-speed?${range}`, 3000],
  ['manager.zhang', `/stats/win-rate?${range}`, 3000],
  ['manager.zhang', `/stats/cycle-time?${range}`, 3000],
  ['buyer.zhang', `/stats/win-rate?${range}`, 3000],
  ['manager.zhang', `/stats/export?${range}`, 3000],
  ['manager.zhang', `/reports/inquiries/export?${range}`, 3000],
];

const cookies = {};
let failed = 0;
cookies['manager.zhang'] = await login('manager.zhang');
const suppliers = await (
  await fetch(`${API}/suppliers?keyword=SUP10001`, { headers: { Cookie: cookies['manager.zhang'] } })
).json();
const supplierId = suppliers.items[0].id;
for (const [user, url0, limit] of cases) {
  const url = url0.replace('SUPID', supplierId);
  cookies[user] ??= await login(user);
  await time(cookies[user], url);
  const runs = [];
  let bytes = 0;
  for (let i = 0; i < 5; i++) {
    const r = await time(cookies[user], url);
    runs.push(r.ms);
    bytes = r.bytes;
  }
  runs.sort((a, b) => a - b);
  const ok = runs[4] < limit;
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} median ${runs[2].toFixed(0).padStart(5)} ms  max ${runs[4].toFixed(0).padStart(5)} ms  (< ${limit})  ${(bytes / 1024).toFixed(0).padStart(5)} KB  ${user.padEnd(24)} ${url}`,
  );
}
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exitCode = failed ? 1 : 0;

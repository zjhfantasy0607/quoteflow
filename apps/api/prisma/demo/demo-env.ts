// 必须在 AppModule 之前导入：AppModule 加载时按 JOBS_ENABLED 决定是否注册定时任务。
// 造数据时不跑定时任务，邮件留在发件箱里，之后 npm run dev 时由发件任务发到 Mailpit。
process.env.JOBS_ENABLED = 'false';

export {};

-- M17 性能抽查数据（只能用于测试库 quoteflow_test，见 scripts/perf/perf-check.mjs 的说明）：
--   docker exec -i quoteflow-dev-postgres-1 psql -U quoteflow -d quoteflow_test -v ON_ERROR_STOP=1 < scripts/perf/perf-data.sql
-- 需要先有基础数据（prisma db seed）与演示数据（seed-demo），在它们之上追加。
DO $$ BEGIN IF current_database() NOT LIKE '%\_test' THEN RAISE EXCEPTION 'perf-data.sql only runs on a *_test database'; END IF; END $$;
BEGIN;
CREATE TEMP TABLE pf_ctx AS
SELECT
  (SELECT id FROM "MaterialCategory" WHERE code = 'LED-2835') AS cat,
  (SELECT id FROM "User" WHERE username = 'buyer.zhang') AS buyer,
  (SELECT id FROM "User" WHERE username = 'buyer.li') AS buyer_li,
  (SELECT id FROM "User" WHERE username = 'manager.zhang') AS manager,
  (SELECT array_agg(id ORDER BY code) FROM "Supplier" WHERE status = 'ENABLED') AS sups;

CREATE TEMP TABLE pf_i AS
SELECT g,
  CASE WHEN g % 10 < 6 THEN 'EVALUATED' WHEN g % 10 < 8 THEN 'WAITING_QUOTES' WHEN g % 10 = 8 THEN 'OPENED' ELSE 'QUOTES_CLOSED' END AS st,
  CASE WHEN g % 10 < 6 OR g % 10 >= 8 THEN now() - (1000 - g) * interval '8 hours' - interval '5 days' ELSE now() - interval '1 day' END AS published
FROM generate_series(1, 1000) g;

INSERT INTO "Inquiry" (id, "draftNo", "formalNo", "projectNo", title, "materialCategoryId", currency, "docStatus",
  "currentRoundNo", "currentRoundStatus", "currentDeadline", "ownerId", "createdById", "departmentCode",
  "submittedAt", "approvedAt", "approvedById", "completedAt", "createdAt", "updatedAt")
SELECT 'pf-i-' || g, 'DR-PERF-' || lpad(g::text, 4, '0'), 'RFQ-PERF-' || lpad(g::text, 4, '0'), 'PJ-PERF-' || (g % 300),
  '性能测试询价 ' || g, c.cat, 'CNY', 'APPROVED', 1, st::"RoundStatus",
  CASE WHEN st = 'WAITING_QUOTES' THEN now() + (g % 7 + 1) * interval '1 day' ELSE published + interval '3 days' END,
  CASE WHEN g % 3 = 0 THEN c.buyer_li ELSE c.buyer END, CASE WHEN g % 3 = 0 THEN c.buyer_li ELSE c.buyer END, 'PURCHASE',
  published - interval '1 day', published - interval '12 hours', c.manager,
  CASE WHEN st = 'EVALUATED' THEN published + interval '4 days' END, published - interval '1 day', now()
FROM pf_i, pf_ctx c;

INSERT INTO "InquiryRound" (id, "inquiryId", "roundNo", status, deadline, "pplTemplateVersion", "pplVariantCode",
  "publishedAt", "publishedById", "quotesClosedAt", "openedAt", "openedById", "evaluatedAt", "awardedById",
  "createdById", "createdAt", "updatedAt")
SELECT 'pf-r-' || g, 'pf-i-' || g, 1, st::"RoundStatus",
  CASE WHEN st = 'WAITING_QUOTES' THEN now() + (g % 7 + 1) * interval '1 day' ELSE published + interval '3 days' END,
  1, 'PPL-LED', published, c.buyer,
  CASE WHEN st <> 'WAITING_QUOTES' THEN published + interval '3 days' END,
  CASE WHEN st IN ('OPENED', 'EVALUATED') THEN published + interval '3 days 2 hours' END,
  CASE WHEN st IN ('OPENED', 'EVALUATED') THEN c.manager END,
  CASE WHEN st = 'EVALUATED' THEN published + interval '4 days' END,
  CASE WHEN st = 'EVALUATED' THEN c.manager END,
  c.buyer, published - interval '1 day', now()
FROM pf_i, pf_ctx c;

INSERT INTO "InquiryLine" (id, "roundId", "lineNo", "categoryId", "nameZh", spec, "unitCode", quantity, "createdAt", "updatedAt")
SELECT 'pf-l-' || g || '-' || n, 'pf-r-' || g, n, c.cat, '性能测试灯珠 ' || n, '2835 / 0.5W', 'PCS', 1000 * n, now(), now()
FROM pf_i, pf_ctx c, generate_series(1, 2) n;

CREATE TEMP TABLE pf_q AS
SELECT g, k, st, published,
  CASE st
    WHEN 'WAITING_QUOTES' THEN (ARRAY['SUBMITTED', 'SUBMITTED', 'DECLINED', 'INVITED', 'INVITED'])[k + 1]
    WHEN 'QUOTES_CLOSED' THEN (ARRAY['SUBMITTED', 'SUBMITTED', 'SUBMITTED', 'DECLINED', 'INVITED'])[k + 1]
    WHEN 'OPENED' THEN (ARRAY['EVALUATING', 'EVALUATING', 'EVALUATING', 'DECLINED', 'INVITED'])[k + 1]
    ELSE (ARRAY['WON', 'LOST', 'LOST', 'DECLINED', 'INVITED'])[k + 1]
  END AS qs,
  1000 + (g * 37 + k * 101) % 5000 AS total
FROM pf_i, generate_series(0, 4) k;

INSERT INTO "Quote" (id, "roundId", "supplierId", status, "invitedAt", "firstViewedAt", "respondedAt", "lastSubmittedAt",
  "declinedAt", "declineReasonCode", "declineReason", "shortlisted", "createdAt", "updatedAt")
SELECT 'pf-q-' || g || '-' || k, 'pf-r-' || g, c.sups[(g + k) % array_length(c.sups, 1) + 1], qs::"QuoteStatus", published,
  CASE WHEN qs <> 'INVITED' THEN published + interval '1 hour' END,
  CASE WHEN qs <> 'INVITED' THEN published + (k + 1) * interval '5 hours' END,
  CASE WHEN qs NOT IN ('INVITED', 'DECLINED') THEN published + (k + 1) * interval '5 hours' END,
  CASE WHEN qs = 'DECLINED' THEN published + (k + 1) * interval '5 hours' END,
  CASE WHEN qs = 'DECLINED' THEN 'LEAD_TIME' END, CASE WHEN qs = 'DECLINED' THEN '交期无法满足' END,
  qs IN ('WON', 'LOST') AND k < 2, published, now()
FROM pf_q, pf_ctx c;

INSERT INTO "QuoteVersion" (id, "quoteId", "versionNo", source, values, "totalAmount", currency, "templateVersion",
  "variantCode", "submittedById", "submittedAt")
SELECT 'pf-v-' || g || '-' || k, 'pf-q-' || g || '-' || k, 1, 'ONLINE',
  jsonb_build_object('lines', jsonb_build_array(
    jsonb_build_object('lineId', 'pf-l-' || g || '-1', 'values', jsonb_build_object('unit_price_incl_tax', '0.' || (100 + k),
      'tax_rate', '13', 'lead_time_days', 30, 'moq', 1000, 'pcs_per_carton', 2000, 'carton_gw_kg', '9.5', 'trade_term', 'DAP')),
    jsonb_build_object('lineId', 'pf-l-' || g || '-2', 'values', jsonb_build_object('unit_price_incl_tax', '0.' || (200 + k),
      'tax_rate', '13', 'lead_time_days', 35, 'moq', 1000, 'pcs_per_carton', 1000, 'carton_gw_kg', '8.2', 'trade_term', 'DAP')))),
  total, 'CNY', 1, 'PPL-LED', c.buyer, published + (k + 1) * interval '5 hours'
FROM pf_q, pf_ctx c WHERE qs IN ('SUBMITTED', 'EVALUATING', 'WON', 'LOST');

UPDATE "Quote" q SET "currentVersionId" = 'pf-v-' || substring(q.id from 6)
WHERE q.id LIKE 'pf-q-%' AND q.status IN ('SUBMITTED', 'EVALUATING', 'WON', 'LOST');

INSERT INTO "Contract" (id, "contractNo", "inquiryId", "roundId", "quoteId", "quoteVersionId", "supplierId", status,
  amount, currency, "deliveryDate", "deliveryPlace", "paymentTerms", snapshot, "createdById", "createdAt", "updatedAt")
SELECT 'pf-c-' || g, 'CT-PERF-' || lpad(g::text, 4, '0'), 'pf-i-' || g, 'pf-r-' || g, 'pf-q-' || g || '-0', 'pf-v-' || g || '-0',
  c.sups[g % array_length(c.sups, 1) + 1], 'APPROVED', total, 'CNY', (published + interval '30 days')::date,
  '深圳宝安', '月结 30 天', '{}'::jsonb, c.buyer, published + interval '4 days', now()
FROM pf_q, pf_ctx c WHERE qs = 'WON';
COMMIT;

SELECT (SELECT count(*) FROM "Inquiry") AS inquiries, (SELECT count(*) FROM "Quote") AS quotes,
  (SELECT count(*) FROM "QuoteVersion") AS versions, (SELECT count(*) FROM "Contract") AS contracts;

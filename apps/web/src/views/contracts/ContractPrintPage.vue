<script setup lang="ts">
import { amountInChinese, PPL_TOTAL_KEY, type AppConfigDto, type ContractDetailDto } from '@quoteflow/shared';
import { ElMessage } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { contractsApi } from '@/api/contracts';
import { apiError, translateError } from '@/api/http';
import { paramsApi } from '@/api/system';
import MaskedValue from '@/components/MaskedValue.vue';
import { contractLines, UNIT_PRICE_KEY } from '@/utils/contracts';
import { formatMoney, pickName } from '@/utils/format';

/**
 * 合同打印版（M14 §5、R14-8）：A4 排版，明细、金额、乙方都取自定标快照，与当前主数据无关；
 * 交付与付款、其他约定取合同本身的条款，甲方取系统参数里的公司信息（快照里没有甲方）。
 * 人民币合同显示大写金额；没有 contract.amount 时金额显示 🔒。浏览器打印时隐藏工具栏
 */
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();

const id = computed(() => String(route.params.id));
const contract = ref<ContractDetailDto | null>(null);
const company = ref<AppConfigDto['company'] | null>(null);
const loading = ref(false);
const notFound = ref(false);

const snapshot = computed(() => contract.value?.snapshot ?? null);
const lines = computed(() => (snapshot.value ? contractLines(snapshot.value) : []));
const amountMasked = computed(() => contract.value?.maskedFields?.includes('amount') ?? false);
const total = computed(() => snapshot.value?.quoteVersion.totalAmount ?? null);
/** 金额大写只用于人民币 */
const totalUpper = computed(() =>
  total.value !== null && snapshot.value?.quoteVersion.currency === 'CNY'
    ? amountInChinese(total.value)
    : null,
);
const precisionOf = (key: string) => snapshot.value?.columns.find((c) => c.key === key)?.precision;
const money = (value: unknown, key: string) =>
  value === undefined || value === null || value === '' ? '' : formatMoney(String(value), precisionOf(key));

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [detail, config] = await Promise.all([
      contractsApi.get(id.value),
      paramsApi.appConfig().catch(() => null),
    ]);
    contract.value = detail;
    company.value = config?.company ?? null;
  } catch (err) {
    const body = apiError(err);
    notFound.value = body?.code === 'NOT_FOUND';
    if (!notFound.value) ElMessage.error(translateError(body));
  } finally {
    loading.value = false;
  }
}

function print(): void {
  window.print();
}

function back(): void {
  void router.push({ name: 'contract-detail', params: { id: id.value } });
}

onMounted(load);
</script>

<template>
  <div v-loading="loading" class="print-page">
    <div class="toolbar">
      <el-button icon="Back" @click="back">{{ t('contracts.print.back') }}</el-button>
      <el-button v-if="contract" type="primary" icon="Printer" @click="print">
        {{ t('contracts.print.print') }}
      </el-button>
    </div>

    <el-result v-if="notFound" icon="warning" :title="t('contracts.detail.notFound')" />

    <article v-if="contract && snapshot" class="sheet">
      <h1 class="title">{{ t('contracts.print.title') }}</h1>
      <div class="meta">
        <span>{{ t('contracts.print.contractNo', { no: contract.contractNo }) }}</span>
        <span>{{ t('contracts.print.inquiryNo', { no: snapshot.inquiry.formalNo }) }}</span>
      </div>
      <div v-if="contract.status !== 'APPROVED'" class="draft">{{ t('contracts.print.draft') }}</div>

      <table class="grid parties">
        <tbody>
          <tr>
            <th>{{ t('contracts.print.partyA') }}</th>
            <td>{{ company ? pickName(company, locale) : '' }}</td>
            <th>{{ t('contracts.print.partyB') }}</th>
            <td>{{ snapshot.supplier.code }} {{ pickName(snapshot.supplier, locale) }}</td>
          </tr>
          <tr>
            <th>{{ t('contracts.print.address') }}</th>
            <td>{{ company?.address ?? '' }}</td>
            <th>{{ t('contracts.print.contact') }}</th>
            <td>{{ snapshot.supplier.contactName }}</td>
          </tr>
          <tr>
            <th>{{ t('contracts.print.phone') }}</th>
            <td>{{ company?.phone ?? '' }}</td>
            <th>{{ t('contracts.print.phone') }} / {{ t('contracts.print.email') }}</th>
            <td>
              <MaskedValue :masked="contract.maskedFields?.includes('contactPhone') ?? false">
                <span>{{ snapshot.supplier.contactPhone ?? '' }}</span>
              </MaskedValue>
              <span class="sep">/</span>
              <MaskedValue :masked="contract.maskedFields?.includes('contactEmail') ?? false">
                <span>{{ snapshot.supplier.contactEmail }}</span>
              </MaskedValue>
            </td>
          </tr>
        </tbody>
      </table>

      <h2 class="section">{{ t('contracts.print.items') }}</h2>
      <table class="grid items">
        <thead>
          <tr>
            <th class="no">{{ t('contracts.detail.lineFields.lineNo') }}</th>
            <th>{{ t('contracts.detail.lineFields.item') }}</th>
            <th>{{ t('contracts.detail.lineFields.spec') }}</th>
            <th class="num">{{ t('contracts.detail.lineFields.quantity') }}</th>
            <th>{{ t('contracts.detail.lineFields.unit') }}</th>
            <th class="num">{{ t('contracts.print.unitPrice') }}</th>
            <th class="num">{{ t('contracts.print.totalPrice') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in lines" :key="line.lineId">
            <td class="no">{{ line.lineNo }}</td>
            <td>
              <div>{{ pickName(line, locale) }}</div>
              <div v-if="line.materialCode" class="code">{{ line.materialCode }}</div>
            </td>
            <td class="spec">{{ line.spec }}</td>
            <td class="num">{{ line.quantity }}</td>
            <td>{{ pickName(line.unit, locale) }}</td>
            <td class="num">
              <MaskedValue :masked="amountMasked">{{
                money(line.values[UNIT_PRICE_KEY], UNIT_PRICE_KEY)
              }}</MaskedValue>
            </td>
            <td class="num">
              <MaskedValue :masked="amountMasked">{{
                money(line.values[PPL_TOTAL_KEY], PPL_TOTAL_KEY)
              }}</MaskedValue>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th colspan="6" class="num">
              {{ t('contracts.print.total') }} ({{ snapshot.quoteVersion.currency }})
            </th>
            <td class="num strong">
              <MaskedValue :masked="amountMasked">{{ formatMoney(total, 2) }}</MaskedValue>
            </td>
          </tr>
          <tr v-if="totalUpper">
            <td colspan="7" class="upper">{{ t('contracts.print.totalUpper', { amount: totalUpper }) }}</td>
          </tr>
        </tfoot>
      </table>

      <h2 class="section">{{ t('contracts.print.terms') }}</h2>
      <table class="grid terms">
        <tbody>
          <tr>
            <th>{{ t('contracts.fields.deliveryDate') }}</th>
            <td>{{ contract.deliveryDate ?? '' }}</td>
          </tr>
          <tr>
            <th>{{ t('contracts.fields.deliveryPlace') }}</th>
            <td>{{ contract.deliveryPlace ?? '' }}</td>
          </tr>
          <tr>
            <th>{{ t('contracts.fields.paymentTerms') }}</th>
            <td>{{ contract.paymentTerms ?? '' }}</td>
          </tr>
        </tbody>
      </table>

      <h2 class="section">{{ t('contracts.print.other') }}</h2>
      <table class="grid terms">
        <tbody>
          <tr>
            <th>{{ t('contracts.fields.summary') }}</th>
            <td class="pre">{{ contract.summary ?? '' }}</td>
          </tr>
          <tr>
            <th>{{ t('contracts.fields.remark') }}</th>
            <td class="pre">{{ contract.remark ?? '' }}</td>
          </tr>
        </tbody>
      </table>

      <div class="signatures">
        <div class="party">
          <div class="party-title">{{ t('contracts.print.signA') }}</div>
          <div>{{ company ? pickName(company, locale) : '' }}</div>
          <div class="line">{{ t('contracts.print.representative') }}</div>
          <div class="line">{{ t('contracts.print.date') }}</div>
        </div>
        <div class="party">
          <div class="party-title">{{ t('contracts.print.signB') }}</div>
          <div>{{ pickName(snapshot.supplier, locale) }}</div>
          <div class="line">{{ t('contracts.print.representative') }}</div>
          <div class="line">{{ t('contracts.print.date') }}</div>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.print-page {
  min-height: 100vh;
  padding: 16px 0 32px;
  background: var(--el-fill-color-light);
}
.toolbar {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-bottom: 16px;
}
.sheet {
  box-sizing: border-box;
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  padding: 18mm 16mm;
  color: #000;
  font-size: 13px;
  line-height: 1.6;
  background: #fff;
  box-shadow: 0 2px 12px rgb(0 0 0 / 10%);
}
.title {
  margin: 0 0 12px;
  font-size: 24px;
  letter-spacing: 4px;
  text-align: center;
}
.meta {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
}
.draft {
  margin-bottom: 12px;
  padding: 6px 12px;
  border: 1px dashed #c00;
  color: #c00;
  text-align: center;
}
.section {
  margin: 20px 0 8px;
  font-size: 15px;
}
.grid {
  width: 100%;
  border-collapse: collapse;
}
.grid th,
.grid td {
  padding: 6px 8px;
  border: 1px solid #333;
  text-align: left;
  vertical-align: top;
}
.grid th {
  font-weight: 600;
  background: #f5f5f5;
}
.parties th,
.terms th {
  width: 22%;
  white-space: nowrap;
}
.parties th {
  width: 14%;
}
.items .no {
  width: 40px;
  text-align: center;
}
.items .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.items .spec,
.pre {
  white-space: pre-wrap;
}
.code {
  color: #666;
  font-size: 12px;
}
.strong {
  font-weight: 700;
}
.upper {
  font-weight: 600;
}
.sep {
  margin: 0 6px;
}
.signatures {
  display: flex;
  gap: 32px;
  margin-top: 40px;
  page-break-inside: avoid;
}
.party {
  flex: 1;
}
.party-title {
  margin-bottom: 8px;
  font-weight: 600;
}
.line {
  margin-top: 28px;
  padding-bottom: 4px;
  border-bottom: 1px solid #333;
}

@media print {
  @page {
    size: A4;
    margin: 12mm;
  }
  .print-page {
    min-height: 0;
    padding: 0;
    background: none;
  }
  .toolbar {
    display: none;
  }
  .sheet {
    width: auto;
    min-height: 0;
    margin: 0;
    padding: 0;
    box-shadow: none;
  }
  .grid th {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
</style>

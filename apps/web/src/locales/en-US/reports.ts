import type { LocaleMessages } from '../types';

// Reports and supplier points (M15)
const reports: LocaleMessages['reports'] = {
  title: 'Reports',
  subtitle:
    'RFQ statistics, logistics quotations, supplier points summary and points ledger; filter and export',
  tabs: {
    inquiries: 'RFQ Statistics',
    logistics: 'Logistics Quotations',
    pointsSummary: 'Supplier Points',
    pointsLedger: 'Points Ledger',
  },
  export: 'Export Excel',
  resultCount: '{total} results',
  sealed: 'Sealed until bid opening',
  filters: {
    inquiryNo: 'RFQ No.',
    status: 'All statuses',
    publishedFrom: 'Published from',
    publishedTo: 'To',
    supplier: 'All suppliers',
    owner: 'All owners',
    materialCategory: 'All material categories',
    keyword: 'Supplier code or name',
    supplierCategory: 'All supplier categories',
    periodFrom: 'From',
    periodTo: 'To',
    rule: 'All rules',
  },
  inquiries: {
    fields: {
      inquiryNo: 'RFQ No.',
      round: 'Round',
      title: 'Title',
      projectNo: 'Project No.',
      materialCategory: 'Material category',
      status: 'Status',
      invited: 'Invited',
      quoted: 'Valid quotes',
      minTotal: 'Lowest total (incl. tax)',
      maxTotal: 'Highest total (incl. tax)',
      avgTotal: 'Average total (incl. tax)',
      winner: 'Awarded supplier',
      owner: 'Owner',
      publishedAt: 'Published',
    },
    quotedHint: 'Suppliers that have submitted a quotation and have not declined',
  },
  logistics: {
    note: 'Opened rounds only: the current version of each valid quotation, one row per line item; the columns are the packing and logistics fields of the PPL template plus the production lead time.',
    fields: {
      inquiryNo: 'RFQ No.',
      round: 'Round',
      supplier: 'Supplier',
      version: 'Version',
      line: 'Line',
      item: 'Item',
    },
  },
  pointsSummary: {
    periodHint:
      '"Points in period" and the per-rule columns only count entries within the selected period; without a period they equal the total.',
    fields: {
      supplier: 'Supplier',
      category: 'Supplier category',
      status: 'Status',
      balance: 'Total points',
      period: 'Points in period',
      lastChangedAt: 'Last changed',
    },
  },
  pointsLedger: {
    fields: {
      time: 'Time',
      supplier: 'Supplier',
      rule: 'Rule',
      delta: 'Points',
      source: 'Source',
      inquiryNo: 'RFQ No.',
      round: 'Round',
      remark: 'Remark',
      operator: 'Operator',
    },
    system: 'System',
  },
  adjust: {
    button: 'Adjust points',
    title: 'Adjust Supplier Points',
    supplier: 'Supplier',
    supplierPlaceholder: 'Select a supplier',
    delta: 'Points',
    deltaHint: 'Positive to add, negative to deduct; not 0 (a whole number within ±1000)',
    remark: 'Remark',
    remarkPlaceholder: 'Reason for the adjustment (required)',
    done: 'Points adjusted',
  },
};

export default reports;

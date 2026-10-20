import type { LocaleMessages } from '../types';

const common: LocaleMessages['common'] = {
  appName: 'QuoteFlow Sourcing Platform',
  portalName: 'Supplier Portal',
  language: { label: 'Language', zhCN: '中文', enUS: 'English' },
  tz: 'Beijing Time',
  actions: {
    create: 'New',
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'OK',
    submit: 'Submit',
    delete: 'Delete',
    edit: 'Edit',
    view: 'View',
    search: 'Search',
    reset: 'Reset',
    back: 'Back',
    refresh: 'Refresh',
    close: 'Close',
    import: 'Import',
    export: 'Export',
    collapse: 'Collapse menu',
    expand: 'Expand menu',
  },
  confirmTitle: 'Please confirm',
  table: { empty: 'No data', total: '{total} records in total', actions: 'Actions' },
  masked: 'Restricted',
  saved: 'Saved',
  validation: {
    required: 'Required',
    selectOne: 'Select at least one',
    invalid: 'Invalid value',
    format: 'Invalid format',
    email: 'Invalid email address',
    tooSmall: 'Must be at least {min}',
    tooBig: 'Must be at most {max}',
  },
  page: {
    forbidden: {
      title: 'Access denied',
      desc: 'Your account does not have permission to view this page.',
      home: 'Back to home',
    },
    notFound: {
      title: 'Page not found',
      desc: 'The page you are looking for does not exist or has been removed.',
      home: 'Back to home',
    },
  },
};

export default common;

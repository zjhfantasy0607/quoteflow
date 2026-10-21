import type { LocaleMessages } from '../types';

const excel: LocaleMessages['excel'] = {
  import: {
    step1: 'Download the standard template and fill in the data (do not change the header row)',
    downloadTemplate: 'Download template',
    step2: 'Choose the completed file',
    drop: 'Drop the file here, or click to choose',
    fileTip: 'Only .xlsx, up to 5000 rows',
    start: 'Import',
    chooseFile: 'Please choose a file first',
    success: 'Import finished: {created} created, {updated} updated',
    headerTitle: 'The header row does not match the template. Nothing was imported.',
    missing: 'Missing columns',
    extra: 'Unexpected columns',
    orderMismatch: 'The columns are not in the template order',
    expected: 'Template header order',
    rowsTitle: '{total} data errors found. Nothing was imported. Please fix them and upload again.',
    rowsTruncated: 'Only the first {shown} are listed below',
    columns: { row: 'Row', column: 'Column', message: 'Problem' },
  },
  rowErrors: {
    required: 'Required',
    too_long: 'At most {max} characters',
    invalid_email: 'Invalid email address',
    invalid_integer: 'Must be a whole number',
    invalid_number: 'Must be a number',
    too_many_decimals: 'At most {max} decimal places',
    too_small: 'Must be at least {min}',
    invalid_code: 'Codes may only contain letters, digits and . _ / -',
    duplicate_code: 'Same code as row {row}',
    unit_not_found: 'Unknown unit. Use the unit code or its Chinese / English name',
    unit_disabled: 'This unit is disabled',
    category_not_found: 'Unknown category code',
    category_disabled: 'This category is disabled',
    invalid_status: 'Must be Enabled or Disabled',
  },
};

export default excel;

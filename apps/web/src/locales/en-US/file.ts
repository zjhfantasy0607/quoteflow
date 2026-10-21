import type { LocaleMessages } from '../types';

const file: LocaleMessages['file'] = {
  upload: {
    button: 'Upload',
    tip: 'Supports {exts}, up to {maxMB} MB each',
    tipLimit: ', at most {limit} files',
    typeNotAllowed: '"{name}" is not an allowed file type. Allowed: {exts}',
    tooLarge: '"{name}" is larger than {maxMB} MB',
    tooMany: 'You can upload at most {limit} files',
    failed: 'Failed to upload "{name}": {reason}',
    remove: 'Remove',
  },
  preview: {
    title: 'File preview',
    download: 'Download',
    notSupported: 'This format cannot be previewed online. Please download it.',
    truncated: 'Only the first 200 rows and 50 columns of each sheet are shown',
    emptySheet: 'The sheet is empty',
    loadFailed: 'Failed to load the preview',
  },
};

export default file;

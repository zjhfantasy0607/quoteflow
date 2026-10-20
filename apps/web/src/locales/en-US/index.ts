import type { LocaleMessages } from '../types';
import auth from './auth';
import common from './common';
import enums from './enums';
import errors from './errors';
import nav from './nav';
import system from './system';
import workbench from './workbench';

const enUS: LocaleMessages = { common, nav, auth, workbench, system, enums, errors };

export default enUS;

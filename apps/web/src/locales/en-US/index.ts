import type { LocaleMessages } from '../types';
import auth from './auth';
import common from './common';
import contracts from './contracts';
import enums from './enums';
import errors from './errors';
import excel from './excel';
import file from './file';
import inquiries from './inquiries';
import materials from './materials';
import nav from './nav';
import negotiation from './negotiation';
import portal from './portal';
import reports from './reports';
import roundDiff from './roundDiff';
import ppl from './ppl';
import suppliers from './suppliers';
import stats from './stats';
import system from './system';
import workbench from './workbench';

const enUS: LocaleMessages = {
  common,
  nav,
  auth,
  workbench,
  system,
  materials,
  suppliers,
  inquiries,
  contracts,
  stats,
  reports,
  portal,
  ppl,
  negotiation,
  roundDiff,
  file,
  excel,
  enums,
  errors,
};

export default enUS;

import auth from './auth';
import common from './common';
import enums from './enums';
import errors from './errors';
import excel from './excel';
import file from './file';
import inquiries from './inquiries';
import materials from './materials';
import nav from './nav';
import negotiation from './negotiation';
import portal from './portal';
import roundDiff from './roundDiff';
import ppl from './ppl';
import suppliers from './suppliers';
import system from './system';
import workbench from './workbench';

const zhCN = {
  common,
  nav,
  auth,
  workbench,
  system,
  materials,
  suppliers,
  inquiries,
  portal,
  ppl,
  negotiation,
  roundDiff,
  file,
  excel,
  enums,
  errors,
};

export default zhCN;

/** 全部文案的结构，en-US 必须与之一致 */
export type MessageSchema = typeof zhCN;

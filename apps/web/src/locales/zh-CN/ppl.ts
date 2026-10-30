/** PPL 报价表格与字段表单（M09 PplLineTable / PplForm / PplValueInput / PplValueDisplay）、报价历史版本（QuoteVersionHistory） */
export default {
  bool: { yes: '是', no: '否' },
  selectPlaceholder: '请选择',
  datePlaceholder: '选择日期',
  table: {
    progress: '必填 {filled}/{total}',
    editAll: '编辑全部字段',
    viewAll: '查看全部字段',
  },
  form: {
    title: '第 {no} 行 · {name}',
    prefill: '询价带出',
    formula: '自动计算',
    errors: '这一行有 {count} 处需要修改',
    done: '完成',
  },
  versions: {
    version: '第 {no} 版',
    current: '当前版本',
    submittedBy: '{name} 提交',
    total: '含税合计 {amount}',
    totalLabel: '含税合计',
    view: '查看明细',
    detailTitle: '第 {no} 版报价（{time}）',
    remarkValue: '备注：{text}',
    changeNoteValue: '变更说明：{text}',
    remark: '报价备注',
    changeNote: '变更说明',
    attachments: '报价附件',
    source: '来源',
  },
};

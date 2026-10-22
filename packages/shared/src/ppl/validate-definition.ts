import {
  PPL_CORE_KEYS,
  PPL_DECIMAL_TYPES,
  PPL_ENUM_TYPES,
  PPL_MASTER_CODE,
  pplDefinitionSchema,
  type PplColumn,
  type PplDefinition,
} from './definition';
import { PPL_FORMULAS, isPplFormulaName } from './formulas';
import { normalizePplValue } from './values';

export interface PplDefinitionIssue {
  path: string;
  message: string;
}

export type PplDefinitionResult =
  { ok: true; definition: PplDefinition } | { ok: false; issues: PplDefinitionIssue[] };

function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>(
    (acc, part) =>
      typeof part === 'number' ? `${acc}[${part}]` : acc ? `${acc}.${String(part)}` : String(part),
    '',
  );
}

/** 04 §8.1 定义校验；失败时 issues 作为 PPL_DEFINITION_INVALID 的 details。 */
export function validateDefinition(input: unknown): PplDefinitionResult {
  const parsed = pplDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message })),
    };
  }
  const definition = parsed.data;
  const issues: PplDefinitionIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  const groupKeys = new Set<string>();
  definition.groups.forEach((group, i) => {
    if (groupKeys.has(group.key)) add(`groups[${i}].key`, `duplicate group key "${group.key}"`);
    groupKeys.add(group.key);
  });

  const columns = new Map<string, PplColumn>();
  definition.master.columns.forEach((column, i) => {
    const path = `master.columns[${i}]`;
    if (columns.has(column.key)) add(`${path}.key`, `duplicate column key "${column.key}"`);
    else columns.set(column.key, column);
    if (!groupKeys.has(column.group)) add(`${path}.group`, `unknown group "${column.group}"`);

    if (column.source === 'prefill' && !column.prefillFrom)
      add(`${path}.prefillFrom`, 'prefill column requires prefillFrom');
    if (column.source !== 'prefill' && column.prefillFrom) {
      add(`${path}.prefillFrom`, 'prefillFrom is only allowed on prefill columns');
    }
    if (column.source === 'formula') {
      if (!column.formula) add(`${path}.formula`, 'formula column requires formula');
      else if (!isPplFormulaName(column.formula))
        add(`${path}.formula`, `unknown formula "${column.formula}"`);
    } else if (column.formula) {
      add(`${path}.formula`, 'formula is only allowed on formula columns');
    }
    if (column.required && column.source !== 'supplier') {
      add(`${path}.required`, 'required is only allowed on supplier columns');
    }
    if (PPL_DECIMAL_TYPES.includes(column.type) && column.precision === undefined) {
      add(`${path}.precision`, `${column.type} column requires precision`);
    }
    if (PPL_ENUM_TYPES.includes(column.type) && !column.dictType) {
      add(`${path}.dictType`, `${column.type} column requires dictType`);
    }
    if (column.min !== undefined && column.max !== undefined && column.min > column.max) {
      add(`${path}.max`, 'max must not be less than min');
    }
    if (column.default !== undefined) {
      if (column.source !== 'supplier') add(`${path}.default`, 'default is only allowed on supplier columns');
      else if (!normalizePplValue(column, column.default, null).ok)
        add(`${path}.default`, 'invalid default value');
    }
  });

  const formulaInputs = new Set<string>();
  definition.master.columns.forEach((column, i) => {
    if (column.source !== 'formula' || !column.formula || !isPplFormulaName(column.formula)) return;
    for (const key of PPL_FORMULAS[column.formula].inputs) {
      formulaInputs.add(key);
      if (!columns.has(key))
        add(`master.columns[${i}].formula`, `formula "${column.formula}" requires column "${key}"`);
    }
  });

  for (const key of PPL_CORE_KEYS) {
    const column = columns.get(key);
    if (!column) add('master.columns', `missing column "${key}"`);
    else if (column.source !== 'supplier' || !column.required) {
      add('master.columns', `column "${key}" must be a required supplier column`);
    }
  }

  const variantCodes = new Set<string>([PPL_MASTER_CODE]);
  definition.variants.forEach((variant, i) => {
    const path = `variants[${i}]`;
    if (variantCodes.has(variant.code)) add(`${path}.code`, `duplicate variant code "${variant.code}"`);
    variantCodes.add(variant.code);

    const excluded = new Set(variant.exclude);
    variant.exclude.forEach((key, j) => {
      const column = columns.get(key);
      const at = `${path}.exclude[${j}]`;
      if (!column) add(at, `unknown column "${key}"`);
      else if (column.source !== 'supplier') add(at, `cannot exclude ${column.source} column "${key}"`);
      else if (formulaInputs.has(key)) add(at, `cannot exclude formula input "${key}"`);
      else if (column.required) add(at, `cannot exclude required column "${key}"`);
    });
    variant.required.forEach((key, j) => {
      const column = columns.get(key);
      const at = `${path}.required[${j}]`;
      if (!column || excluded.has(key)) add(at, `column "${key}" is not in this variant`);
      else if (column.source !== 'supplier')
        add(at, `only supplier columns can be required, "${key}" is ${column.source}`);
    });
  });

  return issues.length ? { ok: false, issues } : { ok: true, definition };
}

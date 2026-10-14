import { strFromU8, unzipSync } from 'fflate';
import { RETIREMENT_ASSETS, retirementPlanErrors, type RetirementImportResult, type RetirementPlan } from '@floaters/types';
import { createExampleRetirementPlan } from './retirement';

export const MAX_RETIREMENT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 24 * 1024 * 1024;

export function importRetirementJson(text: string): RetirementImportResult {
  if (new TextEncoder().encode(text).length > 100 * 1024) throw new Error('Plan file is too large.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  const errors = retirementPlanErrors(value);
  if (errors.length) throw new Error(errors.slice(0, 4).join(' '));
  return { plan: value as RetirementPlan, warnings: [] };
}

function xml(bytes: Uint8Array | undefined): Document {
  if (!bytes) throw new Error('The workbook is missing a required sheet.');
  const document = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('The workbook contains invalid XML.');
  return document;
}

/** Read known inputs and cached values only. Workbook formula text is never run. */
export function importRetirementWorkbook(buffer: ArrayBuffer, currentYear = new Date().getFullYear()): RetirementImportResult {
  const bytes = new Uint8Array(buffer);
  if (bytes.length > MAX_RETIREMENT_FILE_BYTES) throw new Error('Workbook must be smaller than 5 MB.');
  let expanded = 0;
  const extract = (names: Set<string>) => {
    const entries = unzipSync(bytes, { filter: entry => {
      if (!names.has(entry.name)) return false;
      expanded += entry.originalSize;
      if (entry.originalSize > MAX_ENTRY_BYTES || expanded > MAX_EXPANDED_BYTES) throw new Error('Workbook expands beyond the import limit.');
      return true;
    } });
    for (const entry of Object.values(entries)) if (entry.length > MAX_ENTRY_BYTES) throw new Error('Workbook sheet is too large.');
    return entries;
  };
  let metadata: Record<string, Uint8Array>;
  try { metadata = extract(new Set(['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml'])); }
  catch { throw new Error('This workbook cannot be opened, or exceeds the import limit.'); }
  const workbook = xml(metadata['xl/workbook.xml']);
  const relationships = xml(metadata['xl/_rels/workbook.xml.rels']);
  const paths = new Map<string, string>();
  for (const relation of Array.from(relationships.getElementsByTagName('Relationship'))) {
    if (relation.getAttribute('TargetMode') === 'External') continue;
    const target = relation.getAttribute('Target') || '';
    const path = target.startsWith('/xl/') ? target.slice(1) : `xl/${target}`;
    if (/^xl\/worksheets\/[^/]+\.xml$/.test(path)) paths.set(relation.getAttribute('Id') || '', path);
  }
  const sheets = new Map<string, string>();
  for (const sheet of Array.from(workbook.getElementsByTagName('sheet'))) {
    const path = paths.get(sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet.getAttribute('r:id') || '');
    if (path) sheets.set(sheet.getAttribute('name') || '', path);
  }
  const required = ['Input Tap', 'Assumptions', 'One Off ContributionsWithdrawal'];
  const selected = required.map(name => {
    const path = sheets.get(name);
    if (!path) throw new Error('Use the Jimbo Retirement Planner 2.0 workbook with its original input sheets.');
    return path;
  });
  let entries: Record<string, Uint8Array>;
  try { entries = extract(new Set(selected)); }
  catch { throw new Error('Workbook sheets exceed the import limit.'); }
  const strings = metadata['xl/sharedStrings.xml'] ? Array.from(xml(metadata['xl/sharedStrings.xml']).getElementsByTagName('si')).map(si => si.textContent || '') : [];
  const readSheet = (path: string) => {
    const result = new Map<string, string>();
    for (const cell of Array.from(xml(entries[path]).getElementsByTagName('c'))) {
      const reference = cell.getAttribute('r') || '';
      const type = cell.getAttribute('t');
      const raw = type === 'inlineStr' ? cell.getElementsByTagName('is')[0]?.textContent : cell.getElementsByTagName('v')[0]?.textContent;
      if (raw == null || raw === '') continue;
      if (type === 'e') throw new Error(`Workbook cell ${reference} contains a spreadsheet error. Recalculate and save in Excel first.`);
      result.set(reference, type === 's' ? strings[Number(raw)] || '' : raw);
    }
    return result;
  };
  const input = readSheet(selected[0]);
  const assumptions = readSheet(selected[1]);
  const oneOffs = readSheet(selected[2]);
  const number = (sheet: Map<string, string>, address: string, optional = false) => {
    const raw = sheet.get(address);
    if (optional && (raw == null || raw.trim() === '')) return 0;
    const value = Number(raw);
    if (raw == null || raw.trim() === '' || !Number.isFinite(value)) throw new Error(`Workbook cell ${address} needs a number. Recalculate and save in Excel first.`);
    return value;
  };
  const startYear = number(assumptions, 'B9');
  const plan = createExampleRetirementPlan(startYear);
  plan.income = []; plan.spending = []; plan.oneOffs = [];
  plan.people[0].name = 'You'; plan.people[1].name = 'Partner';
  const warnings = [
    'Check ages and balances before saving. Imported amounts stay in the workbook’s baseline year; they are not automatically updated.',
    'Pension access ages and remaining tax-free allowances use editable defaults; check these against your own pensions.',
    'Property, mortgage balances and historical backtests are not imported. Mortgage spending is included when entered in the spending table.',
  ];
  if (startYear !== currentYear) warnings.unshift(`This workbook starts in ${startYear}. Update its baseline year, ages and balances together before treating it as a current plan.`);
  for (const personIndex of [0, 1] as const) {
    const person = plan.people[personIndex];
    const base = personIndex === 0 ? 12 : 35;
    person.age = number(input, personIndex === 0 ? 'B7' : 'B30');
    person.retirementAge = number(input, personIndex === 0 ? 'B8' : 'B31');
    for (const [index, key] of RETIREMENT_ASSETS.entries()) {
      const row = base + index;
      const asset = person.assets[key];
      asset.balance = number(input, `B${row}`, true);
      asset.annualContribution = number(input, `C${row}`, true);
      asset.contributionGrowth = number(input, `D${row}`, true);
      if (key === 'cash') {
        const rate = number(assumptions, 'C18');
        asset.returns = { cautious: rate, base: rate, optimistic: rate };
      } else {
        const risk = input.get(`E${row}`);
        const riskRow = [12, 13, 14, 15, 16].find(r => assumptions.get(`A${r}`) === risk);
        if (!riskRow) throw new Error(`Choose a recognised risk level in workbook cell E${row}.`);
        const adjustment = number(assumptions, `B${21 + index}`);
        const fee = number(assumptions, `B${27 + index}`);
        asset.returns = {
          base: number(input, `F${row}`),
          cautious: number(assumptions, `E${riskRow}`) * (1 + adjustment) - fee,
          optimistic: number(assumptions, `D${riskRow}`) * (1 + adjustment) - fee,
        };
      }
    }
    for (let row = personIndex === 0 ? 19 : 42; row <= (personIndex === 0 ? 24 : 47); row++) {
      const amount = number(input, `D${row}`, true);
      if (!amount) continue;
      plan.income.push({ id: `workbook-income-${row}`, label: input.get(`A${row}`) || 'Additional income', person: personIndex, startAge: number(input, `B${row}`), endAge: number(input, `C${row}`), annualAmount: amount, taxable: true });
    }
  }
  for (let row = 19; row <= 24; row++) {
    const amount = number(input, `L${row}`, true);
    if (!amount) continue;
    plan.spending.push({ id: `workbook-spending-${row}`, label: input.get(`I${row}`) || 'Household spending', startAge: number(input, `J${row}`), endAge: number(input, `K${row}`), annualAmount: amount });
  }
  for (const [reference, raw] of oneOffs) {
    const match = /^([A-Z]+)(12|13|14|15|32|33|34|35)$/.exec(reference);
    if (!match || match[1] === 'A' || match[1] === 'B') continue;
    const amount = Number(raw);
    if (!Number.isFinite(amount)) throw new Error(`One-off cell ${reference} needs a number.`);
    if (!amount) continue;
    const row = Number(match[2]);
    const person = row < 20 ? 0 : 1;
    plan.oneOffs.push({ id: `workbook-oneoff-${reference}`, label: oneOffs.get(`${match[1]}${person === 0 ? 16 : 36}`) || 'Workbook one-off', year: number(oneOffs, `${match[1]}1`), person, asset: RETIREMENT_ASSETS[row - (person === 0 ? 12 : 32)], amount });
  }
  const errors = retirementPlanErrors(plan);
  if (errors.length) throw new Error(errors.slice(0, 4).join(' '));
  return { plan, warnings };
}

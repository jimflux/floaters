import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createExampleRetirementPlan } from './retirement';
import { importRetirementJson, importRetirementWorkbook, MAX_RETIREMENT_FILE_BYTES } from './retirement-import';

function workbook(overrides: Record<string, string | number> = {}, sheetName = 'Input Tap') {
  const input: Record<string, string | number> = { B7: 40, B8: 60, B30: 38, B31: 60, A19: 'Later income', B19: 68, C19: 100, D19: 10000, I19: 'Living costs', J19: 60, K19: 100, L19: 20000, ...overrides };
  for (const base of [12, 35]) for (let i = 0; i < 4; i++) Object.assign(input, { [`B${base + i}`]: 1000, [`C${base + i}`]: 100, [`D${base + i}`]: 0.01, [`E${base + i}`]: 'Balanced', [`F${base + i}`]: 0.025 });
  const assumptions: Record<string, string | number> = { B9: 2024, A12: 'Balanced', C12: 0.03, D12: 0.05, E12: 0.01, C18: -0.01, B21: 0, B22: 0, B23: 0, B27: 0.005, B28: 0.005, B29: 0.005 };
  const sheet = (values: Record<string, string | number>) => `<worksheet><sheetData><row>${Object.entries(values).map(([r, v]) => typeof v === 'number' ? `<c r="${r}"><v>${v}</v></c>` : `<c r="${r}" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row></sheetData></worksheet>`;
  return zipSync({
    'xl/workbook.xml': strToU8(`<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" r:id="rId1"/><sheet name="Assumptions" r:id="rId2"/><sheet name="One Off ContributionsWithdrawal" r:id="rId3"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/input.xml"/><Relationship Id="rId2" Target="worksheets/assumptions.xml"/><Relationship Id="rId3" Target="worksheets/oneoff.xml"/></Relationships>'),
    'xl/worksheets/input.xml': strToU8(sheet(input)),
    'xl/worksheets/assumptions.xml': strToU8(sheet(assumptions)),
    'xl/worksheets/oneoff.xml': strToU8(sheet({ C1: 2028, C12: 1000, D1: 2030, D35: -500, D36: 'Partner cash withdrawal' })),
  }).buffer as ArrayBuffer;
}

describe('retirement workbook import', () => {
  it('maps people, assets, real returns, age ranges and dated one-offs', () => {
    const { plan, warnings } = importRetirementWorkbook(workbook(), 2026);
    expect(plan.startYear).toBe(2024);
    expect(plan.people[1].age).toBe(38);
    expect(plan.people[0].assets.pension.returns).toEqual({ base: 0.025, cautious: 0.005, optimistic: 0.045000000000000005 });
    expect(plan.people[1].assets.cash.returns).toEqual({ base: -0.01, cautious: -0.01, optimistic: -0.01 });
    expect(plan.income[0]).toMatchObject({ startAge: 68, endAge: 100, taxable: true, annualAmount: 10000 });
    expect(plan.spending[0].annualAmount).toBe(20000);
    expect(plan.oneOffs).toEqual(expect.arrayContaining([expect.objectContaining({ year: 2028, asset: 'pension', person: 0, amount: 1000 }), expect.objectContaining({ year: 2030, asset: 'cash', person: 1, amount: -500 })]));
    expect(warnings.join(' ')).toContain('starts in 2024');
    expect(warnings.join(' ')).toContain('Property');
  });
  it('requires original input sheets', () => expect(() => importRetirementWorkbook(workbook({}, 'Changed'))).toThrow('original input sheets'));
  it('rejects invalid ages rather than silently replacing them', () => expect(() => importRetirementWorkbook(workbook({ B7: -1 }))).toThrow());
  it('rejects missing ages for nonzero income', () => expect(() => importRetirementWorkbook(workbook({ B19: '' }))).toThrow('B19'));
  it('bounds the compressed input before opening it', () => expect(() => importRetirementWorkbook(new ArrayBuffer(MAX_RETIREMENT_FILE_BYTES + 1))).toThrow('5 MB'));
  it('bounds expanded XML entries before decompression', () => {
    const bomb = zipSync({ 'xl/workbook.xml': strToU8(' '.repeat(8 * 1024 * 1024 + 1)) }).buffer as ArrayBuffer;
    expect(() => importRetirementWorkbook(bomb)).toThrow('import limit');
  });
  it('rejects invalid archives', () => expect(() => importRetirementWorkbook(new ArrayBuffer(8))).toThrow());
});

describe('retirement JSON import', () => {
  it('roundtrips an exported plan', () => {
    const plan = createExampleRetirementPlan();
    expect(importRetirementJson(JSON.stringify(plan)).plan).toEqual(plan);
  });
  it('rejects invalid JSON, schemas and excessive files', () => {
    expect(() => importRetirementJson('{')).toThrow('valid JSON');
    expect(() => importRetirementJson('{}')).toThrow();
    expect(() => importRetirementJson(' '.repeat(100 * 1024 + 1))).toThrow('too large');
  });
});

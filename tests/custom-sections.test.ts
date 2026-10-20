import 'fake-indexeddb/auto';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {db, init, getSettings, addSection, renameSection, setSectionArchived, switchDomain, createRecord, searchRecords, createBackup, inspectBackup, restoreBackup, syncSections} from '../src/lib';
import {getDomains, normalizeDomain, sectionAssetFields, sectionScreens} from '../src/domains';

beforeEach(async () => {
  vi.restoreAllMocks();
  await db.delete(); await db.open();
  Object.defineProperty(globalThis, 'navigator', {value: {storage: {persist: async () => true}, onLine: false}, configurable: true});
  await init();
});

describe('owner-managed independent sections', () => {
  it('creates stable IDs and shares the same structure and terms across new sections', async () => {
    const first = await addSection('شبكات'); const second = await addSection('معدات');
    expect(first.id).not.toBe(second.id);
    expect(normalizeDomain(first.id)).toBe(first.id);
    expect(sectionScreens(first.id)).toEqual(sectionScreens(second.id));
    expect(sectionAssetFields(first.id)).toEqual(sectionAssetFields(second.id));
    expect(normalizeDomain('untrusted-section')).toBe('medical');
  });
  it('isolates identical asset codes and rejects cross-section references', async () => {
    const a = await addSection('قسم أ'); const b = await addSection('قسم ب');
    await switchDomain(a.id);
    const device = await createRecord('device', {name: 'جهاز أ', asset_code: 'SAME'});
    await switchDomain(b.id);
    await createRecord('device', {name: 'جهاز ب', asset_code: 'SAME'});
    expect(await searchRecords('جهاز أ')).toHaveLength(0);
    expect(await searchRecords('جهاز ب')).toHaveLength(1);
    await expect(createRecord('order', {device_id: device.id, description: 'cross'})).rejects.toThrow('المرجع');
  });
  it('renames without moving data, archives without deletion, and reactivates', async () => {
    const a = await addSection('قديم'); await switchDomain(a.id);
    const row = await createRecord('device', {name: 'محفوظ', asset_code: 'PRESERVE'});
    await renameSection(a.id, 'جديد');
    expect((await db.records.get(row.id))?.domain).toBe(a.id);
    await setSectionArchived(a.id, true);
    expect((await getSettings()).activeDomain).toBe('medical');
    expect(getDomains((await getSettings()).sectionDefinitions).some(d => d.id === a.id)).toBe(false);
    await expect(switchDomain(a.id)).rejects.toThrow('مؤرشف');
    expect(await db.records.get(row.id)).toBeTruthy();
    await setSectionArchived(a.id, false); await switchDomain(a.id);
    expect(await searchRecords('محفوظ')).toHaveLength(1);
  });
  it('enforces owner access and valid unique names', async () => {
    await expect(addSection('  ')).rejects.toThrow('اسم');
    await expect(addSection('a'.repeat(81))).rejects.toThrow('80');
    await addSection('شبكات'); await expect(addSection(' شبكات ')).rejects.toThrow('مستخدم');
    await expect(setSectionArchived('medical', true)).rejects.toThrow('الأساسي');
    await db.settings.update('settings', {role: 'admin'});
    await expect(addSection('ممنوع')).rejects.toThrow('للمالك');
  });
  it('preserves section definitions and records across encrypted restore', async () => {
    const a = await addSection('أرشيف'); await switchDomain(a.id);
    const row = await createRecord('device', {name: 'نسخة', asset_code: 'B-CUSTOM'});
    const blob = await createBackup('test-password');
    const backup = await inspectBackup(new File([blob], 'backup.engx'), 'test-password');
    await restoreBackup(backup.payload);
    const settings = await getSettings();
    expect(settings.sectionDefinitions?.some(d => d.id === a.id && d.label === 'أرشيف')).toBe(true);
    expect(settings.activeDomain).toBe(a.id);
    expect((await db.records.get(row.id))?.domain).toBe(a.id);
    expect(settings.sectionChanges?.length).toBeGreaterThan(0);
  });
  it('pushes queued definitions before reading remote config and clears only confirmed changes', async () => {
    const a = await addSection('متزامن');
    await db.settings.update('settings', {serverUrl: 'http://localhost:3001', cloudEnabled: true, token: 'test-token'});
    Object.defineProperty(globalThis, 'navigator', {value: {onLine: true}, configurable: true});
    const paths: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      paths.push(`${init?.method || 'GET'} ${new URL(url).pathname}`);
      return {ok: true, json: async () => init?.method === 'PUT' ? {section: a} : {sections: getDomains([a], true)}};
    }));
    try {await syncSections();} finally {vi.unstubAllGlobals();}
    expect(paths).toEqual([`PUT /api/sections/${a.id}`, 'GET /api/sections']);
    expect((await getSettings()).sectionChanges).toEqual([]);
  });
});

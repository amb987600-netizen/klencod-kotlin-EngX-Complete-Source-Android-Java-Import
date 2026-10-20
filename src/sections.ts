import {db, getSettings, logActivity, teamRequest} from './lib';
import {getDomains, isDomainId, normalizeDomain, type DomainId, type SectionDefinition} from './domains';

export type SectionChange = {key: string; section: SectionDefinition};
const labelKey = (label: string) => label.trim().normalize('NFKC').toLocaleLowerCase();
function checkedLabel(label: string): string {
  const result = String(label || '').trim();
  if (!result || result.length > 80) throw Error('اسم القسم مطلوب وبحد أقصى 80 حرفًا');
  return result;
}

async function changeSection(id: DomainId, patch: Partial<SectionDefinition>, create = false): Promise<SectionDefinition> {
  let result!: SectionDefinition;
  await db.transaction('rw', db.settings, async () => {
    const s = await getSettings();
    if (s.role !== 'owner') throw Error('إدارة الأقسام متاحة للمالك فقط');
    const all = getDomains(s.sectionDefinitions, true);
    const current = all.find(d => d.id === id);
    if (!create && !current) throw Error('القسم غير موجود');
    const label = checkedLabel(patch.label ?? current?.label ?? '');
    if (all.some(d => d.id !== id && labelKey(d.label) === labelKey(label))) throw Error('اسم القسم مستخدم بالفعل');
    result = {...(current || {id, labelEn: label, description: 'نفس الشاشات والمصطلحات المشتركة — بيانات مستقلة', archived: false}), ...patch, id, label};
    if (id === 'medical' && result.archived) throw Error('لا يمكن أرشفة القسم الأساسي');
    const definitions = [...(s.sectionDefinitions || []).filter(d => d.id !== id), result];
    const change = {key: crypto.randomUUID(), section: result};
    await db.settings.update('settings', {
      sectionDefinitions: definitions,
      sectionChanges: [...(s.sectionChanges || []), change],
      ...(result.archived && s.activeDomain === id ? {activeDomain: 'medical' as DomainId} : {}),
    });
  });
  await logActivity(create ? 'section_created' : 'section_updated', 'section', id, null, result);
  return result;
}
export function addSection(label: string): Promise<SectionDefinition> {
  return changeSection(`custom_${crypto.randomUUID().replace(/-/g, '')}`, {label}, true);
}
export async function renameSection(id: string, label: string): Promise<void> {
  if (!isDomainId(id)) throw Error('معرّف قسم غير صالح');
  await changeSection(id, {label, labelEn: label});
}
export async function setSectionArchived(id: string, archived: boolean): Promise<void> {
  if (!isDomainId(id)) throw Error('معرّف قسم غير صالح');
  await changeSection(id, {archived});
}

let syncPromise: Promise<void> | null = null;
export function syncSections(): Promise<void> {
  if (syncPromise) return syncPromise;
  syncPromise = performSync().finally(() => {syncPromise = null;});
  return syncPromise;
}
async function performSync(): Promise<void> {
  const s = await getSettings();
  if (!s.cloudEnabled || !s.token || !navigator.onLine) return;
  for (const change of s.sectionChanges || []) {
    const fresh = await getSettings();
    if (fresh.workspace.id !== s.workspace.id || fresh.user.id !== s.user.id || fresh.token !== s.token) throw Error('تغير الحساب أثناء مزامنة الأقسام؛ أعد المحاولة');
    if (fresh.role !== 'owner') throw Error('توجد تعديلات أقسام غير متزامنة تحتاج حساب المالك');
    await teamRequest(`/api/sections/${encodeURIComponent(change.section.id)}`, 'PUT', {workspace_id: s.workspace.id, ...change.section});
    await db.transaction('rw', db.settings, async () => {
      const current = await getSettings();
      if (current.workspace.id !== s.workspace.id || current.user.id !== s.user.id) return;
      await db.settings.update('settings', {sectionChanges: (current.sectionChanges || []).filter(c => c.key !== change.key)});
    });
  }
  const remote = await teamRequest(`/api/sections?workspace_id=${encodeURIComponent(s.workspace.id)}`);
  if (!Array.isArray(remote.sections)) throw Error('رد قائمة الأقسام غير صالح؛ حدّث الخادم');
  const definitions = remote.sections.filter((d: any) => isDomainId(d?.id) && typeof d.label === 'string' && d.label.trim());
  await db.transaction('rw', db.settings, async () => {
    const fresh = await getSettings();
    if (fresh.workspace.id !== s.workspace.id || fresh.user.id !== s.user.id) return;
    // Never overwrite edits made locally while a network request was in flight.
    const merged = new Map<string, SectionDefinition>(definitions.map((d: SectionDefinition) => [d.id, d]));
    for (const change of fresh.sectionChanges || []) merged.set(change.section.id, change.section);
    const sectionDefinitions = [...merged.values()];
    const active = normalizeDomain(fresh.activeDomain);
    const available = getDomains(sectionDefinitions).some(d => d.id === active);
    await db.settings.update('settings', {sectionDefinitions, ...(!available ? {activeDomain: 'medical' as DomainId} : {})});
  });
}

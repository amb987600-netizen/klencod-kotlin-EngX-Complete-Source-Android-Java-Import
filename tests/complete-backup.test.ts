import 'fake-indexeddb/auto';
import {beforeEach, expect, it} from 'vitest';
import {db, init, getSettings, addSection, switchDomain, createRecord, updateRecord, createBackup, restoreBackup} from '../src/lib';
import {chatDb, enqueueChatMessage} from '../src/chat';
import {decryptBackup} from '../src/security';
import {clearSessionToken} from '../src/accountSession';
beforeEach(async () => {
  await clearSessionToken();
  await db.delete(); await db.open(); await chatDb.delete(); await chatDb.open();
  Object.defineProperty(globalThis, 'navigator', {value: {onLine: false, storage: {persist: async () => true}}, configurable: true});
  await init();
});
it('round-trips all sections, multiple images/files, chat/voice and operation history without erasing another workspace', async () => {
  const first = await addSection('قسم أول'); const second = await addSection('قسم ثان');
  await switchDomain(first.id);
  const d = await createRecord('device', {name: 'جهاز أول', asset_code: 'SAME'});
  await updateRecord(d.id, {name: 'جهاز أول معدل'});
  const attachments = [];
  for (const [name, mime, content] of [['one.png','image/png','data:image/png;base64,SGk='],['two.jpg','image/jpeg','data:image/jpeg;base64,SGk='],['manual.pdf','application/pdf','data:application/pdf;base64,SGk=']]) {
    attachments.push(await createRecord('attachment', {name, mime, content, size: 2, sha256: 'preserved-sha256', entity_type: 'device', entity_id: d.id, kind: 'document'}));
  }
  await enqueueChatMessage({text: 'رسالة نصية'});
  const voiceId = await enqueueChatMessage({file: {name: 'voice.webm', mime: 'audio/webm;codecs=opus', size: 2, content: 'data:audio/webm;codecs=opus;base64,SGk='}});
  await switchDomain(second.id);
  await createRecord('device', {name: 'جهاز ثان', asset_code: 'SAME'});
  const settings = await getSettings();
  const beforeQueue = await db.queue.orderBy('queued_at').toArray();
  const encrypted = await createBackup('complete-backup-password');
  expect(await encrypted.text()).not.toContain('preserved-sha256');
  const payload = await decryptBackup(await encrypted.text(), 'complete-backup-password');
  expect(payload.settings.sectionDefinitions.some((x: any) => x.id === first.id)).toBe(true);
  expect(payload.queue.map((q: any) => [q.id, q.action, q.base_version])).toEqual(beforeQueue.map(q => [q.id, q.action, q.base_version]));
  expect(payload.chat.outbox.some((x: any) => x.client_id === voiceId && x.file.content.includes('codecs=opus'))).toBe(true);
  expect(JSON.stringify(payload)).not.toContain('"token"');
  const otherWorkspace = crypto.randomUUID(), otherId = crypto.randomUUID();
  await db.records.put({...d, id: otherId, workspace_id: otherWorkspace, data: {name: 'حساب آخر'}});
  const otherMessage = {id: crypto.randomUUID(), seq: 1, workspace_id: otherWorkspace, sender_id: 'other', sender_name: 'other', text: 'private', created_at: new Date().toISOString(), domain: 'medical'};
  await chatDb.messages.put(otherMessage);
  await restoreBackup(payload);
  expect((await getSettings()).workspace.id).toBe(settings.workspace.id);
  expect((await getSettings()).activeDomain).toBe(second.id);
  expect((await db.records.get(otherId))?.data.name).toBe('حساب آخر');
  expect(await chatDb.messages.get(otherMessage.id)).toEqual(otherMessage);
  for (const original of attachments) expect((await db.records.get(original.id))?.data).toEqual(original.data);
  expect((await db.queue.orderBy('queued_at').toArray()).map(q => q.id)).toEqual(beforeQueue.map(q => q.id));
  expect((await db.records.get(d.id))?.sync_status).toBe('pending');
  expect((await chatDb.outbox.get(voiceId))?.file?.content).toBe('data:audio/webm;codecs=opus;base64,SGk=');
});
it('rejects a queued operation belonging to another workspace before writing records', async () => {
  await createRecord('device', {name: 'موجود', asset_code: 'KEEP'});
  const payload = await decryptBackup(await (await createBackup('complete-backup-password')).text(), 'complete-backup-password');
  payload.queue[0].record.workspace_id = 'foreign';
  await expect(restoreBackup(payload)).rejects.toThrow('معلقة');
  expect(await db.records.count()).toBe(1);
});

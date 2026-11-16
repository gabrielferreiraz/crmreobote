const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
// Último movimento do responsável, controlado por cada teste.
let touch = null;
function loader() {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const m = { exports: {} }; cache.set(file, m);
    const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', js)(name => {
      if (name === '@/lib/lead-claim') return { lastOwnerTouch: async () => touch, lostLeadReleaseCutoff: (now = new Date()) => { const c = new Date(now); c.setMonth(c.getMonth() - 3); return c; } };
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
      return require(name);
    }, m, m.exports);
    return m.exports;
  }
  return load;
}
const load = loader();
const { panelPhoneLookupVariants } = load('lib/api/painel-phone-match.ts');
const { redistributeExistingDeal, panelRedistributionSchema } = load('lib/api/painel-redistribution.ts');
const { classifyPanelLead, checkPanelLeads } = load('lib/api/painel-lead-eligibility.ts');
const input = (extra = {}) => panelRedistributionSchema.parse({ requestId: 'request-1', campaignKey: 'black-friday-2026', phone: '0624250000', actorId: 'actor', ownerId: 'target', pipelineId: 'pipeline', stageId: 'destination', reopenLost: false, ...extra });
const monthsAgo = n => { const d = new Date(); d.setMonth(d.getMonth() - n); return d; };

// 'old' é o consultor anterior. Por padrão ele saiu da empresa (inativo); cada teste o ativa quando precisa.
function fixture(options = {}) {
  const state = {
    contacts: [{ id: 'contact', organizationId: 'org', name: 'Cliente', phone: '55624250000', phoneNormalized: '55624250000', whatsapp: null, whatsappNormalized: null, responsavelId: 'old', source: 'Original', jobTitle: null }],
    deals: [{ id: 'deal', organizationId: 'org', contactId: 'contact', pipelineId: 'pipeline', stageId: 'old-stage', ownerId: 'old', status: 'OPEN', value: 1200, grossValue: 1500, creditType: 'Imóvel', expectedCloseAt: null, description: 'Histórico original', updatedAt: new Date(0), closedAt: null }],
    audits: [], activities: [], writes: [],
  };
  const active = new Set(options.active || []);
  const actor = { role: options.role || 'OWNER', active: true, user: { name: 'Solicitante' } };
  const matchContact = (row, where) => row.organizationId === where.organizationId && where.OR.some(condition => Object.entries(condition).some(([key, filter]) => filter.in.includes(row[key])));
  const tx = {
    $queryRaw: async () => [],
    organizationUser: {
      findFirst: async ({ where }) => where.userId === 'actor' ? (options.noActor ? null : actor) : where.userId === 'target' && !options.noTarget ? { active: true, role: 'MEMBER', area: 'VENDAS' } : null,
      findMany: async ({ where }) => where.userId.in.filter(id => active.has(id)).map(userId => ({ userId })),
    },
    team: { findMany: async () => [{ leaderId: 'actor', members: options.noTeam ? [] : [{ userId: 'target' }] }] },
    pipelineStage: { findFirst: async () => options.noStage ? null : { id: 'destination', requiredFields: options.required || [] } },
    contact: {
      findMany: async ({ where, take }) => state.contacts.filter(c => matchContact(c, where)).slice(0, take),
      findFirst: async ({ where }) => state.contacts.find(c => c.id === where.id && c.organizationId === where.organizationId) || null,
      update: async ({ where, data }) => { state.writes.push('contact.update'); return Object.assign(state.contacts.find(c => c.id === where.id), data); },
      create: async () => { throw new Error('Creating a contact is forbidden'); },
    },
    deal: {
      findMany: async ({ where }) => state.deals.filter(d => d.organizationId === where.organizationId && where.contactId.in.includes(d.contactId) && where.status.in.includes(d.status)).sort((a, b) => b.updatedAt - a.updatedAt),
      findFirst: async ({ where }) => state.deals.find(d => d.id === where.id && d.organizationId === where.organizationId && d.contactId === where.contactId && d.pipelineId === where.pipelineId) || null,
      update: async ({ where, data }) => { state.writes.push('deal.update'); return Object.assign(state.deals.find(d => d.id === where.id), data); },
      create: async ({ data }) => { state.writes.push('deal.create'); const row = { id: `new-deal-${state.deals.length}`, updatedAt: new Date(), closedAt: null, status: 'OPEN', ...data }; state.deals.push(row); return row; },
    },
    dealParticipant: { deleteMany: async () => { state.writes.push('participant.delete'); return { count: 0 }; } },
    auditLog: { findUnique: async ({ where }) => state.audits.find(a => a.id === where.id) || null,
      create: async ({ data }) => { if (options.auditFails) throw new Error('audit unavailable'); state.audits.push(data); return data; } },
    activity: { create: async ({ data }) => { state.activities.push(data); return data; } },
  };
  // Simulates the transaction boundary used by the route, without network or a real database.
  const run = async (data = input()) => {
    const snapshot = structuredClone(state);
    try { return await redistributeExistingDeal(tx, 'org', 'panel-key', data); }
    catch (error) { for (const key of Object.keys(state)) state[key] = snapshot[key]; throw error; }
  };
  return { state, run, tx, active };
}
const lostDeal = (f, extra = {}) => Object.assign(f.state.deals[0], { status: 'LOST', closedAt: monthsAgo(6), lossReasonId: 'reason', ...extra });
const untouched = (f, id = 'deal') => f.state.deals.find(d => d.id === id);

test('legacy trunk and DDI match the same fixed phone without inventing digits', () => {
  assert.ok(panelPhoneLookupVariants('0624250000').includes('55624250000'));
  assert.ok(panelPhoneLookupVariants('55624250000').includes('624250000'));
  assert.ok(!panelPhoneLookupVariants('6233334444').includes('62933334444'));
  assert.ok(panelPhoneLookupVariants('6294250000').includes('62994250000'));
  assert.ok(panelPhoneLookupVariants('02162942500000').includes('62942500000'));
  assert.deepEqual(panelPhoneLookupVariants('+351 968 203 610'), ['351968203610']);
  assert.deepEqual(panelPhoneLookupVariants('9999999999'), []);
});

// ---- Regras de elegibilidade (mesma função na checagem em lote e na gravação) ----
test('open deal of an inactive consultant: the deal is transferred keeping phones, description and values', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.id, 'deal'); assert.equal(result.contactId, 'contact'); assert.equal(result.outcome, 'updated');
  assert.equal(f.state.contacts[0].phone, '55624250000'); assert.equal(f.state.contacts[0].whatsapp, null);
  assert.equal(f.state.contacts[0].responsavelId, 'target'); assert.equal(f.state.deals[0].ownerId, 'target');
  assert.equal(f.state.deals[0].stageId, 'destination'); assert.equal(f.state.deals[0].description, 'Histórico original');
  assert.equal(f.state.deals[0].value, 1200); assert.equal(f.state.deals.length, 1); assert.equal(f.state.contacts.length, 1);
  assert.equal(result.before.ownerId, 'old'); assert.equal(result.after.ownerId, 'target'); assert.equal(f.state.audits.length, 2);
});
test('open deal of an ACTIVE consultant is blocked, even for the OWNER, with a date to ask again', async () => {
  const f = fixture(); f.active.add('old');
  await assert.rejects(f.run(), e => e.code === 'BLOCKED_OPEN_ACTIVE' && e.retryAfter instanceof Date && e.retryAfter > new Date());
  assert.deepEqual(f.state.writes, []); assert.deepEqual(f.state.audits, []);
});
test('a client (won deal) of an active consultant is blocked', async () => {
  const f = fixture(); f.active.add('old'); f.state.deals[0].status = 'WON';
  await assert.rejects(f.run(), e => e.code === 'BLOCKED_CLIENT_ACTIVE'); assert.deepEqual(f.state.writes, []);
});
test('a client of an inactive consultant is released: new deal, contact owner changes, the won deal is untouched', async () => {
  const f = fixture(); f.state.deals[0].status = 'WON'; f.state.deals[0].closedAt = monthsAgo(1);
  const result = await f.run(); assert.equal(result.outcome, 'created'); assert.equal(result.contactCreated, false); assert.equal(result.previousContactOwnerId, 'old');
  assert.equal(f.state.contacts[0].responsavelId, 'target'); assert.equal(f.state.deals.length, 2);
  assert.equal(untouched(f).status, 'WON'); assert.equal(untouched(f).ownerId, 'old');
  const created = f.state.deals.at(-1); assert.equal(created.ownerId, 'target'); assert.equal(created.stageId, 'destination');
  assert.ok(f.state.audits.some(a => a.action === 'PANEL_DISTRIBUTION_NEW_DEAL'));
});
test('lost less than 3 months ago by an active consultant is blocked until the 3 months end', async () => {
  const f = fixture(); f.active.add('old'); lostDeal(f, { closedAt: monthsAgo(1) });
  await assert.rejects(f.run(), e => e.code === 'BLOCKED_LOST_RECENT' && e.retryAfter > new Date()); assert.deepEqual(f.state.writes, []);
});
test('lost more than 3 months ago by an active consultant is released with a NEW deal; the lost one keeps its history', async () => {
  const f = fixture(); f.active.add('old'); lostDeal(f); touch = null;
  const result = await f.run(); assert.equal(result.outcome, 'created');
  const old = untouched(f); assert.equal(old.status, 'LOST'); assert.equal(old.ownerId, 'old'); assert.equal(old.lossReasonId, 'reason'); assert.ok(old.closedAt);
  assert.equal(f.state.deals.length, 2); assert.equal(f.state.deals.at(-1).ownerId, 'target'); assert.equal(f.state.contacts[0].responsavelId, 'target');
});
test('lost long ago, but the consultant worked the lead recently: still blocked', async () => {
  const f = fixture(); f.active.add('old'); lostDeal(f); touch = monthsAgo(1);
  try { await assert.rejects(f.run(), e => e.code === 'BLOCKED_LOST_RECENT'); } finally { touch = null; }
  assert.deepEqual(f.state.writes, []);
});
test('lost by an inactive consultant is released at any time, with a new deal', async () => {
  const f = fixture(); lostDeal(f, { closedAt: monthsAgo(1) });
  const result = await f.run(); assert.equal(result.outcome, 'created'); assert.equal(untouched(f).status, 'LOST'); assert.equal(f.state.contacts[0].responsavelId, 'target');
});
test('contact of an active consultant with no deal at all is blocked; of an inactive one it gets a deal', async () => {
  const mine = fixture(); mine.state.deals = []; mine.active.add('old');
  await assert.rejects(mine.run(), e => e.code === 'BLOCKED_OWNER_ACTIVE'); assert.deepEqual(mine.state.writes, []);
  const free = fixture(); free.state.deals = [];
  const result = await free.run(); assert.equal(result.outcome, 'created'); assert.equal(result.contactCreated, false);
  assert.equal(free.state.contacts.length, 1); assert.equal(free.state.contacts[0].responsavelId, 'target'); assert.equal(free.state.contacts[0].phone, '55624250000');
});
test('one blocking record among several contacts with the phone blocks the whole lead', async () => {
  const f = fixture(); f.state.contacts.push({ ...f.state.contacts[0], id: 'duplicate', responsavelId: 'busy' });
  f.state.deals.push({ ...f.state.deals[0], id: 'busy-deal', contactId: 'duplicate', ownerId: 'busy' }); f.active.add('busy');
  await assert.rejects(f.run(), e => e.code === 'BLOCKED_OPEN_ACTIVE'); assert.deepEqual(f.state.writes, []);
});
test('another deal of an inactive consultant in another funnel is left alone and the contact still changes owner', async () => {
  const f = fixture(); f.state.deals.push({ ...f.state.deals[0], id: 'other-pipeline', pipelineId: 'another-pipeline', status: 'WON' });
  const result = await f.run();
  assert.equal(f.state.deals[0].ownerId, 'target'); assert.equal(f.state.deals[1].ownerId, 'old'); assert.equal(f.state.deals[1].status, 'WON');
  assert.equal(f.state.contacts[0].responsavelId, 'target'); assert.equal(result.after.contactOwnerId, 'target');
});
test('several deals in the funnel: the open one is transferred and the more recent lost one is untouched', async () => {
  const f = fixture(); f.state.deals[0].updatedAt = new Date(1);
  f.state.deals.push({ ...f.state.deals[0], id: 'lost-recent', status: 'LOST', closedAt: monthsAgo(6), updatedAt: new Date(9) });
  const result = await f.run();
  assert.equal(result.id, 'deal'); assert.equal(f.state.deals[1].ownerId, 'old'); assert.equal(f.state.deals[1].status, 'LOST');
});
test('only lost deals: none is reopened, a new one is created', async () => {
  const f = fixture(); lostDeal(f); f.state.deals.push({ ...f.state.deals[0], id: 'lost-recent', updatedAt: new Date(9) });
  const result = await f.run(); assert.equal(result.outcome, 'created');
  assert.equal(f.state.deals[0].status, 'LOST'); assert.equal(f.state.deals[1].status, 'LOST'); assert.equal(f.state.deals.length, 3);
});
test('several contacts with the phone: the same name wins, then the open and most recent deal', async () => {
  const twoContacts = () => {
    const f = fixture(); f.state.deals[0].updatedAt = new Date(1);
    f.state.contacts.push({ ...f.state.contacts[0], id: 'namesake', name: 'Maria Silva' });
    f.state.deals.push({ ...f.state.deals[0], id: 'namesake-deal', contactId: 'namesake', status: 'LOST', closedAt: monthsAgo(6), updatedAt: new Date(0) });
    return f;
  };
  const named = twoContacts(); const byName = await named.run(input({ fallback: { name: ' maria silva ' } }));
  assert.equal(byName.contactId, 'namesake'); assert.equal(byName.outcome, 'created'); assert.equal(named.state.contacts[0].responsavelId, 'old');
  const unnamed = twoContacts(); const byDeal = await unnamed.run();
  assert.equal(byDeal.contactId, 'contact'); assert.equal(byDeal.outcome, 'updated'); assert.equal(unnamed.state.contacts[1].responsavelId, 'old');
});
test('a retry replays the recorded result without another mutation', async () => {
  const f = fixture(); const first = await f.run(); const writes = f.state.writes.length;
  const replay = await f.run(); assert.equal(replay.replayed, true); assert.equal(first.auditId, replay.auditId);
  assert.equal(f.state.writes.length, writes); assert.equal(f.state.activities.length, 1);
  await assert.rejects(f.run(input({ stageId: 'different' })), e => e.code === 'REQUEST_ID_REUSED');
});
test('same contact/campaign cannot be redistributed by another equivalent-phone row', async () => {
  const f = fixture(); await f.run(); const writes = f.state.writes.length;
  await assert.rejects(f.run(input({ requestId: 'request-2', phone: '55624250000' })), e => e.code === 'CONTACT_ALREADY_DISTRIBUTED');
  assert.equal(f.state.writes.length, writes);
});
test('a duplicate contact already distributed in the campaign blocks the lead', async () => {
  const f = fixture(); f.state.contacts.push({ ...f.state.contacts[0], id: 'duplicate' });
  f.state.deals.push({ ...f.state.deals[0], id: 'duplicate-deal', contactId: 'duplicate', status: 'WON' });
  await f.run();
  const writes = f.state.writes.length;
  await assert.rejects(f.run(input({ requestId: 'request-2' })), e => e.code === 'CONTACT_ALREADY_DISTRIBUTED'); assert.equal(f.state.writes.length, writes);
});
test('a contact with the number only in the normalized fields reaches the consultant with a visible number', async () => {
  const f = fixture(); Object.assign(f.state.contacts[0], { phone: null, phoneNormalized: null, whatsapp: null, whatsappNormalized: '62994250000' });
  await f.run(input({ phone: '62994250000' }));
  assert.equal(f.state.contacts[0].whatsapp, '+55 (62) 99425-0000'); assert.equal(f.state.contacts[0].phone, null);
  assert.equal(f.state.contacts[0].whatsappNormalized, '62994250000'); assert.equal(f.state.contacts[0].responsavelId, 'target');
  assert.ok(f.state.audits.some(audit => audit.action === 'PANEL_DISTRIBUTION_PHONE_RESTORED'));
});
test('a visible number is never rewritten', async () => {
  const f = fixture(); Object.assign(f.state.contacts[0], { phone: null, phoneNormalized: '62994250000', whatsapp: '(62) 9425-0000', whatsappNormalized: null });
  await f.run(input({ phone: '62994250000' }));
  assert.equal(f.state.contacts[0].phone, null); assert.equal(f.state.contacts[0].whatsapp, '(62) 9425-0000');
  assert.ok(!f.state.audits.some(audit => audit.action === 'PANEL_DISTRIBUTION_PHONE_RESTORED'));
});
test('required fields at the stage: the deal still enters the campaign stage, invents nothing and warns', async () => {
  const f = fixture({ required: ['expectedCloseAt'] }); const result = await f.run();
  assert.equal(f.state.deals[0].ownerId, 'target'); assert.equal(f.state.deals[0].stageId, 'destination'); assert.equal(f.state.deals[0].expectedCloseAt, null);
  assert.equal(result.after.stageId, 'destination'); assert.equal(f.state.contacts[0].responsavelId, 'target'); assert.equal(result.warnings.length, 1);
});
test('a supervisor receives free leads from any team, but never the active work of someone else', async () => {
  const lost = fixture({ role: 'SUPERVISOR', active: ['another-team'] }); Object.assign(lost.state.deals[0], { status: 'LOST', ownerId: 'another-team', closedAt: monthsAgo(6) }); lost.state.contacts[0].responsavelId = 'another-team';
  await lost.run(); assert.equal(lost.state.contacts[0].responsavelId, 'target'); assert.equal(untouched(lost).ownerId, 'another-team');
  const open = fixture({ role: 'SUPERVISOR', active: ['another-team'] }); open.state.deals[0].ownerId = 'another-team'; open.state.contacts[0].responsavelId = 'another-team';
  await assert.rejects(open.run(), e => e.code === 'BLOCKED_OPEN_ACTIVE'); assert.deepEqual(open.state.writes, []);
});

// ---- Último recurso: telefone que não existe no CRM ----
const fallback = { name: 'Cliente Novo', description: 'Da planilha' };
const creatable = extra => input({ phone: '65999990000', createIfMissing: true, fallback, ...extra });
function creationFixture(options = {}) {
  const f = fixture(options); const { tx } = f;
  tx.contact.create = async ({ data }) => { f.state.writes.push('contact.create'); const row = { id: 'new-contact', ...data }; f.state.contacts.push(row); return row; };
  tx.auditLog.count = async () => options.createdToday ?? 0;
  tx.$queryRaw = async sql => options.possibleMatch && sql.join('').includes('regexp_replace') ? [{ id: 'parecido' }] : [];
  return f;
}
test('without authorization a missing contact never creates anything', async () => {
  const f = creationFixture(); await assert.rejects(f.run(input({ phone: '65999990000' })), e => e.code === 'CONTACT_NOT_FOUND'); assert.deepEqual(f.state.writes, []);
});
test('last resort creates contact and deal with phone, owner and audit', async () => {
  const f = creationFixture(); const result = await f.run(creatable());
  assert.equal(result.outcome, 'created'); assert.equal(result.before, null); assert.equal(result.contactCreated, true);
  const contact = f.state.contacts.at(-1); const deal = f.state.deals.at(-1);
  assert.ok(contact.whatsappNormalized || contact.phoneNormalized); assert.equal(contact.responsavelId, 'target');
  assert.equal(deal.ownerId, 'target'); assert.equal(deal.stageId, 'destination'); assert.equal(deal.description, 'Da planilha');
  assert.ok(f.state.audits.some(a => a.action === 'PANEL_DISTRIBUTION_CREATED'));
  const writes = f.state.writes.length; const replay = await f.run(creatable());
  assert.equal(replay.replayed, true); assert.equal(f.state.writes.length, writes);
});
test('each last resort guard blocks the creation', async () => {
  for (const [options, data, code] of [
    [{ possibleMatch: true }, creatable(), 'CONTACT_POSSIBLE_MATCH'],
    [{ createdToday: 300 }, creatable(), 'CREATION_LIMIT_REACHED'],
    [{}, creatable({ fallback: undefined }), 'CONTACT_NOT_FOUND'],
    [{}, creatable({ phone: '1234567' }), 'PHONE_NOT_CREATABLE'],
    [{}, creatable({ dealId: 'known' }), 'CONTACT_NOT_FOUND'],
  ]) {
    const f = creationFixture(options);
    await assert.rejects(f.run(data), e => e.code === code, code); assert.deepEqual(f.state.writes, [], code);
  }
});
test('a new deal for a contact that already exists does not use the last resort budget', async () => {
  const f = creationFixture({ createdToday: 300 }); lostDeal(f);
  const result = await f.run(); assert.equal(result.outcome, 'created');
});
for (const options of [{ noActor: true }, { noTarget: true }, { role: 'SUPERVISOR', noTeam: true }, { role: 'MEMBER' }, { noStage: true }]) {
  test(`permissions and stage: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await assert.rejects(f.run()); assert.deepEqual(f.state.writes, []);
  });
}
test('audit failure aborts the transaction together with both updates', async () => {
  const f = fixture({ auditFails: true }); await assert.rejects(f.run(), /audit unavailable/);
  assert.equal(f.state.contacts[0].responsavelId, 'old'); assert.equal(f.state.deals[0].ownerId, 'old'); assert.deepEqual(f.state.activities, []);
});

// ---- Checagem em lote: mesma decisão, sem gravar nada ----
test('batch check: new, free, blocked and invalid phones are answered in one call, writing nothing', async () => {
  const f = fixture(); f.state.contacts[0].responsavelId = 'busy'; f.active.add('busy');
  f.state.contacts.push({ id: 'free', organizationId: 'org', name: 'Livre', phone: null, phoneNormalized: '11988887777', whatsapp: null, whatsappNormalized: null, responsavelId: 'old' });
  f.state.deals.push({ id: 'free-deal', organizationId: 'org', contactId: 'free', pipelineId: 'pipeline', status: 'LOST', ownerId: 'old', closedAt: monthsAgo(1), updatedAt: new Date(0) });
  f.state.deals[0].ownerId = 'busy';
  const db = { contact: { findMany: async ({ where }) => f.state.contacts.filter(c => where.OR.some(cond => Object.entries(cond).some(([k, v]) => v.in.includes(c[k])))) },
    deal: f.tx.deal, organizationUser: f.tx.organizationUser, auditLog: { findMany: async () => [] } };
  const answers = await checkPanelLeads(db, 'org', { campaignKey: 'black-friday-2026', pipelineId: 'pipeline', phones: ['0624250000', '11988887777', '21977776666', 'abc'] }, async () => null);
  assert.deepEqual(answers.map(a => [a.free, a.action ?? a.code]), [[false, 'BLOCKED_OPEN_ACTIVE'], [true, 'NEW_DEAL'], [true, 'NEW'], [false, 'PHONE_NOT_SEARCHABLE']]);
  assert.ok(answers[0].retryAfter); assert.deepEqual(f.state.writes, []);
});
test('classification: a lead already distributed in the campaign never returns', async () => {
  const answer = await classifyPanelLead({ contacts: [{ id: 'c', name: 'A', responsavelId: null }], deals: [], activeUserIds: new Set(), pipelineId: 'p', campaignDistributed: true, lastTouch: async () => null });
  assert.equal(answer.free, false); assert.equal(answer.code, 'CONTACT_ALREADY_DISTRIBUTED'); assert.equal(answer.retryAfter, null);
});

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function loader() {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const m = { exports: {} }; cache.set(file, m);
    const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', js)(name => {
      if (name === '@/lib/lead-claim') return { evaluateLeadClaim: async () => ({ claimReason: null }) };
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
const input = (extra = {}) => panelRedistributionSchema.parse({ requestId: 'request-1', campaignKey: 'black-friday-2026', phone: '0624250000', actorId: 'actor', ownerId: 'target', pipelineId: 'pipeline', stageId: 'destination', reopenLost: false, ...extra });

function fixture(options = {}) {
  const state = {
    contacts: [{ id: 'contact', organizationId: 'org', name: 'Cliente', phone: '55624250000', phoneNormalized: '55624250000', whatsapp: null, whatsappNormalized: null, responsavelId: 'old', source: 'Original', jobTitle: null }],
    deals: [{ id: 'deal', organizationId: 'org', contactId: 'contact', pipelineId: 'pipeline', stageId: 'old-stage', ownerId: 'old', status: 'OPEN', value: 1200, grossValue: 1500, creditType: 'Imóvel', expectedCloseAt: null, description: 'Histórico original' }],
    audits: [], activities: [], writes: [],
  };
  const actor = { role: options.role || 'OWNER', active: true, user: { name: 'Solicitante' } };
  const matchContact = (row, where) => row.organizationId === where.organizationId && where.OR.some(condition => Object.entries(condition).some(([key, filter]) => filter.in.includes(row[key])));
  const tx = {
    $queryRaw: async () => [],
    organizationUser: { findFirst: async ({ where }) => where.userId === 'actor' ? (options.noActor ? null : actor) : where.userId === 'target' && !options.noTarget ? { active: true, role: 'MEMBER', area: 'VENDAS' } : null },
    team: { findMany: async () => [{ leaderId: 'actor', members: options.noTeam ? [] : [{ userId: 'target' }, { userId: 'old' }] }] },
    pipelineStage: { findFirst: async () => options.noStage ? null : { id: 'destination', requiredFields: options.required || [] } },
    contact: {
      findMany: async ({ where, take }) => state.contacts.filter(c => matchContact(c, where)).slice(0, take),
      findFirst: async ({ where }) => state.contacts.find(c => c.id === where.id && c.organizationId === where.organizationId) || null,
      update: async ({ where, data }) => { state.writes.push('contact.update'); return Object.assign(state.contacts.find(c => c.id === where.id), data); },
      create: async () => { throw new Error('Creating a contact is forbidden'); },
    },
    deal: {
      findMany: async ({ where, take }) => state.deals.filter(d => d.organizationId === where.organizationId && d.contactId === where.contactId && d.pipelineId === where.pipelineId && where.status.in.includes(d.status) && (!where.id || d.id === where.id)).slice(0, take),
      findFirst: async ({ where }) => state.deals.find(d => d.organizationId === where.organizationId && d.contactId === where.contactId &&
        (typeof where.id === 'string' ? d.id === where.id && d.pipelineId === where.pipelineId : d.id !== where.id.not && where.status.in.includes(d.status) && d.ownerId !== where.ownerId.not)) || null,
      update: async ({ where, data }) => { state.writes.push('deal.update'); return Object.assign(state.deals.find(d => d.id === where.id), data); },
      create: async () => { throw new Error('Creating a deal is forbidden'); },
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
  return { state, run, tx };
}

test('legacy trunk and DDI match the same fixed phone without inventing digits', () => {
  assert.ok(panelPhoneLookupVariants('0624250000').includes('55624250000'));
  assert.ok(panelPhoneLookupVariants('55624250000').includes('624250000'));
  assert.ok(!panelPhoneLookupVariants('6233334444').includes('62933334444'));
  assert.ok(panelPhoneLookupVariants('6294250000').includes('62994250000'));
  assert.ok(panelPhoneLookupVariants('02162942500000').includes('62942500000'));
  assert.deepEqual(panelPhoneLookupVariants('+351 968 203 610'), ['351968203610']);
  assert.deepEqual(panelPhoneLookupVariants('9999999999'), []);
});
test('updates the existing deal/contact, preserving original phones, description and values', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.id, 'deal'); assert.equal(result.contactId, 'contact');
  assert.equal(f.state.contacts[0].phone, '55624250000'); assert.equal(f.state.contacts[0].whatsapp, null);
  assert.equal(f.state.contacts[0].responsavelId, 'target'); assert.equal(f.state.deals[0].ownerId, 'target');
  assert.equal(f.state.deals[0].stageId, 'destination'); assert.equal(f.state.deals[0].description, 'Histórico original');
  assert.equal(f.state.deals[0].value, 1200); assert.equal(f.state.deals.length, 1); assert.equal(f.state.contacts.length, 1);
  assert.equal(result.before.ownerId, 'old'); assert.equal(result.after.ownerId, 'target'); assert.equal(f.state.audits.length, 2);
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
for (const scenario of ['missing-contact', 'ambiguous-contact', 'ambiguous-deal', 'won', 'lost', 'other-active']) {
  test(`${scenario} leaves the CRM records unchanged`, async () => {
    const f = fixture();
    if (scenario === 'missing-contact') f.state.contacts = [];
    if (scenario === 'ambiguous-contact') f.state.contacts.push({ ...f.state.contacts[0], id: 'another' });
    if (scenario === 'ambiguous-deal') f.state.deals.push({ ...f.state.deals[0], id: 'another' });
    if (scenario === 'won') f.state.deals[0].status = 'WON';
    if (scenario === 'lost') f.state.deals[0].status = 'LOST';
    if (scenario === 'other-active') f.state.deals.push({ ...f.state.deals[0], id: 'other-pipeline', pipelineId: 'another-pipeline', status: 'WON' });
    await assert.rejects(f.run()); assert.deepEqual(f.state.writes, []); assert.deepEqual(f.state.audits, []);
  });
}
const fallback = { name: 'Cliente Novo', description: 'Da planilha' };
const creatable = extra => input({ phone: '65999990000', createIfMissing: true, fallback, ...extra });
function creationFixture(options = {}) {
  const f = fixture(options); const { tx } = f;
  tx.contact.create = async ({ data }) => { f.state.writes.push('contact.create'); const row = { id: 'new-contact', ...data }; f.state.contacts.push(row); return row; };
  tx.deal.create = async ({ data }) => { f.state.writes.push('deal.create'); const row = { id: 'new-deal', ...data }; f.state.deals.push(row); return row; };
  tx.deal.count = async ({ where }) => f.state.deals.filter(d => d.contactId === where.contactId).length;
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
    [{ createdToday: 20 }, creatable(), 'CREATION_LIMIT_REACHED'],
    [{ required: ['expectedCloseAt'] }, creatable(), 'STAGE_REQUIRED_FIELDS'],
    [{}, creatable({ fallback: undefined }), 'CONTACT_NOT_FOUND'],
    [{}, creatable({ phone: '1234567' }), 'PHONE_NOT_CREATABLE'],
    [{}, creatable({ dealId: 'known' }), 'CONTACT_NOT_FOUND'],
  ]) {
    const f = creationFixture(options);
    await assert.rejects(f.run(data), e => e.code === code, code); assert.deepEqual(f.state.writes, [], code);
  }
});
test('existing contact only gets a deal when it has none at all', async () => {
  const empty = creationFixture(); empty.state.deals = [];
  const result = await empty.run(input({ createIfMissing: true })); assert.equal(result.outcome, 'created'); assert.equal(result.contactCreated, false);
  assert.equal(empty.state.contacts.length, 1); assert.equal(empty.state.contacts[0].responsavelId, 'target'); assert.equal(empty.state.contacts[0].phone, '55624250000');
  for (const status of ['WON', 'OPEN']) {
    const other = creationFixture(); other.state.deals[0].status = status; other.state.deals[0].pipelineId = status === 'OPEN' ? 'another-pipeline' : 'pipeline';
    await assert.rejects(other.run(input({ createIfMissing: true })), e => e.code === 'DEAL_NOT_FOUND'); assert.deepEqual(other.state.writes, []);
  }
});
test('lost deals reopen only with explicit authorization', async () => {
  const f = fixture(); f.state.deals[0].status = 'LOST';
  await f.run(input({ reopenLost: true })); assert.equal(f.state.deals[0].status, 'OPEN');
});
for (const options of [{ noActor: true }, { noTarget: true }, { role: 'SUPERVISOR', noTeam: true }, { role: 'MEMBER' }, { noStage: true }, { required: ['expectedCloseAt'] }]) {
  test(`permissions and stage requirements: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await assert.rejects(f.run()); assert.deepEqual(f.state.writes, []);
  });
}
test('an active owner outside the supervisors team is protected', async () => {
  const f = fixture({ role: 'SUPERVISOR' }); f.state.deals[0].ownerId = 'another-team'; f.state.contacts[0].responsavelId = 'another-team';
  await assert.rejects(f.run(), e => e.code === 'CURRENT_OWNER_OUTSIDE_TEAM'); assert.deepEqual(f.state.writes, []);
});
test('audit failure aborts the transaction together with both updates', async () => {
  const f = fixture({ auditFails: true }); await assert.rejects(f.run(), /audit unavailable/);
  assert.equal(f.state.contacts[0].responsavelId, 'old'); assert.equal(f.state.deals[0].ownerId, 'old'); assert.deepEqual(f.state.activities, []);
});

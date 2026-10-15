import { all, asDate, get, newId, parseJson, run } from './database.js';

const candidateFields = ['accountName','soNumber','requirementDetails','jobRole','candidateName','candidateId','candidateEmail','candidatePhone','recruiterName','dateRequirementOpened','dateCandidateReceived','dateCandidatePresented','numberCandidatesPresented','totalExperience','ageingDays','ageingCategory','applicationStatus','candidateStatus','currentStatus','clientFeedback','interviewDate','joiningDate','remarks','lastUpdatedDate','customFields'] as const;
const requirementFields = ['accountName','soNumber','requirementDetails','jobRole','recruiterName','dateOpened','customFields'] as const;
const jsonFields = new Set(['customFields','errors','changes','value']);
const dateFields = new Set(['dateRequirementOpened','dateCandidateReceived','dateCandidatePresented','interviewDate','joiningDate','lastUpdatedDate','dateOpened','createdAt','updatedAt','importedAt']);
const columns = new Set(['id','applicationId','requirement','accountName','soNumber','requirementDetails','jobRole','candidateName','candidateId','candidateEmail','candidatePhone','recruiterName','dateRequirementOpened','dateCandidateReceived','dateCandidatePresented','numberCandidatesPresented','totalExperience','ageingDays','ageingCategory','applicationStatus','candidateStatus','currentStatus','clientFeedback','interviewDate','joiningDate','remarks','lastUpdatedDate','customFields','createdAt','updatedAt','dateOpened','fileName','importedAt','totalRows','importedRows','updatedRows','duplicateRows','rejectedRows','status','mode','errors','email','active','action','changedBy','changes','key','value']);
const valueFor = (key: string, value: unknown) => jsonFields.has(key) ? JSON.stringify(value ?? (key === 'errors' ? [] : {})) : dateFields.has(key) ? asDate(value) : value === undefined ? null : value;
const normalizeRequirementData = (data: Record<string, unknown>): Record<string, unknown> => ({ ...data, accountName: typeof data.accountName === 'string' && data.accountName.trim() ? data.accountName.trim() : null });
const document = <T extends Record<string, any>>(row: T | undefined) => {
  if (!row) return null;
  const result: Record<string, any> = { ...row, _id: row.id };
  delete result.id;
  for (const key of Object.keys(result)) {
    if (jsonFields.has(key)) result[key] = parseJson(result[key], key === 'errors' ? [] : {});
    if (dateFields.has(key) && result[key]) result[key] = new Date(result[key]).toISOString();
  }
  return result;
};
const insert = (table: string, data: Record<string, unknown>) => {
  const keys = Object.keys(data);
  run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map(key => valueFor(key, data[key]) as any));
};
const update = (table: string, id: string, data: Record<string, unknown>) => {
  const entries = Object.entries(data).filter(([key, value]) => columns.has(key) && key !== 'id' && key !== 'createdAt' && value !== undefined);
  if (!entries.length) return;
  run(`UPDATE ${table} SET ${entries.map(([key]) => `${key} = ?`).join(',')}, updatedAt = ? WHERE id = ?`, [...entries.map(([key, value]) => valueFor(key, value) as any), new Date().toISOString(), id]);
};
const filterSql = (filter: Record<string, unknown>, searchable: string[]) => {
  const where: string[] = [];
  const params: any[] = [];
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === '') continue;
    if (key === '$search') {
      where.push(`(${searchable.map(field => `LOWER(COALESCE(${field},'')) LIKE ?`).join(' OR ')})`);
      params.push(...searchable.map(() => `%${String(value).toLowerCase()}%`));
    } else if (columns.has(key)) {
      where.push(`LOWER(COALESCE(${key},'')) LIKE ?`);
      params.push(`%${String(value).toLowerCase()}%`);
    }
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
};

export const isConnected = () => true;
export const candidates = {
  list(filter: Record<string, unknown>, sort = 'createdAt', order = 'DESC', offset = 0, limit?: number) {
    const where = filterSql(filter, ['candidateName','candidateEmail','soNumber','accountName','jobRole']);
    const safeSort = columns.has(sort) ? sort : 'createdAt';
    const rows = all(`SELECT * FROM candidates ${where.sql} ORDER BY ${safeSort} ${order === 'ASC' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`, [...where.params, limit ?? -1, offset]);
    return rows.map(row => document(row as any));
  },
  count(filter: Record<string, unknown>) {
    const where = filterSql(filter, ['candidateName','candidateEmail','soNumber','accountName','jobRole']);
    return Number((get(`SELECT COUNT(*) AS count FROM candidates ${where.sql}`, where.params) as any).count);
  },
  get(id: string) { return document(get('SELECT * FROM candidates WHERE id = ?', [id]) as any); },
  byApplicationId(id: string) { return document(get('SELECT * FROM candidates WHERE applicationId = ?', [id]) as any); },
  byRequirement(requirement: string) { return all('SELECT * FROM candidates WHERE requirement = ? ORDER BY createdAt DESC', [requirement]).map(row => document(row as any)); },
  create(data: Record<string, unknown>) {
    const now = new Date().toISOString();
    const record = { id: newId(), ...data, createdAt: now, updatedAt: now };
    insert('candidates', record);
    return document(get('SELECT * FROM candidates WHERE id = ?', [record.id]) as any);
  },
  update(id: string, data: Record<string, unknown>) { update('candidates', id, data); return this.get(id); },
  grouped(field: string, filter: Record<string, unknown> = {}, limit = 12) {
    const groupField = ['jobRole','accountName','currentStatus','recruiterName'].includes(field) ? field : 'jobRole';
    const where = filterSql(filter, []);
    return all(`SELECT COALESCE(NULLIF(${groupField}, ''), 'Unspecified') AS _id, COUNT(*) AS count FROM candidates ${where.sql} GROUP BY ${groupField} ORDER BY count DESC LIMIT ?`, [...where.params, limit]);
  },
  statusCounts(filter: Record<string, unknown> = {}) {
    const where = filterSql(filter, []);
    return all(`SELECT COALESCE(NULLIF(currentStatus,''),'Unspecified') AS _id, COUNT(*) AS count FROM candidates ${where.sql} GROUP BY currentStatus`, where.params);
  },
  presentedCount(filter: Record<string, unknown> = {}) {
    const where = filterSql(filter, []);
    return Number((get(`SELECT COUNT(*) AS count FROM candidates ${where.sql ? `${where.sql} AND` : 'WHERE'} dateCandidatePresented IS NOT NULL`, where.params) as any).count);
  },
  requirementGroups(filter: Record<string, unknown> = {}) {
    const where = filterSql(filter, []);
    return all(`SELECT soNumber, jobRole, COUNT(*) AS count FROM candidates ${where.sql} GROUP BY soNumber, jobRole ORDER BY count DESC LIMIT 10`, where.params).map((row:any)=>({_id:{soNumber:row.soNumber,jobRole:row.jobRole},count:row.count}));
  },
  monthly(filter: Record<string, unknown> = {}) {
    const where = filterSql(filter, []);
    return all(`SELECT strftime('%Y-%m', createdAt) AS _id, COUNT(*) AS count FROM candidates ${where.sql} GROUP BY strftime('%Y-%m', createdAt) ORDER BY _id LIMIT 12`, where.params);
  },
  all(filter: Record<string, unknown> = {}, sort = 'createdAt', order = 'DESC') {
    const where = filterSql(filter, ['candidateName','candidateEmail','soNumber','accountName','jobRole']);
    const safeSort = columns.has(sort) ? sort : 'createdAt';
    return all(`SELECT * FROM candidates ${where.sql} ORDER BY ${safeSort} ${order === 'ASC' ? 'ASC' : 'DESC'}`, where.params).map(row => document(row as any));
  },
};

export const requirements = {
  list(filter: Record<string, unknown>, offset = 0, limit = 20) {
    const where = filterSql(filter, ['accountName','soNumber','jobRole','recruiterName','requirementDetails']);
    return all(`SELECT * FROM requirements ${where.sql} ORDER BY updatedAt DESC LIMIT ? OFFSET ?`, [...where.params, limit, offset]).map(row => document(row as any));
  },
  count(filter: Record<string, unknown>) {
    const where = filterSql(filter, ['accountName','soNumber','jobRole','recruiterName','requirementDetails']);
    return Number((get(`SELECT COUNT(*) AS count FROM requirements ${where.sql}`, where.params) as any).count);
  },
  requirementsByAge(field: 'dateOpened', comparator: '<' | '>=', date: string, filter: Record<string, unknown> = {}) {
    const where = filterSql(filter, ['accountName','soNumber','jobRole','recruiterName']);
    return Number((get(`SELECT COUNT(*) AS count FROM requirements ${where.sql ? `${where.sql} AND` : 'WHERE'} ${field} ${comparator} ?`, [...where.params, date]) as any).count);
  },
  get(id: string) { return document(get('SELECT * FROM requirements WHERE id = ?', [id]) as any); },
  upsert(data: Record<string, unknown>) {
    const normalized = normalizeRequirementData(data);
    const existing = get("SELECT * FROM requirements WHERE LOWER(COALESCE(accountName,'')) = LOWER(COALESCE(?,'')) AND soNumber = ? AND jobRole = ?", [normalized.accountName as any, normalized.soNumber as any, normalized.jobRole as any]) as any;
    const now = new Date().toISOString();
    if (existing) {
      update('requirements', existing.id, normalized);
      return this.get(existing.id);
    }
    const record = { id: newId(), ...normalized, createdAt: now, updatedAt: now };
    insert('requirements', record);
    return document(get('SELECT * FROM requirements WHERE id = ?', [record.id]) as any);
  },
};

export const importHistory = {
  create(data: Record<string, unknown>) {
    const record = { id: newId(), importedAt: new Date().toISOString(), ...data };
    insert('import_history', record);
    return document(get('SELECT * FROM import_history WHERE id = ?', [record.id]) as any);
  },
  list() { return all('SELECT * FROM import_history ORDER BY importedAt DESC LIMIT 100').map(row => document(row as any)); },
  get(id: string) { return document(get('SELECT * FROM import_history WHERE id = ?', [id]) as any); },
};

export const auditLogs = {
  create(data: Record<string, unknown>) { insert('audit_logs', { id: newId(), createdAt: new Date().toISOString(), ...data }); },
};

export const settings = {
  list() { return all('SELECT * FROM app_settings').map(row => document(row as any)); },
  upsert(key: string, value: unknown) {
    run('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
    return this.list().find(item => item?.key === key);
  },
};

export const recruiters = {
  upsert(name: string) { run('INSERT INTO recruiters (id, name) VALUES (?, ?) ON CONFLICT(name) DO NOTHING', [newId(), name]); },
};

export { candidateFields, requirementFields };
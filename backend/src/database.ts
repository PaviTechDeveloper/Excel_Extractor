import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import initSqlJs, { Database as SqlJsDatabase, SqlValue } from 'sql.js';

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const filename = process.env.SQLITE_FILE
  ? resolve(backendDirectory, '..', process.env.SQLITE_FILE)
  : resolve(backendDirectory, 'data/recruitment.sqlite');
mkdirSync(dirname(filename), { recursive: true });

const SQL = await initSqlJs();
const raw = new SQL.Database(existsSync(filename) ? new Uint8Array(readFileSync(filename)) : undefined);
raw.run('PRAGMA foreign_keys = ON');
const persist = () => writeFileSync(filename, Buffer.from(raw.export()));

type Params = Record<string, SqlValue> | SqlValue[];
const values = (params?: Params) => params === undefined ? [] : params;
const database = {
  exec(sql: string) { raw.exec(sql); persist(); },
  prepare(sql: string) {
    return {
      all(...params: Params[]) {
        const statement = raw.prepare(sql);
        try {
          statement.bind(values(params[0]));
          const rows: Record<string, unknown>[] = [];
          while (statement.step()) rows.push(statement.getAsObject());
          return rows;
        } finally { statement.free(); }
      },
      get(...params: Params[]) {
        return this.all(...params)[0];
      },
      run(...params: Params[]) {
        raw.run(sql, values(params[0]));
        const result = { changes: raw.getRowsModified(), lastInsertRowid: 0 };
        persist();
        return result;
      },
    };
  },
};

export { database };
export const all = (sql: string, params: SqlValue[] = []) => database.prepare(sql).all(params);
export const get = (sql: string, params: SqlValue[] = []) => database.prepare(sql).get(params);
export const run = (sql: string, params: SqlValue[] = []) => database.prepare(sql).run(params);

database.exec(`
  CREATE TABLE IF NOT EXISTS requirements (
    id TEXT PRIMARY KEY,
    accountName TEXT,
    soNumber TEXT NOT NULL,
    requirementDetails TEXT,
    jobRole TEXT NOT NULL,
    recruiterName TEXT,
    dateOpened TEXT,
    customFields TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    UNIQUE (accountName, soNumber, jobRole)
  );
  CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    applicationId TEXT NOT NULL UNIQUE,
    requirement TEXT NOT NULL REFERENCES requirements(id),
    accountName TEXT,
    soNumber TEXT,
    requirementDetails TEXT,
    jobRole TEXT,
    candidateName TEXT NOT NULL,
    candidateId TEXT,
    candidateEmail TEXT,
    candidatePhone TEXT,
    recruiterName TEXT,
    dateRequirementOpened TEXT,
    dateCandidateReceived TEXT,
    dateCandidatePresented TEXT,
    numberCandidatesPresented REAL,
    totalExperience TEXT,
    ageingDays REAL,
    ageingCategory TEXT,
    applicationStatus TEXT,
    candidateStatus TEXT,
    currentStatus TEXT,
    clientFeedback TEXT,
    interviewDate TEXT,
    joiningDate TEXT,
    remarks TEXT,
    lastUpdatedDate TEXT,
    customFields TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS candidates_requirement_idx ON candidates(requirement);
  CREATE INDEX IF NOT EXISTS candidates_recruiter_idx ON candidates(recruiterName);
  CREATE TABLE IF NOT EXISTS import_history (
    id TEXT PRIMARY KEY,
    fileName TEXT,
    importedAt TEXT NOT NULL,
    totalRows INTEGER,
    importedRows INTEGER,
    updatedRows INTEGER,
    duplicateRows INTEGER,
    rejectedRows INTEGER,
    status TEXT,
    mode TEXT,
    errors TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    applicationId TEXT,
    action TEXT,
    changedBy TEXT,
    changes TEXT NOT NULL DEFAULT '{}',
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recruiters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    email TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );
`);

const candidateColumns = new Set((raw.exec('PRAGMA table_info(candidates)')[0]?.values ?? []).map((column: any[]) => column[1]));
for (const [column, type] of [['candidateId','TEXT'],['totalExperience','TEXT'],['ageingDays','REAL'],['ageingCategory','TEXT']] as const) {
  if (!candidateColumns.has(column)) raw.run(`ALTER TABLE candidates ADD COLUMN ${column} ${type}`);
}

const uniqueIndexes = raw.exec('PRAGMA index_list(requirements)')[0]?.values ?? [];
const hasLegacyRequirementIndex = uniqueIndexes.some((index: any[]) => {
  if (!index[2]) return false;
  const columns = raw.exec(`PRAGMA index_info(${String(index[1]).replaceAll("'", "''")})`)[0]?.values ?? [];
  return columns.map((column: any[]) => column[2]).join(',') === 'soNumber,jobRole';
});
if (hasLegacyRequirementIndex) {
  raw.run('PRAGMA foreign_keys = OFF');
  raw.run('BEGIN');
  try {
    raw.run(`CREATE TABLE requirements_account_scope (
      id TEXT PRIMARY KEY, accountName TEXT, soNumber TEXT NOT NULL, requirementDetails TEXT,
      jobRole TEXT NOT NULL, recruiterName TEXT, dateOpened TEXT, customFields TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, UNIQUE(accountName, soNumber, jobRole)
    )`);
    raw.run(`INSERT INTO requirements_account_scope SELECT * FROM requirements`);
    raw.run('DROP TABLE requirements');
    raw.run('ALTER TABLE requirements_account_scope RENAME TO requirements');
    raw.run('CREATE INDEX IF NOT EXISTS candidates_requirement_idx ON candidates(requirement)');
    raw.run('COMMIT');
  } catch (error) {
    raw.run('ROLLBACK');
    throw error;
  } finally {
    raw.run('PRAGMA foreign_keys = ON');
  }
  persist();
}

export const newId = () => randomUUID();
export const asDate = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
export const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};
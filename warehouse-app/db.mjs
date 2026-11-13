import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export const id = randomUUID;
export const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
export const first = async (db, sql, params) => (await db.query(sql, params)).rows[0];
pg.types.setTypeParser(1082, value => value);

export function database(connectionString) {
  const connection = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(connection.protocol)) throw new Error('Use a PostgreSQL DATABASE_URL');
  const useTls = process.env.NODE_ENV === 'production' || connection.hostname.endsWith('.neon.tech');
  if (useTls) {
    connection.searchParams.delete('sslmode');
    connection.searchParams.delete('channel_binding');
  }
  return new pg.Pool({connectionString:connection.href, ...(useTls?{ssl:{rejectUnauthorized:true}}:{}),
    max:8, connectionTimeoutMillis:10000, idleTimeoutMillis:30000, statement_timeout:12000});
}

export async function transaction(db, operation) {
  if (typeof db.transaction === 'function') return db.transaction(operation);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate(db) {
  await transaction(db, async client => {
    await client.query('SELECT pg_advisory_xact_lock(49026831)');
    await client.query(schema);
  });
}

export function fail(statusCode, message) {
  throw Object.assign(new Error(message), { statusCode });
}

export const audit = (db, context, action, reference, detail = null) => db.query(
  'INSERT INTO audit_log(workspace_id,actor_id,actor_name,action,reference,detail) VALUES($1,$2,$3,$4,$5,$6)',
  [context.workspace_id, context.member_id, context.member_name, action, reference, detail]
);

export function dateInZone(zone = 'Africa/Accra', date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
}

export async function cleanExpired(db) {
  await db.query('DELETE FROM workspaces WHERE id IN (SELECT id FROM workspaces WHERE is_demo AND expires_at<=now() LIMIT 50)');
  await db.query('DELETE FROM sessions WHERE expires_at<=now()');
  await db.query('DELETE FROM invites WHERE expires_at<=now()');
  await db.query('DELETE FROM auth_limits WHERE expires_at<=now()');
}

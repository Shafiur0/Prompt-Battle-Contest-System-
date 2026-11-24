import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config';
import { db } from '../db/pool';
import { errors } from './errors';

export interface SessionUser {
  id: string;
  subject: string;
  alias: string;
  email: string | null;
}

export interface CompetitionRole {
  competitionId: string;
  role: 'PARTICIPANT' | 'ORGANIZER' | 'REVIEWER' | 'APPEAL_REVIEWER';
}

export interface Session {
  user: SessionUser;
  roles: CompetitionRole[];
}

declare module 'express-serve-static-core' {
  interface Request {
    session?: Session;
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function remoteKeys(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${config.keycloak.issuer}/protocol/openid-connect/certs`));
  }
  return jwks;
}

async function subjectFromRequest(req: Request): Promise<{ subject: string; alias: string; email: string | null } | null> {
  if (config.authMode === 'dev') {
    const header = req.header('x-dev-user');
    if (!header) return null;
    const name = header.trim().slice(0, 64);
    if (!name) return null;
    return { subject: `dev:${name}`, alias: name, email: null };
  }

  const authorization = req.header('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return null;
  const { payload } = await jwtVerify(token, remoteKeys(), {
    issuer: config.keycloak.issuer,
    audience: config.keycloak.clientId
  });
  const subject = String(payload.sub ?? '');
  if (!subject) return null;
  const alias =
    (payload.preferred_username as string | undefined) ??
    (payload.name as string | undefined) ??
    subject.slice(0, 12);
  return { subject, alias, email: (payload.email as string | undefined) ?? null };
}

async function getOrCreateUser(identity: {
  subject: string;
  alias: string;
  email: string | null;
}): Promise<SessionUser> {
  const existing = await db.one<{ id: string; display_alias: string; email: string | null }>(
    `select id, display_alias, email from users where idp_subject = $1`,
    [identity.subject]
  );
  if (existing) {
    return { id: existing.id, subject: identity.subject, alias: existing.display_alias, email: existing.email };
  }
  const created = await db.must<{ id: string }>(
    `insert into users (idp_subject, display_alias, email) values ($1, $2, $3) returning id`,
    [identity.subject, identity.alias, identity.email]
  );
  return { id: created.id, subject: identity.subject, alias: identity.alias, email: identity.email };
}

export async function loadSession(userId: string, subject: string): Promise<Session> {
  const user = await db.must<{ id: string; display_alias: string; email: string | null }>(
    `select id, display_alias, email from users where id = $1`,
    [userId]
  );
  const roles = await db.query<{ competition_id: string; role: CompetitionRole['role'] }>(
    `select competition_id, role from competition_roles where user_id = $1`,
    [userId]
  );
  return {
    user: { id: user.id, subject, alias: user.display_alias, email: user.email },
    roles: roles.map((r) => ({ competitionId: r.competition_id, role: r.role }))
  };
}

export async function attachSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const identity = await subjectFromRequest(req);
    if (identity) {
      const user = await getOrCreateUser(identity);
      req.session = await loadSession(user.id, identity.subject);
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireSession(req: Request): Session {
  if (!req.session) throw errors.unauthenticated();
  return req.session;
}

export function requireOrganizer(req: Request, competitionId: string): Session {
  const session = requireSession(req);
  const allowed = session.roles.some(
    (r) => r.competitionId === competitionId && (r.role === 'ORGANIZER' || r.role === 'REVIEWER')
  );
  if (!allowed) throw errors.forbidden();
  return session;
}

export function requireReviewer(req: Request, competitionId: string): Session {
  const session = requireSession(req);
  const allowed = session.roles.some(
    (r) => r.competitionId === competitionId && (r.role === 'REVIEWER' || r.role === 'ORGANIZER')
  );
  if (!allowed) throw errors.forbidden();
  return session;
}

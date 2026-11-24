import type { Db } from '../db/pool';
import { TxError } from '../db/pool';
import type { CompetitionRow, ProblemRow, RulesRow } from './rules';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Context {
  competition: CompetitionRow;
  rules: RulesRow;
  problem: ProblemRow;
}

export async function findCompetition(db: Db, idOrSlug: string): Promise<CompetitionRow> {
  const column = UUID.test(idOrSlug) ? 'id' : 'slug';
  const row = await db.one<CompetitionRow>(`select * from competitions where ${column} = $1`, [idOrSlug]);
  if (!row) throw new TxError('NOT_FOUND', 'Competition not found', 404);
  return row;
}

export async function loadRules(db: Db, id: string): Promise<RulesRow> {
  const row = await db.one<RulesRow>(`select * from competition_rules_versions where id = $1`, [id]);
  if (!row) throw new TxError('RULES_NOT_FOUND', 'Rules manifest not found', 404);
  return row;
}

export async function loadProblem(db: Db, competitionId: string): Promise<ProblemRow> {
  const row = await db.one<ProblemRow>(
    `select cp.id as competition_problem_id,
            pv.id as problem_version_id,
            p.id  as problem_id,
            p.problem_type,
            pv.title, pv.statement, pv.objectives, pv.public_constraints,
            pv.output_contract, pv.public_examples, pv.problem_payload
       from competition_problems cp
       join problem_versions pv on pv.id = cp.problem_version_id
       join problems p on p.id = pv.problem_id
      where cp.competition_id = $1
      order by cp.ordinal
      limit 1`,
    [competitionId]
  );
  if (!row) throw new TxError('PROBLEM_NOT_FOUND', 'No problem is assigned to this competition', 404);
  return row;
}

export async function loadContext(db: Db, idOrSlug: string): Promise<Context> {
  const competition = await findCompetition(db, idOrSlug);
  const [rules, problem] = await Promise.all([
    loadRules(db, competition.rules_version_id),
    loadProblem(db, competition.id)
  ]);
  return { competition, rules, problem };
}

export interface ParticipantRow {
  id: string;
  competition_id: string;
  user_id: string;
  enrollment_status: string;
  rules_accepted_version_id: string;
  enrolled_at: string;
}

export async function findParticipant(
  db: Db,
  competitionId: string,
  userId: string
): Promise<ParticipantRow | null> {
  return db.one<ParticipantRow>(
    `select * from participants where competition_id = $1 and user_id = $2`,
    [competitionId, userId]
  );
}

export async function mustFindParticipant(
  db: Db,
  competitionId: string,
  userId: string
): Promise<ParticipantRow> {
  const participant = await findParticipant(db, competitionId, userId);
  if (!participant) {
    throw new TxError('NOT_ENROLLED', 'You are not enrolled in this competition', 403);
  }
  return participant;
}

export async function participantProblemState(
  db: Db,
  participantId: string,
  competitionProblemId: string
): Promise<{ id: string; state: string }> {
  const row = await db.must<{ id: string; state: string }>(
    `select id, state from participant_problem_states
      where participant_id = $1 and competition_problem_id = $2`,
    [participantId, competitionProblemId]
  );
  return row;
}

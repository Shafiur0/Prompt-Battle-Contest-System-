import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {AppController} from '../controller';
import {overallRanking,projectOverallRanking,isSampleRankingCompetition,type OverallCompetitionSource,type OverallParticipantSource} from '../overall-ranking';

const problem=(id:string,status='REVEALED',title='Problem '+id):OverallCompetitionSource=>({id,title,status,problem_title:'Task '+id});
function member(user:string,competition='A',points:string|number='10'):OverallParticipantSource {
 return {competition_id:competition,user_id:user,alias:user,workspace_state:'FINALIZED',moderation_status:'ACTIVE',selection_id:'selection-'+user+'-'+competition,status:'FINALIZED',score_decision_id:'current',effective_decision_id:'current',score:{eligible:true,finalScore:Number(points),finalScoreExact:String(points),correctness:1,critical:1}};
}

test('overall points aggregate all included problems and show not-joined and unscored membership',()=>{
 const a=member('Alice','A','42'),b=member('Alice','B','50'),pending=member('Bob','C','99');
 const board=projectOverallRanking([problem('A'),problem('B'),problem('C','GENERATION_OPEN')],[a,b,pending]);
 assert.equal(board.scope,'ALL_PROBLEMS');assert.equal(board.scoring,'TOTAL_POINTS');
 assert.equal(board.totalProblems,3);assert.equal(board.publishedProblems,2);assert.equal(board.totalParticipants,2);assert.equal(board.rankedParticipants,1);
 const alice=board.rows.find(r=>r.userId==='Alice')!,bob=board.rows.find(r=>r.userId==='Bob')!;
 assert.equal(alice.rank,1);assert.equal(alice.totalPoints,92);assert.equal(alice.totalPointsExact,'92');assert.equal(alice.joinedProblems,2);assert.equal(alice.scoredProblems,2);assert.equal(alice.solvedProblems,2);
 assert.deepEqual(alice.problems.map(p=>p.status),['SCORED','SCORED','NOT_JOINED']);
 assert.equal(bob.rank,null);assert.equal(bob.totalPoints,0);assert.equal(bob.totalPointsExact,'0');assert.equal(bob.joinedProblems,1);assert.equal(bob.scoredProblems,0);
 assert.deepEqual(bob.problems.map(p=>p.status),['NOT_JOINED','NOT_JOINED','PENDING']);
});

test('unpublished scores and correctness cannot affect public totals ranks or solved counts',()=>{
 const hidden=member('hidden','A','98.7654321');
 hidden.score={...hidden.score,privateReason:'SECRET SCORE EVIDENCE'} as any;
 for(const status of ['GENERATION_OPEN','CLOSED']){
  const board=projectOverallRanking([problem('A',status)],[hidden]);
  const row=board.rows[0];assert.equal(row.rank,null);assert.equal(row.totalPoints,0);assert.equal(row.scoredProblems,0);assert.equal(row.solvedProblems,0);assert.equal(row.problems[0].score,null);assert.equal(row.problems[0].status,'PENDING');
  assert.ok(!JSON.stringify(board).includes('98.7654321'));assert.ok(!JSON.stringify(board).includes('SECRET SCORE EVIDENCE'));
 }
 assert.equal(hidden.score!.finalScoreExact,'98.7654321');
});

test('superseded decisions and unfinished evaluations keep their points pending',()=>{
 const stale={...member('stale'),effective_decision_id:'successor'},unfinished={...member('unfinished'),status:'PROCESSING'};
 const board=projectOverallRanking([problem('A')],[stale,unfinished,member('current')]);
 assert.equal(board.rankedParticipants,1);
 for(const alias of ['stale','unfinished']){const row=board.rows.find(r=>r.alias===alias)!;assert.equal(row.rank,null);assert.equal(row.totalPoints,0);assert.equal(row.problems[0].status,'PENDING');}
});

test('banned and ineligible results are listed but contribute no points',()=>{
 const banned={...member('banned','A','100'),moderation_status:'BANNED'},ineligible=member('ineligible','A','100');ineligible.score!.eligible=false;
 const partial=member('partial','A','8');partial.score!.correctness=.5;
 const board=projectOverallRanking([problem('A')],[banned,ineligible,partial]);
 assert.equal(board.rankedParticipants,1);assert.equal(board.rows.find(r=>r.alias==='partial')!.solvedProblems,0);
 for(const [alias,status] of [['banned','BANNED'],['ineligible','INELIGIBLE']]){const row=board.rows.find(r=>r.alias===alias)!;assert.equal(row.rank,null);assert.equal(row.totalPoints,0);assert.equal(row.problems[0].score,null);assert.equal(row.problems[0].status,status);}
});

test('zero and negative valid scores remain ranked and pending zero totals do not outrank them',()=>{
 const sources=[member('negative','A','-1.25'),member('negative','B','0.5'),member('zero','A','0'),member('pending','C','100')];
 const board=projectOverallRanking([problem('A'),problem('B'),problem('C','GENERATION_OPEN')],sources);
 assert.deepEqual(board.rows.map(r=>[r.alias,r.totalPointsExact,r.rank]),[['zero','0',1],['negative','-0.75',2],['pending','0',null]]);
});

test('decimal sums are exact and equal totals share rank without a per-problem tie breaker',()=>{
 const sources=[member('Alice','A','0.100000000000'),member('Alice','B','0.200000000000'),member('Bob','A','0.300000000000'),member('Chris','A','0.299999999999')];
 sources[0].score!.finalScore=.10000000000000002;
 const board=projectOverallRanking([problem('A'),problem('B')],sources);
 assert.deepEqual(board.rows.map(r=>r.totalPointsExact),['0.3','0.3','0.299999999999']);assert.deepEqual(board.rows.map(r=>r.rank),[1,1,3]);
 assert.equal(board.rows[0].scoredProblems,2);assert.equal(board.rows[1].scoredProblems,1);
});

test('precision beyond display numbers still determines rank correctly',()=>{
 const board=projectOverallRanking([problem('A')],[member('lower','A','80'),member('higher','A','80.00000000000000000001')]);
 assert.equal(board.rows[0].alias,'higher');assert.equal(board.rows[0].totalPoints,80);assert.equal(board.rows[1].totalPoints,80);assert.deepEqual(board.rows.map(r=>r.rank),[1,2]);
 assert.equal(board.rows[0].totalPointsExact,'80.00000000000000000001');
});

test('identity grouping uses user IDs even when aliases match across separate accounts',()=>{
 const first=member('user-one','A','10'),second=member('user-one','B','20'),other=member('user-two','A','30');
 first.alias=second.alias=other.alias='participant1';
 const board=projectOverallRanking([problem('A'),problem('B')],[first,second,other]);
 assert.equal(board.totalParticipants,2);assert.deepEqual(board.rows.map(r=>r.userId),['user-one','user-two']);assert.deepEqual(board.rows.map(r=>r.rank),[1,1]);assert.deepEqual(board.rows.map(r=>r.totalPointsExact),['30','30']);
});

test('no submission is distinct from pending evaluation and no participation',()=>{
 const absent={...member('absent'),selection_id:null,workspace_state:'NO_SUBMISSION'},pending={...member('pending'),score:null};
 const board=projectOverallRanking([problem('A'),problem('B')],[absent,pending]);
 assert.deepEqual(board.rows.find(r=>r.alias==='absent')!.problems.map(p=>p.status),['NO_SUBMISSION','NOT_JOINED']);
 assert.equal(board.rows.find(r=>r.alias==='pending')!.problems[0].status,'PENDING');
 assert.equal(board.rankedParticipants,0);
});

test('legacy finite numeric scores work but malformed exact values never fall back to rounded points',()=>{
 const legacy=member('legacy','A','12.5');delete legacy.score!.finalScoreExact;
 const invalid=member('invalid','A','99');invalid.score!.finalScoreExact='not-a-decimal';
 const board=projectOverallRanking([problem('A')],[legacy,invalid]);
 assert.equal(board.rows.find(r=>r.alias==='legacy')!.totalPointsExact,'12.5');assert.equal(board.rows.find(r=>r.alias==='invalid')!.problems[0].status,'INELIGIBLE');assert.equal(board.rows.find(r=>r.alias==='invalid')!.totalPoints,0);
 const exponent=projectOverallRanking([problem('A')],[member('small','A','1e-7')]);assert.equal(exponent.rows[0].totalPointsExact,'0.0000001');
});

test('drafts always stay private and samples are included only when explicitly requested',()=>{
 assert.equal(isSampleRankingCompetition('  SYSTEM   TEST · Example '),true);assert.equal(isSampleRankingCompetition('SYSTEM TESTING challenge'),false);
 const competitions=[problem('real'),problem('sample','CALIBRATION_REVEALED','SYSTEM TEST · Demo'),problem('named','REVEALED',' Supply Allocation · Local Calibration '),problem('draft','DRAFT','Unpublished private task')];
 const members=[member('real-user','real'),member('sample-user','sample'),member('named-user','named'),member('draft-user','draft')];
 const normal=projectOverallRanking(competitions,members);assert.equal(normal.includeSamples,false);assert.equal(normal.totalProblems,1);assert.deepEqual(normal.rows.map(r=>r.alias),['real-user']);
 const samples=projectOverallRanking(competitions,members,true);assert.equal(samples.totalProblems,3);assert.equal(samples.totalParticipants,3);assert.ok(!JSON.stringify(samples).includes('Unpublished private task'));assert.ok(!JSON.stringify(samples).includes('draft-user'));
});

test('public controller accepts only optional true or false for includeSamples',()=>{
 const battle={overallLeaderboard:(includeSamples:boolean)=>({includeSamples})};
 const controller=new AppController(null as any,battle as any,null as any,null as any,null as any);
 assert.deepEqual(controller.overallLeaderboard(undefined),{includeSamples:false});assert.deepEqual(controller.overallLeaderboard('false'),{includeSamples:false});assert.deepEqual(controller.overallLeaderboard('true'),{includeSamples:true});
 for(const value of ['1','TRUE','',true,['true','false'],null])assert.throws(()=>controller.overallLeaderboard(value));
});

test('PostgreSQL projection seals hidden and stale scores and applies membership and sample filters',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const database=new Pool({connectionString:process.env.TEST_DATABASE_URL}),client=await database.connect();
 const ids={public:randomUUID(),hidden:randomUUID(),sample:randomUUID(),draft:randomUUID(),user:randomUUID(),sampleOnly:randomUUID(),absent:randomUUID(),stale:randomUUID(),banned:randomUUID(),ineligible:randomUUID()};
 try{
  await client.query('BEGIN');await client.query('SET LOCAL search_path=pg_temp');
  await client.query(`CREATE TEMP TABLE competitions(id uuid,title text,status text,problem jsonb,created_at timestamptz DEFAULT clock_timestamp()) ON COMMIT DROP;
  CREATE TEMP TABLE users(id uuid,alias text) ON COMMIT DROP;
  CREATE TEMP TABLE participants(id uuid,competition_id uuid,user_id uuid,workspace_state text,moderation_status text,created_at timestamptz DEFAULT clock_timestamp()) ON COMMIT DROP;
  CREATE TEMP TABLE final_selections(id uuid,competition_id uuid,participant_id uuid) ON COMMIT DROP;
  CREATE TEMP TABLE submission_states(selection_id uuid,status text,effective_decision_id uuid,published_score_id uuid) ON COMMIT DROP;
  CREATE TEMP TABLE score_revisions(id uuid,decision_id uuid,score jsonb) ON COMMIT DROP;`);
  for(const [id,title,status] of [[ids.public,'Public challenge','REVEALED'],[ids.hidden,'Open challenge','GENERATION_OPEN'],[ids.sample,'SYSTEM TEST · Example','CALIBRATION_REVEALED'],[ids.draft,'Private draft','DRAFT']])await client.query('INSERT INTO competitions(id,title,status,problem) VALUES($1,$2,$3,$4)',[id,title,status,JSON.stringify({title:title+' task'})]);
  for(const [id,alias] of [[ids.user,'participant1'],[ids.sampleOnly,'sample-only'],[ids.absent,'no-answer'],[ids.stale,'stale'],[ids.banned,'banned'],[ids.ineligible,'ineligible']])await client.query('INSERT INTO users VALUES($1,$2)',[id,alias]);
  async function add(user:string,competition:string,score:number|null,options:{banned?:boolean;stale?:boolean;eligible?:boolean}={}){
   const participant=randomUUID();await client.query('INSERT INTO participants(id,competition_id,user_id,workspace_state,moderation_status) VALUES($1,$2,$3,$4,$5)',[participant,competition,user,score===null?'NO_SUBMISSION':'FINALIZED',options.banned?'BANNED':'ACTIVE']);
   if(score===null)return;
   const selection=randomUUID(),scoreId=randomUUID(),decision=randomUUID();
   await client.query('INSERT INTO final_selections VALUES($1,$2,$3)',[selection,competition,participant]);
   await client.query('INSERT INTO submission_states VALUES($1,$2,$3,$4)',[selection,'FINALIZED',options.stale?randomUUID():decision,scoreId]);
   await client.query('INSERT INTO score_revisions VALUES($1,$2,$3)',[scoreId,decision,JSON.stringify({eligible:options.eligible!==false,finalScore:score,finalScoreExact:String(score),correctness:1,critical:1,privateReason:'PRIVATE EVALUATION EVIDENCE'})]);
  }
  await add(ids.user,ids.public,96);await add(ids.user,ids.hidden,99);await add(ids.user,ids.sample,90);await add(ids.user,ids.draft,100);
  await add(ids.sampleOnly,ids.sample,70);await add(ids.absent,ids.public,null);await add(ids.stale,ids.public,97,{stale:true});await add(ids.banned,ids.public,98,{banned:true});await add(ids.ineligible,ids.public,95,{eligible:false});
  const normal=await overallRanking(false,client);assert.equal(normal.totalProblems,2);assert.equal(normal.publishedProblems,1);assert.equal(normal.totalParticipants,5);assert.equal(normal.rankedParticipants,1);
  const participant=normal.rows.find(r=>r.userId===ids.user)!;assert.equal(participant.totalPointsExact,'96');assert.equal(participant.joinedProblems,2);assert.deepEqual(participant.problems.map(p=>p.status),['SCORED','PENDING']);
  assert.equal(normal.rows.find(r=>r.userId===ids.stale)!.problems[0].status,'PENDING');assert.equal(normal.rows.find(r=>r.userId===ids.banned)!.problems[0].status,'BANNED');assert.equal(normal.rows.find(r=>r.userId===ids.ineligible)!.problems[0].status,'INELIGIBLE');assert.equal(normal.rows.find(r=>r.userId===ids.absent)!.problems[0].status,'NO_SUBMISSION');
  assert.ok(!JSON.stringify(normal).includes('PRIVATE EVALUATION EVIDENCE'));assert.ok(!JSON.stringify(normal).includes('sample-only'));assert.ok(!JSON.stringify(normal).includes('Private draft'));
  const samples=await overallRanking(true,client);assert.equal(samples.totalProblems,3);assert.equal(samples.totalParticipants,6);assert.equal(samples.rows.find(r=>r.userId===ids.user)!.totalPointsExact,'186');assert.equal(samples.rows.find(r=>r.userId===ids.sampleOnly)!.totalPointsExact,'70');
 }finally{await client.query('ROLLBACK');client.release();await database.end();}
});

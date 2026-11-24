import { Controller,Get,Post,Delete,Body,Param,Query,Req,Res,Headers,Inject } from '@nestjs/common';
import type { Request,Response } from 'express';
import { z } from 'zod';
import { AuthService } from './auth';
import { BattleService } from './service';
import { OrganizerService } from './organizer';
import { ProblemEditorService } from './problem-editor';
import { AdminControlsService } from './admin-controls';
import { parse,uuid,idempotencyKey,promptSchema,enrollSchema,selectionSchema,scheduleSchema,decisionSchema,appealSchema,registrySchema } from './guards';
@Controller()
export class AppController {
 constructor(@Inject(AuthService) private readonly auth:AuthService,@Inject(BattleService) private readonly battle:BattleService,@Inject(OrganizerService) private readonly organizer:OrganizerService,@Inject(ProblemEditorService) private readonly problemEditor:ProblemEditorService,@Inject(AdminControlsService) private readonly controls:AdminControlsService){}
 @Get('health') health(){return this.battle.health();}
 @Get('session') async session(@Req() req:Request){const u=await this.auth.user(req);return {authenticated:!!u,user:u?{id:u.id,alias:u.alias}:null,roles:u?[u.isOrganizer?'organizer':'participant']:[]};}
 @Get('auth/login') login(@Res() res:Response){return this.auth.login(res);}
 @Get('auth/callback') callback(@Req() req:Request,@Res() res:Response){return this.auth.callback(req,res);}
 @Post('auth/logout') logout(@Req() req:Request,@Res() res:Response){return this.auth.logout(req,res);}
 @Get('competitions') async competitions(@Req() req:Request){return this.battle.list(await this.auth.user(req));}
 @Get('competitions/:id') async competition(@Param('id') id:string,@Req() req:Request){return this.battle.competition(uuid(id),await this.auth.user(req));}
 @Post('competitions/:id/enroll') async enroll(@Param('id') id:string,@Req() req:Request,@Body() body:unknown){this.auth.assertOrigin(req);return this.battle.enroll(uuid(id),await this.auth.requireUser(req),parse(enrollSchema,body));}
 @Get('competitions/:id/token-account') async account(@Param('id') id:string,@Req() req:Request){return this.battle.account(uuid(id),await this.auth.requireUser(req));}
 @Get('competitions/:id/attempts') async attempts(@Param('id') id:string,@Req() req:Request){return this.battle.attempts(uuid(id),await this.auth.requireUser(req));}
 @Get('attempts/:id') async attempt(@Param('id') id:string,@Req() req:Request){return this.battle.attempt(uuid(id),await this.auth.requireUser(req));}
 @Post('competitions/:id/attempts') async generate(@Param('id') id:string,@Req() req:Request,@Body() body:unknown,@Headers('idempotency-key') key:unknown){this.auth.assertOrigin(req);return this.battle.createAttempt(uuid(id),await this.auth.requireUser(req),parse(promptSchema,body),idempotencyKey(key));}
 @Post('competitions/:id/final-selections') async select(@Param('id') id:string,@Req() req:Request,@Body() body:unknown,@Headers('idempotency-key') key:unknown){this.auth.assertOrigin(req);return this.battle.select(uuid(id),await this.auth.requireUser(req),parse(selectionSchema,body),idempotencyKey(key));}
 @Get('submissions/:id') async submission(@Param('id') id:string,@Req() req:Request){return this.battle.submission(uuid(id),await this.auth.requireUser(req));}
 @Get('competitions/:id/leaderboard') leaderboard(@Param('id') id:string){return this.battle.leaderboard(uuid(id));}
 @Get('leaderboard') overallLeaderboard(@Query('includeSamples') includeSamples:unknown){return this.battle.overallLeaderboard(parse(z.enum(['true','false']).optional(),includeSamples)==='true');}
 @Post('submissions/:id/appeals') async appeal(@Param('id') id:string,@Req() req:Request,@Body() body:unknown,@Headers('idempotency-key') key:unknown){this.auth.assertOrigin(req);return this.battle.appeal(uuid(id),await this.auth.requireUser(req),parse(appealSchema,body).reason,idempotencyKey(key));}
 @Post('organizer/competitions') async create(@Req() req:Request,@Body() body:unknown){this.auth.assertOrigin(req);const value=parse(z.object({title:z.string().trim().min(1).max(120)}).strict(),body);return this.organizer.create(await this.auth.requireOrganizer(req),value.title);}
 @Get('organizer/competitions/:id') async dashboard(@Param('id') id:string,@Req() req:Request){return this.organizer.dashboard(uuid(id),await this.auth.requireOrganizer(req));}
 @Post('organizer/competitions/:id/start') async start(@Param('id') id:string,@Req() req:Request,@Body() body:unknown){this.auth.assertOrigin(req);parse(z.object({}).strict(),body);return this.organizer.start(uuid(id),await this.auth.requireOrganizer(req));}
 @Get('organizer/competitions/:id/problem') async problem(@Param('id') id:string,@Req() req:Request){return this.problemEditor.get(uuid(id),await this.auth.requireOrganizer(req));}
 @Post('organizer/competitions/:id/problem') async saveProblem(@Param('id') id:string,@Req() req:Request,@Body() body:unknown){this.auth.assertOrigin(req);return this.problemEditor.save(uuid(id),await this.auth.requireOrganizer(req),body);}
 @Delete('organizer/competitions/:id/problem') async removeProblem(@Param('id') id:string,@Req() req:Request){this.auth.assertOrigin(req);return this.controls.removeProblem(uuid(id),await this.auth.requireOrganizer(req));}
 @Get('competitions/:id/announcements') async announcements(@Param('id') id:string,@Req() req:Request){return this.controls.announcements(uuid(id),await this.auth.requireUser(req));}
 @Get('organizer/competitions/:id/announcements') async ownerAnnouncements(@Param('id') id:string,@Req() req:Request){return this.controls.announcements(uuid(id),await this.auth.requireOrganizer(req),true);}
 @Post('organizer/competitions/:id/announcements') async postAnnouncement(@Param('id') id:string,@Req() req:Request,@Body() body:unknown){this.auth.assertOrigin(req);const v=parse(z.object({message:z.string().trim().min(1).max(2000)}).strict(),body);return this.controls.postAnnouncement(uuid(id),await this.auth.requireOrganizer(req),v.message);}
 @Delete('organizer/competitions/:id/announcements/:announcementId') async withdrawAnnouncement(@Param('id') id:string,@Param('announcementId') aid:string,@Req() req:Request){this.auth.assertOrigin(req);return this.controls.withdrawAnnouncement(uuid(id),uuid(aid),await this.auth.requireOrganizer(req));}
 @Get('organizer/competitions/:id/participants/:participantId') async participantDetail(@Param('id') id:string,@Param('participantId') pid:string,@Req() req:Request){return this.controls.participant(uuid(id),uuid(pid),await this.auth.requireOrganizer(req));}
 @Post('organizer/competitions/:id/participants/:participantId/ban') async ban(@Param('id') id:string,@Param('participantId') pid:string,@Req() req:Request,@Body() body:unknown){this.auth.assertOrigin(req);const v=parse(z.object({reason:z.string().trim().min(1).max(4000),publicNotice:z.string().trim().max(2000).default(''),confirmedFinding:z.string().trim().min(8).max(4000)}).strict(),body);return this.controls.moderate(uuid(id),uuid(pid),await this.auth.requireOrganizer(req),'BAN',v);}
 @Post('organizer/competitions/:id/participants/:participantId/unban') async unban(@Param('id') id:string,@Param('participantId') pid:string,@Req() req:Request,@Body() body:unknown){this.auth.assertOrigin(req);const v=parse(z.object({reason:z.string().trim().min(1).max(4000),publicNotice:z.string().trim().max(2000).default('')}).strict(),body);return this.controls.moderate(uuid(id),uuid(pid),await this.auth.requireOrganizer(req),'UNBAN',v);}
 @Post('organizer/competitions/:id/schedule') async schedule(@Param('id') id:string,@Req() req:Request,@Body() body:unknown){this.auth.assertOrigin(req);return this.organizer.schedule(uuid(id),await this.auth.requireOrganizer(req),parse(scheduleSchema,body));}
 @Post('organizer/competitions/:id/critical-registry/versions') async registry(@Param('id') id:string,@Req() req:Request,@Body() body:unknown){this.auth.assertOrigin(req);return this.organizer.registry(uuid(id),await this.auth.requireOrganizer(req),parse(registrySchema,body).items);}
 @Post('organizer/competitions/:id/close') async close(@Param('id') id:string,@Req() req:Request,@Body() body:unknown){this.auth.assertOrigin(req);parse(z.object({}).strict(),body);return this.organizer.close(uuid(id),await this.auth.requireOrganizer(req));}
 @Post('organizer/submissions/:id/reviews') async review(@Param('id') id:string,@Req() req:Request,@Body() body:unknown,@Headers('idempotency-key') key:unknown){this.auth.assertOrigin(req);return this.organizer.decision(uuid(id),await this.auth.requireOrganizer(req),parse(decisionSchema,body),idempotencyKey(key));}
 @Post('organizer/submissions/:id/quality-review') async qualityReview(@Param('id') id:string,@Req() req:Request,@Body() body:unknown){this.auth.assertOrigin(req);const value=parse(z.object({scores:z.object({clarity:z.number().int().min(0).max(4),justification:z.number().int().min(0).max(4),concision:z.number().int().min(0).max(4)}).strict(),reason:z.string().min(1).max(4000)}).strict(),body);return this.organizer.qualityReview(uuid(id),await this.auth.requireOrganizer(req),value.scores,value.reason);}
 @Post('organizer/competitions/:id/reveal') async reveal(@Param('id') id:string,@Req() req:Request,@Body() body:unknown){this.auth.assertOrigin(req);parse(z.object({}).strict(),body);return this.organizer.reveal(uuid(id),await this.auth.requireOrganizer(req));}
}

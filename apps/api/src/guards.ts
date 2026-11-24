import { HttpException } from '@nestjs/common';
import { z } from 'zod';
export function fail(status:number,message:string):never{throw new HttpException(message,status);}
export function parse<T>(schema:z.ZodType<T>,value:unknown):T{const r=schema.safeParse(value);if(!r.success)fail(400,'The request contains missing, invalid or unsupported fields.');return r.data;}
export function uuid(v:string){return parse(z.string().uuid(),v);}
export function idempotencyKey(v:unknown):string{if(typeof v!=='string'||v.length<8||v.length>128)fail(400,'Provide an Idempotency-Key.');return v;}
export const promptSchema=z.object({prompt:z.string().min(1).max(64000),parentAttemptId:z.string().uuid().optional()}).strict();
export const enrollSchema=z.object({invitationCode:z.string().max(100).optional(),rulesVersionId:z.string().uuid().optional()}).strict();
export const selectionSchema=z.object({attemptId:z.string().uuid()}).strict();
export const scheduleSchema=z.object({generationCutoff:z.string().datetime(),selectionCutoff:z.string().datetime(),revealAt:z.string().datetime()}).strict();
export const decisionSchema=z.object({verdict:z.enum(['NO_VIOLATION','CONFIRMED_VIOLATION','INSUFFICIENT_EVIDENCE']),reason:z.string().min(1).max(4000),ruleId:z.string().max(100).optional(),severity:z.enum(['NONE','MINOR','MATERIAL']).optional(),appealId:z.string().uuid().optional()}).strict();
export const appealSchema=z.object({reason:z.string().min(1).max(4000)}).strict();
export const registrySchema=z.object({items:z.array(z.object({id:z.string().uuid(),category:z.enum(['PROTECTED_CRITICAL_INFORMATION','ALLOWED_PUBLIC_INFORMATION','REQUIRED_INFORMATION','PRIVATE_EVALUATION_CRITERIA']),text:z.string().max(131072).optional(),explanation:z.string().max(4000).optional(),publicRuleId:z.string().max(100).optional(),severity:z.enum(['NONE','MINOR','MATERIAL']).optional(),sourceStartByte:z.number().int().min(0).optional(),sourceEndByte:z.number().int().min(0).optional()}).strict()).max(1000)}).strict();

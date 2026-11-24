import 'reflect-metadata';
import { Module,ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AuthService } from './auth';
import { BattleService } from './service';
import { OrganizerService } from './organizer';
import { ProblemEditorService } from './problem-editor';
import { AdminControlsService } from './admin-controls';
import { AppController } from './controller';
import { config } from './config';
@Module({controllers:[AppController],providers:[AuthService,BattleService,OrganizerService,ProblemEditorService,AdminControlsService]})
class AppModule {}
async function main(){
 const app=await NestFactory.create(AppModule,{logger:['error','warn','log']});
 app.setGlobalPrefix('api/v1');app.use(cookieParser());
 // The local reverse proxy otherwise retains idle sockets across the refresh interval.
 app.use((req:any,res:any,next:any)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Connection','close');next();});
 await app.listen(config.port,'127.0.0.1');
 console.log('Prompt Battle API ready on localhost:'+config.port+'.');
}
main().catch(()=>{console.error('API startup failed; inspect local service configuration.');process.exitCode=1;});

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { db } from "../db/database.js";
import { getAuth, requireAuth, requireRole } from "../middleware/auth.js";
import { HttpError } from "../utils/http-error.js";

export const encounterRouter=Router();
const uploadRoot=fileURLToPath(new URL("../../../../data/uploads/",import.meta.url));
const statusName=(id:number)=>({1:"ACTIVE",2:"INACTIVE",3:"CONFIRMED",4:"CANCELLED",5:"RESCHEDULED",6:"WAITING",7:"IN_PROGRESS",8:"PAID"} as Record<number,string>)[id]??"WAITING";
function appointment(id:number,clinicId:number){const row=db.prepare(`SELECT a.id,a.paciente_id AS patientId,a.terapeuta_id AS therapistId,a.terapia_id AS therapyId,
 a.dt_inicio AS startsAt,a.dt_fim AS endsAt,a.status,t.nome AS therapyName,pu.nome AS patientName,tu.nome AS therapistName
 FROM AGENDA a JOIN PACIENTE p ON p.id=a.paciente_id JOIN USUARIO pu ON pu.id=p.usuario_id
 JOIN TERAPEUTA tr ON tr.id=a.terapeuta_id JOIN USUARIO tu ON tu.id=tr.usuario_id JOIN TERAPIA t ON t.id=a.terapia_id
 WHERE a.id=? AND p.clinica_id=?`).get(id,clinicId) as Record<string,any>|undefined;
 if(!row)throw new HttpError(404,"ENCOUNTER_NOT_FOUND","Atendimento não encontrado nesta clínica.");return row;}
function guard(row:Record<string,any>,auth:ReturnType<typeof getAuth>){
 if(auth.role==="PATIENT" && Number(db.prepare("SELECT id FROM PACIENTE WHERE usuario_id=?").pluck().get(Number(auth.userId)))!==row.patientId) throw new HttpError(403,"FORBIDDEN","Você só pode consultar seu próprio atendimento.");
 if(auth.role==="THERAPIST" && Number(db.prepare("SELECT id FROM TERAPEUTA WHERE usuario_id=?").pluck().get(Number(auth.userId)))!==row.therapistId) throw new HttpError(403,"FORBIDDEN","Você só pode consultar seus atendimentos.");
}
function getAttendance(row:Record<string,any>){return db.prepare("SELECT * FROM ATENDIMENTO WHERE paciente_id=? AND terapeuta_id=? AND terapia_id=? AND dt_atend=? ORDER BY id DESC LIMIT 1").get(row.patientId,row.therapistId,row.therapyId,row.startsAt) as Record<string,any>|undefined;}
function details(row:Record<string,any>,clinicId:number){
 const attendance=getAttendance(row);
 if(attendance&&Number(attendance.status)===7&&!attendance.dt_inicio_real){const firstClinicalEntry=db.prepare("SELECT MIN(dt_registro) FROM ANAMNESE WHERE atendimento_id=?").pluck().get(attendance.id) as string|null;attendance.dt_inicio_real=firstClinicalEntry||new Date().toISOString();db.prepare("UPDATE ATENDIMENTO SET dt_inicio_real=? WHERE id=? AND dt_inicio_real IS NULL").run(attendance.dt_inicio_real,attendance.id);}
 const base={id:String(row.id),patientId:String(row.patientId),therapistId:String(row.therapistId),therapyId:String(row.therapyId),startsAt:row.startsAt,endsAt:row.endsAt,appointmentStatus:statusName(row.status),therapyName:row.therapyName,patientName:row.patientName,therapistName:row.therapistName};
 const questions=db.prepare("SELECT id,descricao AS description FROM PERGUNTAS ORDER BY id").all() as Array<{id:number;description:string}>;
 if(!attendance)return {appointment:{...base},attendance:null,questions,anamneses:[],diagnoses:[],protocolCatalog:[],protocols:[],protocolOptions:protocolOptions(row.therapyId,clinicId),evolutions:[],attachments:[]};
 const anamneses=db.prepare("SELECT id,descricao AS description,dt_registro AS registeredAt FROM ANAMNESE WHERE atendimento_id=? ORDER BY id").all(attendance.id) as Array<Record<string,any>>;
 const answerQuery=db.prepare(`SELECT ap.pergunta_id AS questionId,q.descricao AS question,ap.Resposta AS answer FROM ANAMNESE_PERGUNTAS ap JOIN PERGUNTAS q ON q.id=ap.pergunta_id WHERE ap.anamnese_id=?`);
 const diagnoses=db.prepare("SELECT id,descricao AS description,dt_diagnostico AS diagnosedAt FROM DIAGNOSTICO WHERE paciente_id=? AND terapeuta_id=? ORDER BY dt_diagnostico IS NULL,dt_diagnostico DESC,id DESC").all(row.patientId,row.therapistId) as Array<Record<string,any>>;
 // Protocols are tied directly to their diagnosis; materialize missing stage links so they are immediately available for evolutions.
 db.prepare(`INSERT INTO DIAGNOSTICO_PROTOCOLO(diagnostico_id,protocolo_etapa_id,dt_diagnostico,status)
  SELECT d.id,st.id,date('now'),CASE WHEN st.sequencia=(SELECT MIN(firstStage.sequencia) FROM PROTOCOLO_ETAPA firstStage WHERE firstStage.protocolo_id=p.id AND firstStage.terapia_id=?) THEN 7 ELSE 6 END
  FROM PROTOCOLO p JOIN DIAGNOSTICO d ON d.id=p.diagnostico_id JOIN PROTOCOLO_ETAPA st ON st.protocolo_id=p.id AND st.terapia_id=?
  WHERE d.paciente_id=? AND d.terapeuta_id=? AND p.terapeuta_id=?
    AND NOT EXISTS(SELECT 1 FROM DIAGNOSTICO_PROTOCOLO existing WHERE existing.diagnostico_id=d.id AND existing.protocolo_etapa_id=st.id)`).run(row.therapyId,row.therapyId,row.patientId,row.therapistId,row.therapistId);
 const catalogRows=db.prepare(`SELECT p.id,p.nome AS name,p.Sintomas AS symptoms,p.objetivo AS objective,d.id AS diagnosisId,d.descricao AS diagnosisDescription,d.dt_diagnostico AS diagnosedAt,
  st.id AS stepId,st.sequencia AS sequence,st.dt_inicio AS startsAt,st.dt_fim AS endsAt,st.descricao AS stepDescription,st.obs AS notes
  FROM PROTOCOLO p JOIN DIAGNOSTICO d ON d.id=p.diagnostico_id LEFT JOIN PROTOCOLO_ETAPA st ON st.protocolo_id=p.id AND st.terapia_id=?
  WHERE d.paciente_id=? AND d.terapeuta_id=? ORDER BY d.dt_diagnostico IS NULL,d.dt_diagnostico DESC,d.id DESC,p.id DESC,st.sequencia`).all(row.therapyId,row.patientId,row.therapistId) as Array<Record<string,any>>;
 const catalogMap=new Map<number,Record<string,any>>();for(const entry of catalogRows){let item=catalogMap.get(Number(entry.id));if(!item){item={id:String(entry.id),name:entry.name,symptoms:entry.symptoms,objective:entry.objective,diagnosisId:String(entry.diagnosisId),diagnosisDescription:entry.diagnosisDescription,diagnosedAt:entry.diagnosedAt,steps:[]};catalogMap.set(Number(entry.id),item);}if(entry.stepId!==null)item.steps.push({id:String(entry.stepId),sequence:entry.sequence,startsAt:entry.startsAt,endsAt:entry.endsAt,description:entry.stepDescription,notes:entry.notes});}
 const protocols=db.prepare(`SELECT dp.id AS diagnosisProtocolId,d.id AS diagnosisId,d.descricao AS diagnosisDescription,
  d.dt_diagnostico AS diagnosedAt,
  p.id AS protocolId,p.nome AS protocolName,st.id AS stepId,st.sequencia AS sequence,st.descricao AS stepDescription,
  st.dt_inicio AS startsAt,st.dt_fim AS endsAt,st.obs AS stepNotes,dp.dt_diagnostico AS startedAt,dp.status
  FROM DIAGNOSTICO_PROTOCOLO dp JOIN DIAGNOSTICO d ON d.id=dp.diagnostico_id
  JOIN PROTOCOLO_ETAPA st ON st.id=dp.protocolo_etapa_id JOIN PROTOCOLO p ON p.id=st.protocolo_id
  WHERE d.paciente_id=? AND d.terapeuta_id=? ORDER BY d.dt_diagnostico IS NULL,d.dt_diagnostico DESC,d.id DESC,p.nome,st.dt_inicio IS NULL,st.dt_inicio DESC,st.sequencia DESC`).all(row.patientId,row.therapistId) as Array<Record<string,any>>;
 const statusMap=(id:number)=>({1:"ACTIVE",2:"INACTIVE",3:"CONFIRMED",4:"CANCELLED",5:"RESCHEDULED",6:"WAITING",7:"IN_PROGRESS",8:"PAID"} as Record<number,string>)[id]??"WAITING";
 const evolutions=db.prepare(`SELECT e.id,e.diagnostico_protocolo_id AS diagnosisProtocolId,e.descricao AS description,e.dt_evolucao AS evolvedAt,e.status,
  d.descricao AS diagnosisDescription,p.nome AS protocolName,st.sequencia AS sequence,st.descricao AS stepDescription
  FROM EVOLUCAO e JOIN DIAGNOSTICO_PROTOCOLO dp ON dp.id=e.diagnostico_protocolo_id JOIN DIAGNOSTICO d ON d.id=dp.diagnostico_id
  JOIN PROTOCOLO_ETAPA st ON st.id=dp.protocolo_etapa_id JOIN PROTOCOLO p ON p.id=st.protocolo_id
  WHERE d.paciente_id=? AND d.terapeuta_id=? ORDER BY e.dt_evolucao DESC`).all(row.patientId,row.therapistId) as Array<Record<string,any>>;
 const feedbackRows=db.prepare(`SELECT f.id,f.protocolo_etapa_id AS stepId,f.dt_feedback AS feedbackAt,
  f.percepcao_melhora AS improvementPerception,f.sugestao AS suggestion,f.avaliacao_melhora AS improvementRating
  FROM FEEDBACK f JOIN PROTOCOLO_ETAPA st ON st.id=f.protocolo_etapa_id JOIN PROTOCOLO p ON p.id=st.protocolo_id
  JOIN DIAGNOSTICO d ON d.id=p.diagnostico_id WHERE d.paciente_id=? AND d.terapeuta_id=? ORDER BY f.id DESC`).all(row.patientId,row.therapistId) as Array<Record<string,any>>;
 const feedbackByStep=new Map<string,Record<string,any>>();for(const feedback of feedbackRows){const key=String(feedback.stepId);if(!feedbackByStep.has(key))feedbackByStep.set(key,{...feedback,id:String(feedback.id)});}
 const attachments=db.prepare("SELECT id,arquivo,descricao,dt_atualizacao FROM ANEXO WHERE atendimento_id=? ORDER BY id").all(attendance.id) as Array<{id:number;arquivo:string;descricao:string|null;dt_atualizacao:string|null}>;
 return {appointment:{...base},attendance:{id:String(attendance.id),chartId:String(db.prepare("SELECT id FROM PRONTUARIO WHERE atendimento_id=?").pluck().get(attendance.id)??""),attendedAt:attendance.dt_atend,status:statusName(Number(attendance.status)),notes:null,startedAt:attendance.dt_inicio_real??attendance.dt_atend,examRequested:Number(attendance.exames_solicitados??0)===1},questions,
  anamneses:anamneses.map(a=>({id:String(a.id),type:"Anamnese",description:a.description??"",registeredAt:a.registeredAt,answers:(answerQuery.all(a.id) as Array<Record<string,any>>).map(answer=>({...answer,questionId:String(answer.questionId),answer:answer.answer??""}))})),
  diagnoses:diagnoses.map(d=>({...d,id:String(d.id)})),protocolCatalog:[...catalogMap.values()],
  protocolOptions:protocolOptions(row.therapyId,clinicId),protocols:protocols.map(p=>({...p,diagnosisProtocolId:String(p.diagnosisProtocolId),diagnosisId:String(p.diagnosisId),protocolId:String(p.protocolId),stepId:String(p.stepId),status:statusMap(p.status),feedback:feedbackByStep.get(String(p.stepId))??null})),
  evolutions:evolutions.map(e=>({...e,id:String(e.id),diagnosisProtocolId:String(e.diagnosisProtocolId),status:statusMap(e.status),authorName:row.therapistName})),
  attachments:attachments.map(a=>{const meta=JSON.parse(a.arquivo) as {originalFilename:string;contentType:string;sizeBytes:number;type:"EXAM"|"TONGUE_PHOTO"};return {id:String(a.id),...meta,description:a.descricao,uploadedAt:a.dt_atualizacao,url:`/api/v1/encounters/attachments/${a.id}/download`};})};
}
function protocolOptions(therapyId:number,clinicId:number){
 const rows=db.prepare(`SELECT p.id,p.nome AS name,p.Sintomas AS description,p.objetivo AS objective,st.id AS stepId,st.sequencia AS sequence,st.dt_inicio AS startsAt,st.dt_fim AS endsAt,st.descricao AS stepDescription,st.obs AS notes
 FROM PROTOCOLO p JOIN PROTOCOLO_ETAPA st ON st.protocolo_id=p.id JOIN TERAPEUTA t ON t.id=p.terapeuta_id
 JOIN USUARIO_CLINICA uc ON uc.usuario_id=t.usuario_id AND uc.clinica_id=? AND uc.perfil_id=3 AND uc.status=1
 WHERE st.terapia_id=? ORDER BY p.id,st.sequencia`).all(clinicId,therapyId) as Array<Record<string,any>>;
 const map=new Map<number,Record<string,any>>();for(const r of rows){let item=map.get(r.id);if(!item){item={id:String(r.id),name:r.name,description:r.description,objective:r.objective,steps:[]};map.set(r.id,item);}item.steps.push({id:String(r.stepId),sequence:r.sequence,startsAt:r.startsAt,endsAt:r.endsAt,description:r.stepDescription,notes:r.notes});}return [...map.values()];
}

encounterRouter.get("/encounters",requireAuth,(request,response)=>{const auth=getAuth(request);const params=[Number(auth.clinicId)];let sql=`SELECT a.id,a.paciente_id AS patientId,a.terapeuta_id AS therapistId,a.terapia_id AS therapyId,a.dt_inicio AS startsAt,a.dt_fim AS endsAt,a.status,t.nome AS therapyName,pu.nome AS patientName,tu.nome AS therapistName FROM AGENDA a JOIN PACIENTE p ON p.id=a.paciente_id JOIN USUARIO pu ON pu.id=p.usuario_id JOIN TERAPEUTA tr ON tr.id=a.terapeuta_id JOIN USUARIO tu ON tu.id=tr.usuario_id JOIN TERAPIA t ON t.id=a.terapia_id WHERE p.clinica_id=?`;
 if(auth.role==="PATIENT"){sql+=" AND p.usuario_id=?";params.push(Number(auth.userId));}if(auth.role==="THERAPIST"){sql+=" AND tr.usuario_id=?";params.push(Number(auth.userId));}
 sql+=" ORDER BY a.dt_inicio DESC LIMIT 200";const rows=db.prepare(sql).all(...params) as Array<Record<string,any>>;response.json({encounters:rows.map(r=>{const att=getAttendance(r);return {appointmentId:String(r.id),encounterId:att?String(att.id):null,attendanceStatus:att?statusName(Number(att.status)):null,patientId:String(r.patientId),therapistId:String(r.therapistId),therapyId:String(r.therapyId),startsAt:r.startsAt,endsAt:r.endsAt,appointmentStatus:statusName(r.status),therapyName:r.therapyName,patientName:r.patientName,therapistName:r.therapistName};})});});
encounterRouter.get("/encounters/:appointmentId",requireAuth,(request,response,next)=>{try{const auth=getAuth(request);const row=appointment(z.coerce.number().positive().parse(request.params.appointmentId),Number(auth.clinicId));guard(row,auth);response.json(details(row,Number(auth.clinicId)));}catch(e){next(e);}});
encounterRouter.post("/encounters/:appointmentId/questions",requireAuth,requireRole("THERAPIST"),(request,response,next)=>{try{const input=z.object({description:z.string().trim().min(3).max(500)}).parse(request.body);const id=db.prepare("INSERT INTO PERGUNTAS(descricao) VALUES(?)").run(input.description).lastInsertRowid;response.status(201).json({question:{id:String(id),description:input.description}});}catch(e){next(e);}});
encounterRouter.post("/encounters/:appointmentId/attachments",requireAuth,async(request,response,next)=>{try{
 const auth=getAuth(request);const row=appointment(z.coerce.number().positive().parse(request.params.appointmentId),Number(auth.clinicId));guard(row,auth);const att=getAttendance(row);
 if(!att)throw new HttpError(409,"ATTENDANCE_NOT_STARTED","Inicie o atendimento antes de anexar arquivos.");
 if(auth.role==="PATIENT"&&Number(att.exames_solicitados??0)!==1)throw new HttpError(403,"EXAMS_NOT_REQUESTED","A terapeuta ainda não solicitou exames ou fotos para este atendimento.");
 const input=z.object({type:z.enum(["EXAM","TONGUE_PHOTO"]),originalFilename:z.string().min(1).max(240),contentType:z.enum(["application/pdf","image/jpeg","image/png"]),contentBase64:z.string().min(1),description:z.string().max(1000).optional()}).parse(request.body);
 const bytes=Buffer.from(input.contentBase64,"base64");if(bytes.length>10*1024*1024)throw new HttpError(413,"FILE_TOO_LARGE","O limite por arquivo é 10 MB.");
 const chart=db.prepare("SELECT id FROM PRONTUARIO WHERE atendimento_id=?").get(att.id) as {id:number}|undefined;if(!chart)throw new HttpError(409,"CHART_NOT_FOUND","Prontuário do atendimento não encontrado.");
 const key=`${auth.clinicId}/${att.id}/${randomUUID()}`;const fullPath=resolve(uploadRoot,key);if(!fullPath.startsWith(uploadRoot))throw new HttpError(400,"INVALID_FILE_PATH","Caminho de arquivo inválido.");
 await mkdir(dirname(fullPath),{recursive:true});await writeFile(fullPath,bytes,{flag:"wx"});
 const meta=JSON.stringify({storageKey:key,originalFilename:input.originalFilename,contentType:input.contentType,sizeBytes:bytes.length,type:input.type});
 const uploadedAt=new Date().toISOString();
 const id=db.prepare("INSERT INTO ANEXO(prontuario_id,atendimento_id,arquivo,descricao,dt_atualizacao) VALUES(?,?,?,?,?)").run(chart.id,att.id,meta,input.description??null,uploadedAt).lastInsertRowid;
 response.status(201).json({attachment:{id:String(id),type:input.type,originalFilename:input.originalFilename,contentType:input.contentType,sizeBytes:bytes.length,description:input.description??null,uploadedAt,url:`/api/v1/encounters/attachments/${id}/download`}});
 }catch(e){next(e);}});
encounterRouter.get("/encounters/attachments/:id/download",requireAuth,async(request,response,next)=>{try{
 const auth=getAuth(request);const id=z.coerce.number().positive().parse(request.params.id);const row=db.prepare(`SELECT a.arquivo,a.atendimento_id AS attendanceId,a.prontuario_id AS chartId,p.clinica_id AS clinicId,
  p.id AS patientId,t.id AS therapistId FROM ANEXO a JOIN ATENDIMENTO x ON x.id=a.atendimento_id JOIN PACIENTE p ON p.id=x.paciente_id JOIN TERAPEUTA t ON t.id=x.terapeuta_id WHERE a.id=?`).get(id) as Record<string,any>|undefined;
 if(!row||Number(row.clinicId)!==Number(auth.clinicId))throw new HttpError(404,"ATTACHMENT_NOT_FOUND","Arquivo não encontrado.");
 guard({patientId:row.patientId,therapistId:row.therapistId},auth);const metadata=JSON.parse(row.arquivo) as {originalFilename:string;contentType:string};
 const metaRaw=JSON.parse(row.arquivo) as Record<string,string>;const fileKey=metaRaw.storageKey;
 if(!fileKey)throw new HttpError(404,"FILE_NOT_FOUND","O arquivo não está mais disponível.");
 const filePath=resolve(uploadRoot,fileKey);if(!filePath.startsWith(uploadRoot))throw new HttpError(400,"INVALID_FILE_PATH","Caminho de arquivo inválido.");
 const content=await readFile(filePath);response.setHeader("Content-Type",metadata.contentType);response.setHeader("Content-Disposition",`inline; filename*=UTF-8''${encodeURIComponent(metadata.originalFilename)}`);response.send(content);
 }catch(e){next(e);}});
encounterRouter.post("/encounters/:appointmentId/start",requireAuth,requireRole("THERAPIST"),(request,response,next)=>{try{
 const auth=getAuth(request);const row=appointment(z.coerce.number().positive().parse(request.params.appointmentId),Number(auth.clinicId));guard(row,auth);let att=getAttendance(row);
 if(!att){
  const startedAt=new Date().toISOString();
  const create=db.transaction(()=>{const id=db.prepare("INSERT INTO ATENDIMENTO(paciente_id,terapeuta_id,terapia_id,dt_atend,status,dt_inicio_real) VALUES(?,?,?,?,7,?)").run(row.patientId,row.therapistId,row.therapyId,row.startsAt,startedAt).lastInsertRowid;db.prepare("INSERT INTO PRONTUARIO(paciente_id,atendimento_id,status) VALUES(?,?,1)").run(row.patientId,id);db.prepare("UPDATE AGENDA SET status=7 WHERE id=?").run(row.id);});create.immediate();att=getAttendance(row);
 }else if(Number(att.status)===1){
  const startedAt=new Date().toISOString();
  const start=db.transaction(()=>{db.prepare("UPDATE ATENDIMENTO SET status=7,dt_inicio_real=COALESCE(dt_inicio_real,?) WHERE id=? AND status=1").run(startedAt,att!.id);db.prepare("UPDATE AGENDA SET status=7 WHERE id=?").run(row.id);});start.immediate();att=getAttendance(row);
 }else if(Number(att.status)!==7){
  throw new HttpError(409,"ATTENDANCE_NOT_STARTABLE","Este atendimento nÃ£o estÃ¡ em um status que permita iniciÃ¡-lo.");
 }
 response.json({attendance:att,created:true});
}catch(e){next(e);}});
encounterRouter.post("/encounters/:appointmentId/exam-request",requireAuth,requireRole("THERAPIST"),(request,response,next)=>{try{
 const auth=getAuth(request);const row=appointment(z.coerce.number().positive().parse(request.params.appointmentId),Number(auth.clinicId));guard(row,auth);const att=getAttendance(row);
 if(!att)throw new HttpError(409,"ATTENDANCE_NOT_STARTED","Inicie o atendimento antes de solicitar arquivos.");
 db.prepare("UPDATE ATENDIMENTO SET exames_solicitados=1 WHERE id=?").run(att.id);
 response.json({requested:true});
}catch(e){next(e);}});
encounterRouter.post("/encounters/:appointmentId/anamneses",requireAuth,requireRole("THERAPIST"),(request,response,next)=>{try{const auth=getAuth(request);const row=appointment(Number(request.params.appointmentId),Number(auth.clinicId));guard(row,auth);const att=getAttendance(row);if(!att)throw new HttpError(409,"ATTENDANCE_NOT_STARTED","Inicie o atendimento primeiro.");const input=z.object({type:z.string().optional(),description:z.string().min(1),selectedQuestionIds:z.array(z.coerce.number()),answers:z.record(z.string(),z.string())}).parse(request.body);const create=db.transaction(()=>{const id=db.prepare("INSERT INTO ANAMNESE(atendimento_id,descricao,dt_registro) VALUES(?,?,?)").run(att.id,input.type?`${input.type}: ${input.description}`:input.description,new Date().toISOString()).lastInsertRowid;for(const q of input.selectedQuestionIds)db.prepare("INSERT INTO ANAMNESE_PERGUNTAS(anamnese_id,pergunta_id,Resposta) VALUES(?,?,?)").run(id,q,input.answers[String(q)]??"");return id;});response.status(201).json({id:String(create.immediate())});}catch(e){next(e);}});
encounterRouter.patch("/encounters/:appointmentId/anamneses/:anamnesisId",requireAuth,(request,response,next)=>{try{const auth=getAuth(request);const row=appointment(Number(request.params.appointmentId),Number(auth.clinicId));guard(row,auth);const att=getAttendance(row);if(!att)throw new HttpError(409,"ATTENDANCE_NOT_STARTED","Inicie o atendimento primeiro.");const input=z.object({type:z.string().optional(),description:z.string().min(1),selectedQuestionIds:z.array(z.coerce.number()),answers:z.record(z.string(),z.string())}).parse(request.body);const id=z.coerce.number().parse(request.params.anamnesisId);db.prepare("UPDATE ANAMNESE SET descricao=? WHERE id=? AND atendimento_id=?").run(input.type?`${input.type}: ${input.description}`:input.description,id,att.id);db.prepare("DELETE FROM ANAMNESE_PERGUNTAS WHERE anamnese_id=?").run(id);for(const q of input.selectedQuestionIds)db.prepare("INSERT INTO ANAMNESE_PERGUNTAS(anamnese_id,pergunta_id,Resposta) VALUES(?,?,?)").run(id,q,input.answers[String(q)]??"");response.json({id:String(id)});}catch(e){next(e);}});
encounterRouter.patch("/encounters/:appointmentId/anamneses/:anamnesisId/answers",requireAuth,(request,response,next)=>{try{const auth=getAuth(request);if(auth.role!=="PATIENT")throw new HttpError(403,"FORBIDDEN","Somente o paciente pode enviar respostas por esta rota.");const row=appointment(Number(request.params.appointmentId),Number(auth.clinicId));guard(row,auth);const att=getAttendance(row);if(!att)throw new HttpError(409,"ATTENDANCE_NOT_STARTED","O atendimento ainda não foi iniciado.");const id=z.coerce.number().positive().parse(request.params.anamnesisId);const exists=db.prepare("SELECT 1 FROM ANAMNESE WHERE id=? AND atendimento_id=?").get(id,att.id);if(!exists)throw new HttpError(404,"ANAMNESIS_NOT_FOUND","Anamnese não encontrada neste atendimento.");const input=z.object({answers:z.record(z.string(),z.string().max(4000))}).parse(request.body);const save=db.transaction(()=>{for(const [questionId,answer] of Object.entries(input.answers)){const qid=z.coerce.number().positive().parse(questionId);const result=db.prepare("UPDATE ANAMNESE_PERGUNTAS SET Resposta=? WHERE anamnese_id=? AND pergunta_id=?").run(answer.trim(),id,qid);if(!result.changes)throw new HttpError(400,"QUESTION_NOT_ASSIGNED","Uma pergunta não pertence a esta anamnese.");}});save();response.json({id:String(id),saved:true});}catch(e){next(e);}});
encounterRouter.post("/encounters/:appointmentId/diagnoses",requireAuth,requireRole("THERAPIST"),(request,response,next)=>{try{const auth=getAuth(request);const row=appointment(Number(request.params.appointmentId),Number(auth.clinicId));guard(row,auth);const input=z.object({description:z.string().min(1),diagnosedAt:z.string()}).parse(request.body);const id=db.prepare("INSERT INTO DIAGNOSTICO(terapeuta_id,paciente_id,descricao,dt_diagnostico) VALUES(?,?,?,?)").run(row.therapistId,row.patientId,input.description,input.diagnosedAt).lastInsertRowid;response.status(201).json({id:String(id),description:input.description,diagnosedAt:input.diagnosedAt});}catch(e){next(e);}});
encounterRouter.post("/encounters/:appointmentId/protocols",requireAuth,requireRole("THERAPIST"),(request,response,next)=>{try{
 const auth=getAuth(request);const row=appointment(Number(request.params.appointmentId),Number(auth.clinicId));guard(row,auth);const input=z.object({diagnosisId:z.coerce.number().positive(),protocolId:z.coerce.number().positive()}).parse(request.body);
 const diagnosis=db.prepare("SELECT id FROM DIAGNOSTICO WHERE id=? AND paciente_id=? AND terapeuta_id=?").get(input.diagnosisId,row.patientId,row.therapistId);if(!diagnosis)throw new HttpError(404,"DIAGNOSIS_NOT_FOUND","Diagnóstico não encontrado para este atendimento.");
 const protocol=db.prepare("SELECT id FROM PROTOCOLO WHERE id=? AND terapeuta_id=? AND diagnostico_id=?").get(input.protocolId,row.therapistId,input.diagnosisId);if(!protocol)throw new HttpError(404,"PROTOCOL_NOT_FOUND","O protocolo não está vinculado ao diagnóstico selecionado.");
 const steps=db.prepare("SELECT id,sequencia FROM PROTOCOLO_ETAPA WHERE protocolo_id=? AND terapia_id=? ORDER BY sequencia").all(input.protocolId,row.therapyId) as Array<{id:number;sequencia:number}>;if(!steps.length)throw new HttpError(409,"PROTOCOL_WITHOUT_STEPS","Adicione etapas para esta terapia antes de vincular o protocolo.");
 const link=db.transaction(()=>{for(const step of steps){const exists=db.prepare("SELECT 1 FROM DIAGNOSTICO_PROTOCOLO WHERE diagnostico_id=? AND protocolo_etapa_id=?").get(input.diagnosisId,step.id);if(!exists)db.prepare("INSERT INTO DIAGNOSTICO_PROTOCOLO(diagnostico_id,protocolo_etapa_id,dt_diagnostico,status) VALUES(?,?,?,?)").run(input.diagnosisId,step.id,new Date().toISOString(),step.sequencia===steps[0].sequencia?7:6);}});link();
 response.status(201).json({protocolId:String(input.protocolId),linkedSteps:steps.length});
}catch(e){next(e);}});
encounterRouter.post("/encounters/:appointmentId/protocol-catalog",requireAuth,requireRole("THERAPIST"),(request,response,next)=>{try{
 const auth=getAuth(request);const row=appointment(Number(request.params.appointmentId),Number(auth.clinicId));guard(row,auth);
 const input=z.object({diagnosisId:z.coerce.number().positive(),name:z.string().trim().min(2).max(150),symptoms:z.string().trim().min(2).max(4000),objective:z.string().trim().min(2).max(4000)}).parse(request.body);
 const diagnosis=db.prepare("SELECT id FROM DIAGNOSTICO WHERE id=? AND paciente_id=? AND terapeuta_id=?").get(input.diagnosisId,row.patientId,row.therapistId);
 if(!diagnosis)throw new HttpError(404,"DIAGNOSIS_NOT_FOUND","Diagnóstico não encontrado para este paciente e terapeuta.");
 const protocolId=db.prepare("INSERT INTO PROTOCOLO(terapeuta_id,diagnostico_id,nome,Sintomas,objetivo) VALUES(?,?,?,?,?)").run(row.therapistId,input.diagnosisId,input.name,input.symptoms,input.objective).lastInsertRowid;
 response.status(201).json({protocolId:String(protocolId),name:input.name});
}catch(e){next(e);}});
encounterRouter.get("/encounters/:appointmentId/protocol-catalog/unassigned",requireAuth,requireRole("THERAPIST"),(request,response,next)=>{try{
 const auth=getAuth(request);const row=appointment(Number(request.params.appointmentId),Number(auth.clinicId));guard(row,auth);
 const protocols=db.prepare("SELECT id,nome AS name,Sintomas AS symptoms,objetivo AS objective FROM PROTOCOLO WHERE terapeuta_id=? AND diagnostico_id IS NULL ORDER BY id DESC").all(row.therapistId) as Array<Record<string,any>>;
 response.json({protocols:protocols.map((protocol)=>({...protocol,id:String(protocol.id)}))});
}catch(e){next(e);}});
encounterRouter.patch("/encounters/:appointmentId/protocol-catalog/:protocolId/diagnosis",requireAuth,requireRole("THERAPIST"),(request,response,next)=>{try{
 const auth=getAuth(request);const row=appointment(Number(request.params.appointmentId),Number(auth.clinicId));guard(row,auth);const protocolId=z.coerce.number().positive().parse(request.params.protocolId);const input=z.object({diagnosisId:z.coerce.number().positive()}).parse(request.body);
 const diagnosis=db.prepare("SELECT id FROM DIAGNOSTICO WHERE id=? AND paciente_id=? AND terapeuta_id=?").get(input.diagnosisId,row.patientId,row.therapistId);if(!diagnosis)throw new HttpError(404,"DIAGNOSIS_NOT_FOUND","Diagnóstico não encontrado para este paciente e terapeuta.");
 const result=db.prepare("UPDATE PROTOCOLO SET diagnostico_id=? WHERE id=? AND terapeuta_id=? AND diagnostico_id IS NULL").run(input.diagnosisId,protocolId,row.therapistId);if(!result.changes)throw new HttpError(404,"PROTOCOL_NOT_FOUND","Protocolo sem diagnóstico não encontrado.");response.json({protocolId:String(protocolId),diagnosisId:String(input.diagnosisId)});
}catch(e){next(e);}});
encounterRouter.post("/encounters/:appointmentId/protocol-catalog/:protocolId/steps",requireAuth,requireRole("THERAPIST"),(request,response,next)=>{try{
 const auth=getAuth(request);const row=appointment(Number(request.params.appointmentId),Number(auth.clinicId));guard(row,auth);const protocolId=z.coerce.number().int().positive().parse(request.params.protocolId);
 const input=z.object({description:z.string().trim().min(2).max(1000),startsAt:z.string().optional(),endsAt:z.string().optional(),notes:z.string().max(2000).optional()}).refine(value=>!value.startsAt||!value.endsAt||value.startsAt<=value.endsAt).parse(request.body);
 const protocol=db.prepare("SELECT p.id FROM PROTOCOLO p JOIN DIAGNOSTICO d ON d.id=p.diagnostico_id WHERE p.id=? AND p.terapeuta_id=? AND d.paciente_id=? AND d.terapeuta_id=?").get(protocolId,row.therapistId,row.patientId,row.therapistId);
 if(!protocol)throw new HttpError(404,"PROTOCOL_NOT_FOUND","Protocolo não encontrado para este terapeuta.");
 const sequence=Number(db.prepare("SELECT COALESCE(MAX(sequencia),0)+1 FROM PROTOCOLO_ETAPA WHERE protocolo_id=?").pluck().get(protocolId));
 const id=db.prepare("INSERT INTO PROTOCOLO_ETAPA(protocolo_id,sequencia,terapia_id,dt_inicio,dt_fim,descricao,obs) VALUES(?,?,?,?,?,?,?)").run(protocolId,sequence,row.therapyId,input.startsAt||null,input.endsAt||null,input.description,input.notes?.trim()||null).lastInsertRowid;
 response.status(201).json({id:String(id),sequence,protocolId:String(protocolId)});
}catch(e){next(e);}});
encounterRouter.patch("/encounters/:appointmentId/protocol-stages/:diagnosisProtocolId",requireAuth,requireRole("THERAPIST"),(request,response,next)=>{try{const statuses:Record<string,number>={ACTIVE:1,INACTIVE:2,CONFIRMED:3,CANCELLED:4,RESCHEDULED:5,WAITING:6,IN_PROGRESS:7,PAID:8};const input=z.object({status:z.enum(["ACTIVE","INACTIVE","CONFIRMED","CANCELLED","RESCHEDULED","WAITING","IN_PROGRESS","PAID"]),notes:z.string().optional()}).parse(request.body);const id=z.coerce.number().parse(request.params.diagnosisProtocolId);db.prepare("UPDATE DIAGNOSTICO_PROTOCOLO SET status=? WHERE id=?").run(statuses[input.status],id);response.json({id:String(id),status:input.status});}catch(e){next(e);}});
encounterRouter.post("/encounters/:appointmentId/evolutions",requireAuth,requireRole("THERAPIST"),(request,response,next)=>{try{
 const auth=getAuth(request);const row=appointment(Number(request.params.appointmentId),Number(auth.clinicId));guard(row,auth);
 const input=z.object({diagnosisProtocolId:z.coerce.number().positive(),description:z.string().trim().min(2).max(4000),evolvedAt:z.string().optional(),status:z.enum(["ACTIVE","INACTIVE","CONFIRMED","CANCELLED","RESCHEDULED","WAITING","IN_PROGRESS","PAID"]).optional()}).parse(request.body);
 const evolvedAt=input.evolvedAt??new Date().toISOString();const selectedDate=new Date(evolvedAt);if(Number.isNaN(selectedDate.getTime()))throw new HttpError(400,"INVALID_EVOLUTION_DATE","Informe uma data válida para a evolução.");const selectedDay=selectedDate.toISOString().slice(0,10);
 const stage=db.prepare(`SELECT dp.id,dp.diagnostico_id AS diagnosisId,p.id AS protocolId,st.sequencia AS sequence,st.dt_inicio AS startsAt,d.paciente_id AS patientId,d.terapeuta_id AS therapistId
  FROM DIAGNOSTICO_PROTOCOLO dp JOIN PROTOCOLO_ETAPA st ON st.id=dp.protocolo_etapa_id JOIN PROTOCOLO p ON p.id=st.protocolo_id JOIN DIAGNOSTICO d ON d.id=dp.diagnostico_id
  WHERE dp.id=? AND d.paciente_id=? AND d.terapeuta_id=?`).get(input.diagnosisProtocolId,row.patientId,row.therapistId) as {id:number;diagnosisId:number;protocolId:number;sequence:number;startsAt:string|null;patientId:number;therapistId:number}|undefined;
 if(!stage)throw new HttpError(404,"PROTOCOL_STAGE_NOT_FOUND","Etapa não encontrada para este paciente e diagnóstico.");
 const missingPrevious=db.prepare(`SELECT st.sequencia FROM DIAGNOSTICO_PROTOCOLO prev JOIN PROTOCOLO_ETAPA st ON st.id=prev.protocolo_etapa_id
  WHERE prev.diagnostico_id=? AND st.protocolo_id=? AND st.sequencia<? AND NOT EXISTS(SELECT 1 FROM EVOLUCAO ev WHERE ev.diagnostico_protocolo_id=prev.id)
  ORDER BY st.sequencia LIMIT 1`).get(stage.diagnosisId,stage.protocolId,stage.sequence) as {sequencia:number}|undefined;
 if(missingPrevious)throw new HttpError(409,"PREVIOUS_STAGE_NOT_EVOLVED",`Registre primeiro uma evolução para a etapa ${missingPrevious.sequencia}.`);
 const previousDate=db.prepare(`SELECT MAX(date(ev.dt_evolucao)) AS lastDate FROM DIAGNOSTICO_PROTOCOLO prev JOIN PROTOCOLO_ETAPA st ON st.id=prev.protocolo_etapa_id JOIN EVOLUCAO ev ON ev.diagnostico_protocolo_id=prev.id
  WHERE prev.diagnostico_id=? AND st.protocolo_id=? AND st.sequencia<?`).get(stage.diagnosisId,stage.protocolId,stage.sequence) as {lastDate:string|null};
 const earliestDate=[stage.startsAt?new Date(stage.startsAt).toISOString().slice(0,10):null,previousDate.lastDate].filter((value):value is string=>Boolean(value)).sort().at(-1);
 if(earliestDate&&selectedDay<earliestDate)throw new HttpError(409,"EVOLUTION_OUT_OF_ORDER",`A data da evolução deve ser igual ou posterior a ${earliestDate}, respeitando a cronologia das etapas.`);
 const statusIds:Record<string,number>={ACTIVE:1,INACTIVE:2,CONFIRMED:3,CANCELLED:4,RESCHEDULED:5,WAITING:6,IN_PROGRESS:7,PAID:8};
 const id=db.prepare("INSERT INTO EVOLUCAO(diagnostico_protocolo_id,descricao,dt_evolucao,status) VALUES(?,?,?,?)").run(input.diagnosisProtocolId,input.description,evolvedAt,statusIds[input.status??"IN_PROGRESS"]).lastInsertRowid;
 response.status(201).json({id:String(id),...input,evolvedAt});
}catch(e){next(e);}});
encounterRouter.post("/encounters/:appointmentId/protocol-stages/:diagnosisProtocolId/feedback",requireAuth,requireRole("PATIENT"),(request,response,next)=>{try{
 const auth=getAuth(request);const row=appointment(Number(request.params.appointmentId),Number(auth.clinicId));guard(row,auth);
 const input=z.object({feedbackAt:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value),improvementPerception:z.string().trim().min(1).max(2000),suggestion:z.string().trim().max(2000),improvementRating:z.number().int().min(1).max(5)}).parse(request.body);
 const diagnosisProtocolId=z.coerce.number().positive().parse(request.params.diagnosisProtocolId);
 const stage=db.prepare(`SELECT st.id FROM DIAGNOSTICO_PROTOCOLO dp JOIN PROTOCOLO_ETAPA st ON st.id=dp.protocolo_etapa_id JOIN PROTOCOLO p ON p.id=st.protocolo_id JOIN DIAGNOSTICO d ON d.id=dp.diagnostico_id
  WHERE dp.id=? AND d.paciente_id=? AND d.terapeuta_id=? AND p.terapeuta_id=? AND EXISTS(SELECT 1 FROM EVOLUCAO e WHERE e.diagnostico_protocolo_id=dp.id)`).get(diagnosisProtocolId,row.patientId,row.therapistId,row.therapistId) as {id:number}|undefined;
 if(!stage)throw new HttpError(404,"PROTOCOL_STAGE_NOT_FOUND","Etapa nÃ£o encontrada para este atendimento.");
 const existing=db.prepare(`SELECT f.id FROM FEEDBACK f JOIN PROTOCOLO_ETAPA st ON st.id=f.protocolo_etapa_id JOIN PROTOCOLO p ON p.id=st.protocolo_id JOIN DIAGNOSTICO d ON d.id=p.diagnostico_id
  WHERE f.protocolo_etapa_id=? AND d.paciente_id=? AND d.terapeuta_id=? ORDER BY f.id DESC LIMIT 1`).get(stage.id,row.patientId,row.therapistId) as {id:number}|undefined;
 let feedbackId:number;
 if(existing){db.prepare("UPDATE FEEDBACK SET dt_feedback=?,percepcao_melhora=?,sugestao=?,avaliacao_melhora=? WHERE id=?").run(input.feedbackAt,input.improvementPerception,input.suggestion||null,input.improvementRating,existing.id);feedbackId=existing.id;}
 else feedbackId=Number(db.prepare("INSERT INTO FEEDBACK(protocolo_etapa_id,dt_feedback,percepcao_melhora,sugestao,avaliacao_melhora) VALUES(?,?,?,?,?)").run(stage.id,input.feedbackAt,input.improvementPerception,input.suggestion||null,input.improvementRating).lastInsertRowid);
 response.status(existing?200:201).json({id:String(feedbackId),...input});
}catch(e){next(e);}});

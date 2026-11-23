import { Router } from "express";
import { z } from "zod";
import { db } from "../db/database.js";
import { getAuth, requireAuth, requireRole } from "../middleware/auth.js";
import { createClinicAccount } from "../services/accounts.js";
import { HttpError } from "../utils/http-error.js";

export const clinicRouter = Router();
const statusLabel = (id: number) => ({ 1:"ACTIVE",2:"INACTIVE",3:"CONFIRMED",4:"CANCELLED",5:"RESCHEDULED",6:"WAITING",7:"IN_PROGRESS",8:"PAID" } as Record<number,string>)[id] ?? "WAITING";

clinicRouter.get("/dashboard", requireAuth, (request, response) => {
  const auth = getAuth(request);
  const patient = auth.role === "PATIENT" ? db.prepare("SELECT id FROM PACIENTE WHERE usuario_id=? AND clinica_id=?").get(Number(auth.userId),Number(auth.clinicId)) as {id:number}|undefined : undefined;
  const therapist = auth.role === "THERAPIST" ? db.prepare("SELECT id FROM TERAPEUTA WHERE usuario_id=?").get(Number(auth.userId)) as {id:number}|undefined : undefined;
  const appointments = db.prepare(`SELECT a.id,a.dt_inicio AS startsAt,a.dt_fim AS endsAt,a.status,t.id AS therapyId,t.nome AS therapyName,
      pu.nome AS patientName,tu.nome AS therapistName FROM AGENDA a JOIN TERAPIA t ON t.id=a.terapia_id
      JOIN PACIENTE p ON p.id=a.paciente_id JOIN USUARIO pu ON pu.id=p.usuario_id
      JOIN TERAPEUTA tr ON tr.id=a.terapeuta_id JOIN USUARIO tu ON tu.id=tr.usuario_id
      WHERE p.clinica_id=? AND date(a.dt_inicio)=date(?)
      AND (? IS NULL OR a.paciente_id=?) AND (? IS NULL OR a.terapeuta_id=?) ORDER BY a.dt_inicio LIMIT 200`)
    .all(Number(auth.clinicId), String(request.query.date ?? new Date().toISOString()).slice(0,10), patient?.id ?? null, patient?.id ?? null, therapist?.id ?? null, therapist?.id ?? null) as Array<Record<string,unknown> & {status:number}>;
  const patientCount = (db.prepare("SELECT COUNT(*) AS count FROM PACIENTE p JOIN USUARIO_CLINICA uc ON uc.usuario_id=p.usuario_id AND uc.clinica_id=p.clinica_id AND uc.perfil_id=4 AND uc.status=1 WHERE p.clinica_id=?").get(Number(auth.clinicId)) as {count:number}).count;
  const lastEncounter = db.prepare(`SELECT a.id,a.dt_atend AS attendedAt,a.terapia_id AS therapyId,t.nome AS therapyName,
    (SELECT ag.id FROM AGENDA ag WHERE ag.paciente_id=a.paciente_id AND ag.terapeuta_id=a.terapeuta_id AND ag.terapia_id=a.terapia_id AND ag.dt_inicio=a.dt_atend ORDER BY ag.id DESC LIMIT 1) AS appointmentId
    FROM ATENDIMENTO a JOIN PACIENTE p ON p.id=a.paciente_id JOIN TERAPIA t ON t.id=a.terapia_id JOIN USUARIO_CLINICA uc ON uc.usuario_id=p.usuario_id AND uc.clinica_id=p.clinica_id AND uc.perfil_id=4 AND uc.status=1 WHERE p.clinica_id=? AND (? IS NULL OR p.id=?) AND (? IS NULL OR a.terapeuta_id=?) ORDER BY a.dt_atend DESC LIMIT 1`).get(Number(auth.clinicId),patient?.id??null,patient?.id??null,therapist?.id??null,therapist?.id??null) as {id:number;attendedAt:string;therapyId:number;therapyName:string;appointmentId:number|null}|undefined;
  const recentPatients = auth.role==="THERAPIST" && therapist ? db.prepare(`SELECT p.id AS id,u.nome AS fullName,a.id AS encounterId,a.dt_atend AS attendedAt,a.terapia_id AS therapyId,t.nome AS therapyName FROM ATENDIMENTO a JOIN PACIENTE p ON p.id=a.paciente_id JOIN USUARIO u ON u.id=p.usuario_id JOIN TERAPIA t ON t.id=a.terapia_id JOIN USUARIO_CLINICA uc ON uc.usuario_id=u.id AND uc.clinica_id=p.clinica_id AND uc.perfil_id=4 AND uc.status=1 WHERE p.clinica_id=? AND a.terapeuta_id=? AND a.id=(SELECT a2.id FROM ATENDIMENTO a2 WHERE a2.paciente_id=p.id ORDER BY a2.dt_atend DESC LIMIT 1) ORDER BY a.dt_atend DESC LIMIT 6`).all(Number(auth.clinicId),therapist.id) : [];
  const todayCount = appointments.filter((row) => row.status === 3).length;
  response.json({ counts: { patients: auth.role === "PATIENT" ? 1 : patientCount, appointmentsToday: todayCount },
    appointmentsForDate: appointments.map((row) => ({...row,status:statusLabel(row.status)})),
    selectedDate: String(request.query.date ?? new Date().toISOString()).slice(0,10), lastEncounter: lastEncounter ? {...lastEncounter,id:String(lastEncounter.id),appointmentId:lastEncounter.appointmentId===null?null:String(lastEncounter.appointmentId),therapyId:String(lastEncounter.therapyId)} : null, recentPatients: recentPatients.map((row:any)=>({...row,id:String(row.id),encounterId:String(row.encounterId),therapyId:String(row.therapyId)})) });
});

clinicRouter.get("/dashboard/therapies/:therapyId/protocols", requireAuth, (request,response) => {
  const auth=getAuth(request);const therapyId=z.coerce.number().positive().parse(request.params.therapyId);
  const protocols=db.prepare(`SELECT p.id,p.nome AS name,p.Sintomas AS description,p.objetivo AS objective FROM PROTOCOLO p JOIN TERAPEUTA tr ON tr.id=p.terapeuta_id JOIN USUARIO_CLINICA uc ON uc.usuario_id=tr.usuario_id AND uc.clinica_id=? AND uc.perfil_id=3 AND uc.status=1 WHERE p.id IN (SELECT protocolo_id FROM PROTOCOLO_ETAPA WHERE terapia_id=?) ORDER BY p.nome`).all(Number(auth.clinicId),therapyId);
  response.json({ therapy: db.prepare("SELECT id,nome AS name FROM TERAPIA WHERE id=?").get(therapyId), protocols });
});
clinicRouter.get("/dashboard/encounters/:encounterId/protocols", requireAuth, (request,response) => {
  const auth=getAuth(request);const encounterId=z.coerce.number().positive().parse(request.params.encounterId);
  const attendance=db.prepare("SELECT a.terapia_id AS therapyId,a.terapeuta_id AS therapistId,a.paciente_id AS patientId FROM ATENDIMENTO a JOIN PACIENTE p ON p.id=a.paciente_id WHERE a.id=? AND p.clinica_id=?").get(encounterId,Number(auth.clinicId)) as {therapyId:number;therapistId:number;patientId:number}|undefined;
  if(!attendance){response.json({protocols:[]});return;}
  if(auth.role==="PATIENT" && attendance.patientId!==Number(db.prepare("SELECT id FROM PACIENTE WHERE usuario_id=? AND clinica_id=?").pluck().get(Number(auth.userId),Number(auth.clinicId)))){response.status(403).json({error:{code:"FORBIDDEN",message:"Acesso negado."}});return;}
  if(auth.role==="THERAPIST" && attendance.therapistId!==Number(db.prepare("SELECT id FROM TERAPEUTA WHERE usuario_id=?").pluck().get(Number(auth.userId)))){response.status(403).json({error:{code:"FORBIDDEN",message:"Acesso negado."}});return;}
  const protocols=db.prepare("SELECT p.id,p.nome AS name FROM PROTOCOLO p JOIN TERAPEUTA tr ON tr.id=p.terapeuta_id JOIN USUARIO_CLINICA uc ON uc.usuario_id=tr.usuario_id AND uc.clinica_id=? AND uc.perfil_id=3 AND uc.status=1 WHERE p.terapeuta_id=? AND p.id IN (SELECT protocolo_id FROM PROTOCOLO_ETAPA WHERE terapia_id=?) ORDER BY p.nome").all(Number(auth.clinicId),attendance.therapistId,attendance.therapyId);
  response.json({protocols});
});
clinicRouter.get("/catalog", requireAuth, (_request,response) => {
  const specialties = db.prepare("SELECT id,nome AS name,descricao AS description FROM ESPECIALIDADE WHERE status=1 ORDER BY nome").all();
  const therapies = db.prepare(`SELECT t.id,t.nome AS name,t.descricao AS description,t.duracao_min AS durationMinutes,
    t.especialidade_id AS specialtyId,s.nome AS specialtyName FROM TERAPIA t JOIN ESPECIALIDADE s ON s.id=t.especialidade_id WHERE t.status=1 ORDER BY t.nome`).all();
  response.json({specialties,therapies});
});
clinicRouter.get("/therapist-profile", requireAuth, requireRole("THERAPIST"), (request,response,next) => {
  try {
    const auth=getAuth(request);
    const therapist=db.prepare(`SELECT t.id,u.nome AS fullName,u.email,t.cpf,t.registro_prof AS professionalRegistration,t.formacao AS formation
      FROM TERAPEUTA t JOIN USUARIO u ON u.id=t.usuario_id WHERE t.usuario_id=?`).get(Number(auth.userId)) as Record<string,any>|undefined;
    if(!therapist) throw new HttpError(404,"THERAPIST_NOT_FOUND","Cadastro de terapeuta não encontrado.");
    const specialties=db.prepare(`SELECT e.id,e.nome AS name FROM TERAPEUTA_ESPECIALIDADE te JOIN ESPECIALIDADE e ON e.id=te.especialidade_id
      WHERE te.terapeuta_id=? AND te.clinica_id=? AND e.status=1 ORDER BY e.nome`).all(therapist.id,Number(auth.clinicId));
    response.json({therapist:{...therapist,id:String(therapist.id)},specialties});
  } catch(e){next(e);}
});
clinicRouter.put("/therapist-profile", requireAuth, requireRole("THERAPIST"), (request,response,next) => {
  try {
    const auth=getAuth(request);const input=z.object({fullName:z.string().trim().min(2).max(120),email:z.string().email().max(254),cpf:z.string().max(14).optional(),professionalRegistration:z.string().max(100).optional(),formation:z.string().max(500).optional(),specialtyIds:z.array(z.coerce.number().positive()).default([])}).parse(request.body);
    const therapist=db.prepare("SELECT id FROM TERAPEUTA WHERE usuario_id=?").get(Number(auth.userId)) as {id:number}|undefined;
    if(!therapist) throw new HttpError(404,"THERAPIST_NOT_FOUND","Cadastro de terapeuta não encontrado.");
    const save=db.transaction(()=>{
      db.prepare("UPDATE USUARIO SET nome=?,email=?,dt_atualizacao=? WHERE id=?").run(input.fullName,input.email.trim().toLowerCase(),new Date().toISOString(),Number(auth.userId));
      db.prepare("UPDATE TERAPEUTA SET cpf=?,registro_prof=?,formacao=? WHERE id=?").run(input.cpf?.replace(/\\D/g,"")||null,input.professionalRegistration||null,input.formation||null,therapist.id);
      db.prepare("DELETE FROM TERAPEUTA_ESPECIALIDADE WHERE terapeuta_id=? AND clinica_id=?").run(therapist.id,Number(auth.clinicId));
      for(const id of input.specialtyIds){if(!db.prepare("SELECT 1 FROM ESPECIALIDADE WHERE id=? AND status=1").get(id)) throw new HttpError(400,"SPECIALTY_NOT_FOUND","Uma especialidade selecionada não está disponível.");db.prepare("INSERT OR IGNORE INTO TERAPEUTA_ESPECIALIDADE(terapeuta_id,especialidade_id,clinica_id) VALUES(?,?,?)").run(therapist.id,id,Number(auth.clinicId));}
    });save();response.json({updated:true});
  } catch(e){next(e);}
});
clinicRouter.post("/specialties", requireAuth, requireRole("THERAPIST"), (request,response,next) => {
  try { const input=z.object({name:z.string().trim().min(2).max(100),description:z.string().max(1000).optional()}).parse(request.body);
    const result=db.prepare("INSERT INTO ESPECIALIDADE(nome,descricao,status) VALUES(?,?,1)").run(input.name,input.description??null);
    response.status(201).json({id:String(result.lastInsertRowid),...input}); } catch(e){next(e);}
});
clinicRouter.put("/specialties/:specialtyId", requireAuth, requireRole("THERAPIST"), (request,response,next) => {
  try {
    const id=z.coerce.number().int().positive().parse(request.params.specialtyId);
    const input=z.object({name:z.string().trim().min(2).max(100),description:z.string().max(1000).optional()}).parse(request.body);
    const result=db.prepare("UPDATE ESPECIALIDADE SET nome=?,descricao=? WHERE id=? AND status=1").run(input.name,input.description?.trim()||null,id);
    if(!result.changes) throw new HttpError(404,"SPECIALTY_NOT_FOUND","Especialidade não encontrada ou inativa.");
    response.json({id:String(id),...input});
  } catch(e){next(e);}
});
clinicRouter.post("/therapies", requireAuth, requireRole("THERAPIST"), (request,response,next) => {
  try { const input=z.object({specialtyId:z.coerce.number().positive(),name:z.string().trim().min(2).max(100),description:z.string().max(1000).optional(),durationMinutes:z.number().int().min(1).max(480)}).parse(request.body);
    const r=db.prepare("INSERT INTO TERAPIA(especialidade_id,nome,descricao,duracao_min,status) VALUES(?,?,?,?,1)").run(input.specialtyId,input.name,input.description??null,input.durationMinutes);
    response.status(201).json({id:String(r.lastInsertRowid),...input}); } catch(e){next(e);}
});
clinicRouter.put("/therapies/:therapyId", requireAuth, requireRole("THERAPIST"), (request,response,next) => {
  try { const id=z.coerce.number().int().positive().parse(request.params.therapyId);
    const input=z.object({specialtyId:z.coerce.number().positive(),name:z.string().trim().min(2).max(100),description:z.string().max(1000).optional(),durationMinutes:z.number().int().min(1).max(480)}).parse(request.body);
    if(!db.prepare("SELECT 1 FROM ESPECIALIDADE WHERE id=? AND status=1").get(input.specialtyId)) throw new HttpError(400,"SPECIALTY_NOT_FOUND","Especialidade selecionada não encontrada ou inativa.");
    const result=db.prepare("UPDATE TERAPIA SET especialidade_id=?,nome=?,descricao=?,duracao_min=? WHERE id=? AND status=1").run(input.specialtyId,input.name,input.description?.trim()||null,input.durationMinutes,id);
    if(!result.changes) throw new HttpError(404,"THERAPY_NOT_FOUND","Terapia não encontrada ou inativa.");
    response.json({id:String(id),...input});
  } catch(e){next(e);}
});
clinicRouter.get("/therapists", requireAuth, (request,response) => {
  const auth=getAuth(request);
  const therapists=db.prepare(`SELECT tr.id AS id,u.nome AS fullName,u.email,tr.registro_prof AS professionalRegistration
    FROM TERAPEUTA tr JOIN USUARIO u ON u.id=tr.usuario_id JOIN USUARIO_CLINICA uc ON uc.usuario_id=u.id
    WHERE uc.clinica_id=? AND uc.perfil_id=3 AND uc.status=1 ORDER BY u.nome`).all(Number(auth.clinicId));
  response.json({therapists});
});
clinicRouter.post("/therapists", requireAuth, requireRole("CLINIC_ADMIN"), async (request,response,next) => {
  try { const input=z.object({fullName:z.string().trim().min(2).max(120),email:z.string().email(),password:z.string().min(1).max(128),professionalRegistration:z.string().optional(),formation:z.string().optional(),specialtyIds:z.array(z.coerce.number()).default([])}).parse(request.body);
    const account=await createClinicAccount({clinicId:getAuth(request).clinicId,email:input.email,fullName:input.fullName,password:input.password,role:"THERAPIST"},(_link,userId)=>{
      const therapist=db.prepare("INSERT INTO TERAPEUTA(usuario_id,registro_prof,formacao) VALUES(?,?,?)").run(Number(userId),input.professionalRegistration??null,input.formation??null).lastInsertRowid;
      for(const specialtyId of input.specialtyIds) db.prepare("INSERT OR IGNORE INTO TERAPEUTA_ESPECIALIDADE(terapeuta_id,especialidade_id,clinica_id) VALUES(?,?,?)").run(Number(therapist),specialtyId,Number(getAuth(request).clinicId));
    }); response.status(201).json({id:account.userId,fullName:input.fullName,email:input.email}); } catch(e){next(e);}
});
clinicRouter.get("/availability", requireAuth, (request,response) => {
  const auth=getAuth(request);const ownTherapistId=auth.role==="THERAPIST"?Number(db.prepare("SELECT id FROM TERAPEUTA WHERE usuario_id=?").pluck().get(Number(auth.userId))):null;
  const therapistId=ownTherapistId??(request.query.therapistId?Number(request.query.therapistId):null);
  const availability=db.prepare(`SELECT d.id,t.id AS therapistId,u.nome AS therapistName,d.dia_semana AS weekday,d.hr_ini AS startsAt,d.hr_fim AS endsAt
    FROM TERAPEUTA_DISPONIBILIDADE d JOIN TERAPEUTA t ON t.usuario_id=d.usuario_id JOIN USUARIO u ON u.id=t.usuario_id
    WHERE d.clinica_id=? AND (? IS NULL OR t.id=?) ORDER BY d.usuario_id,d.dia_semana,d.hr_ini`).all(Number(auth.clinicId),therapistId,therapistId);
  response.json({availability});
});
clinicRouter.post("/availability", requireAuth, requireRole("THERAPIST"), (request,response,next) => {
  try {const input=z.object({therapistId:z.coerce.number().positive(),weekday:z.number().int().min(0).max(6),startsAt:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),endsAt:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)}).refine(v=>v.startsAt<v.endsAt).parse(request.body);
    const auth=getAuth(request);const therapist=db.prepare("SELECT t.usuario_id FROM TERAPEUTA t JOIN USUARIO_CLINICA uc ON uc.usuario_id=t.usuario_id WHERE t.id=? AND uc.clinica_id=? AND uc.perfil_id=3 AND uc.status=1").get(input.therapistId,Number(auth.clinicId)) as {usuario_id:number}|undefined;
    if(!therapist) throw new HttpError(404,"THERAPIST_NOT_FOUND","Terapeuta não encontrado.");
    if(auth.role==="THERAPIST" && Number(auth.userId)!==therapist.usuario_id) throw new HttpError(403,"FORBIDDEN","Você só pode alterar sua disponibilidade.");
    const id=db.prepare("INSERT INTO TERAPEUTA_DISPONIBILIDADE(usuario_id,clinica_id,dia_semana,hr_ini,hr_fim) VALUES(?,?,?,?,?)").run(therapist.usuario_id,Number(auth.clinicId),input.weekday,input.startsAt,input.endsAt).lastInsertRowid;
    response.status(201).json({id:String(id),...input}); }catch(e){next(e);}
});
clinicRouter.put("/availability/:availabilityId", requireAuth, requireRole("THERAPIST"), (request,response,next) => {
  try {const id=z.coerce.number().int().positive().parse(request.params.availabilityId);const input=z.object({therapistId:z.coerce.number().positive(),weekday:z.number().int().min(0).max(6),startsAt:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),endsAt:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)}).refine(v=>v.startsAt<v.endsAt).parse(request.body);const auth=getAuth(request);
    const therapist=db.prepare("SELECT t.usuario_id FROM TERAPEUTA t JOIN USUARIO_CLINICA uc ON uc.usuario_id=t.usuario_id WHERE t.id=? AND uc.clinica_id=? AND uc.perfil_id=3 AND uc.status=1").get(input.therapistId,Number(auth.clinicId)) as {usuario_id:number}|undefined;
    if(!therapist) throw new HttpError(404,"THERAPIST_NOT_FOUND","Terapeuta não encontrado.");
    if(auth.role==="THERAPIST" && Number(auth.userId)!==therapist.usuario_id) throw new HttpError(403,"FORBIDDEN","Você só pode alterar sua disponibilidade.");
    const result=db.prepare("UPDATE TERAPEUTA_DISPONIBILIDADE SET dia_semana=?,hr_ini=?,hr_fim=? WHERE id=? AND clinica_id=? AND usuario_id=?").run(input.weekday,input.startsAt,input.endsAt,id,Number(auth.clinicId),therapist.usuario_id);
    if(!result.changes) throw new HttpError(404,"AVAILABILITY_NOT_FOUND","Horário de disponibilidade não encontrado.");response.json({id:String(id),...input});
  }catch(e){next(e);}
});
clinicRouter.delete("/availability/:availabilityId", requireAuth, requireRole("THERAPIST"), (request,response,next) => {
  try {const id=z.coerce.number().int().positive().parse(request.params.availabilityId);const auth=getAuth(request);
    const ownTherapistId=auth.role==="THERAPIST"?Number(db.prepare("SELECT id FROM TERAPEUTA WHERE usuario_id=?").pluck().get(Number(auth.userId))):null;
    const result=ownTherapistId===null
      ? db.prepare("DELETE FROM TERAPEUTA_DISPONIBILIDADE WHERE id=? AND clinica_id=?").run(id,Number(auth.clinicId))
      : db.prepare("DELETE FROM TERAPEUTA_DISPONIBILIDADE WHERE id=? AND clinica_id=? AND usuario_id=?").run(id,Number(auth.clinicId),Number(auth.userId));
    if(!result.changes) throw new HttpError(404,"AVAILABILITY_NOT_FOUND","Horário de disponibilidade não encontrado.");response.json({deleted:true});
  }catch(e){next(e);}
});

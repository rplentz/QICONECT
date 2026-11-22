import { Router } from "express";
import { canPatientCancelAppointment } from "@qiconect/contracts";
import { z } from "zod";
import { db } from "../db/database.js";
import { getAuth, requireAuth, requireRole } from "../middleware/auth.js";
import { queueAppointmentNotice, queueCancellationNotice } from "../services/notifications.js";
import { HttpError } from "../utils/http-error.js";

export const appointmentRouter=Router();
const statusName=(id:number)=>({1:"ACTIVE",2:"INACTIVE",3:"CONFIRMED",4:"CANCELLED",5:"RESCHEDULED",6:"WAITING",7:"IN_PROGRESS",8:"PAID"} as Record<number,string>)[id]??"WAITING";
const select=`SELECT a.id,CAST(a.paciente_id AS TEXT) AS patientId,CAST(a.terapeuta_id AS TEXT) AS therapistId,
  CAST(a.terapia_id AS TEXT) AS therapyId,a.dt_inicio AS startsAt,a.dt_fim AS endsAt,s.nome AS statusName,a.status,
  a.paciente_id,a.terapeuta_id,a.terapia_id,
  t.nome AS therapyName,pu.nome AS patientName,tu.nome AS therapistName
  FROM AGENDA a JOIN STATUS s ON s.id=a.status JOIN TERAPIA t ON t.id=a.terapia_id
  JOIN PACIENTE p ON p.id=a.paciente_id JOIN USUARIO pu ON pu.id=p.usuario_id
  JOIN TERAPEUTA tr ON tr.id=a.terapeuta_id JOIN USUARIO tu ON tu.id=tr.usuario_id`;
function rowsForClinic(clinicId:number,role:string,userId:number){
  const patient=role==="PATIENT"?db.prepare("SELECT id FROM PACIENTE WHERE usuario_id=? AND clinica_id=?").get(userId,clinicId) as {id:number}|undefined:undefined;
  const therapist=role==="THERAPIST"?db.prepare("SELECT id FROM TERAPEUTA WHERE usuario_id=?").get(userId) as {id:number}|undefined:undefined;
  return db.prepare(`${select} WHERE p.clinica_id=? AND (? IS NULL OR a.paciente_id=?) AND (? IS NULL OR a.terapeuta_id=?) ORDER BY a.dt_inicio`)
    .all(clinicId,patient?.id??null,patient?.id??null,therapist?.id??null,therapist?.id??null) as Array<Record<string,any>>;
}
function mapAppointment(row:Record<string,any>){return {...row,id:String(row.id),status:statusName(row.status),rescheduledAt:row.status===5?row.startsAt:null};}
function ensureAvailability(therapistId:number,start:Date,end:Date,clinicId:number){
  const localStart=new Date(start.toLocaleString("en-US",{timeZone:"America/Sao_Paulo"}));
  const localEnd=new Date(end.toLocaleString("en-US",{timeZone:"America/Sao_Paulo"}));
  if(localStart.toDateString()!==localEnd.toDateString()) throw new HttpError(400,"INVALID_SLOT","O atendimento deve ocorrer no mesmo dia.");
  const therapist=db.prepare("SELECT usuario_id FROM TERAPEUTA WHERE id=?").get(therapistId) as {usuario_id:number}|undefined;
  if(!therapist) throw new HttpError(404,"THERAPIST_NOT_FOUND","Terapeuta não encontrado.");
  const weekday=localStart.getDay();const fmt=(d:Date)=>`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  const ok=db.prepare(`SELECT 1 FROM TERAPEUTA_DISPONIBILIDADE WHERE usuario_id=? AND clinica_id=? AND dia_semana=? AND hr_ini<=? AND hr_fim>=? LIMIT 1`)
    .get(therapist.usuario_id,clinicId,weekday,fmt(localStart),fmt(localEnd));
  if(!ok) throw new HttpError(409,"OUTSIDE_AVAILABILITY","Este horário está fora da disponibilidade do terapeuta.");
}
function ensureNoConflict(clinicId:number,patientId:number,therapistId:number,start:string,end:string,excluding?:number){
  const conflict=db.prepare(`SELECT 1 FROM AGENDA a JOIN PACIENTE p ON p.id=a.paciente_id
    WHERE p.clinica_id=? AND a.status<>4 AND a.dt_inicio<? AND a.dt_fim>? AND (a.terapeuta_id=? OR a.paciente_id=?) AND (? IS NULL OR a.id<>?) LIMIT 1`)
    .get(clinicId,end,start,therapistId,patientId,excluding??null,excluding??null);
  if(conflict) throw new HttpError(409,"SLOT_TAKEN","Este horário não está mais disponível.");
}
appointmentRouter.get("/appointments",requireAuth,(request,response)=>{
  const auth=getAuth(request);response.json({appointments:rowsForClinic(Number(auth.clinicId),auth.role,Number(auth.userId)).map(mapAppointment)});
});
appointmentRouter.post("/appointments",requireAuth,(request,response,next)=>{
  try{
    const input=z.object({therapistId:z.coerce.number().positive(),therapyId:z.coerce.number().positive(),patientId:z.coerce.number().positive().optional(),startsAt:z.string().datetime({offset:true})}).parse(request.body);
    const auth=getAuth(request);const patient=auth.role==="PATIENT"
      ? db.prepare("SELECT id FROM PACIENTE WHERE usuario_id=? AND clinica_id=?").get(Number(auth.userId),Number(auth.clinicId)) as {id:number}|undefined
      : db.prepare("SELECT id FROM PACIENTE WHERE id=? AND clinica_id=?").get(input.patientId,Number(auth.clinicId)) as {id:number}|undefined;
    if(!patient) throw new HttpError(404,"PATIENT_NOT_FOUND","Paciente não encontrado nesta clínica.");
    const therapist=db.prepare(`SELECT tr.id,tr.usuario_id FROM TERAPEUTA tr JOIN USUARIO_CLINICA uc ON uc.usuario_id=tr.usuario_id
      WHERE tr.id=? AND uc.clinica_id=? AND uc.perfil_id=3 AND uc.status=1`).get(input.therapistId,Number(auth.clinicId)) as {id:number;usuario_id:number}|undefined;
    if(!therapist) throw new HttpError(404,"THERAPIST_NOT_FOUND","Terapeuta não encontrado nesta clínica.");
    const therapy=db.prepare("SELECT duracao_min FROM TERAPIA WHERE id=? AND status=1").get(input.therapyId) as {duracao_min:number}|undefined;
    if(!therapy) throw new HttpError(404,"THERAPY_NOT_FOUND","Terapia não encontrada.");
    const start=new Date(input.startsAt);const end=new Date(start.getTime()+therapy.duracao_min*60000);
    ensureAvailability(therapist.id,start,end,Number(auth.clinicId));
    ensureNoConflict(Number(auth.clinicId),patient.id,therapist.id,start.toISOString(),end.toISOString());
    const id=db.prepare("INSERT INTO AGENDA(paciente_id,terapeuta_id,terapia_id,dt_inicio,dt_fim,status) VALUES(?,?,?,?,?,3)")
      .run(patient.id,therapist.id,input.therapyId,start.toISOString(),end.toISOString()).lastInsertRowid;
    const recipients=db.prepare(`SELECT u.email,p.telefone AS phone FROM PACIENTE p JOIN USUARIO u ON u.id=p.usuario_id WHERE p.id=?
      UNION ALL SELECT u.email,NULL AS phone FROM TERAPEUTA t JOIN USUARIO u ON u.id=t.usuario_id WHERE t.id=?`).all(patient.id,therapist.id) as Array<{email:string;phone:string|null}>;
    queueAppointmentNotice(auth.clinicId,recipients,"APPOINTMENT_CONFIRMED",String(id));
    response.status(201).json({appointment:{id:String(id),startsAt:start.toISOString(),endsAt:end.toISOString(),status:"CONFIRMED"}});
  }catch(e){next(e);}
});
appointmentRouter.post("/appointments/:id/cancel",requireAuth,(request,response,next)=>{
  try{
    const auth=getAuth(request);const id=z.coerce.number().positive().parse(request.params.id);
    const row=db.prepare(`${select} WHERE a.id=? AND p.clinica_id=?`).get(id,Number(auth.clinicId)) as Record<string,any>|undefined;
    if(!row) throw new HttpError(404,"APPOINTMENT_NOT_FOUND","Agendamento não encontrado.");
    if(row.status===4) throw new HttpError(409,"ALREADY_CANCELLED","Este agendamento já foi cancelado.");
    if(auth.role==="PATIENT"){
      const patient=db.prepare("SELECT id FROM PACIENTE WHERE usuario_id=?").get(Number(auth.userId)) as {id:number}|undefined;
      if(patient?.id!==row.paciente_id) throw new HttpError(403,"FORBIDDEN","Você só pode cancelar seus próprios agendamentos.");
      if(!canPatientCancelAppointment(new Date(row.startsAt),new Date())) throw new HttpError(409,"CANCELLATION_WINDOW_CLOSED","O cancelamento pelo paciente deve ocorrer com pelo menos quatro horas de antecedência.");
    }
    db.prepare("UPDATE AGENDA SET status=4 WHERE id=?").run(id);
    const therapist=db.prepare("SELECT u.email,NULL AS phone FROM TERAPEUTA t JOIN USUARIO u ON u.id=t.usuario_id WHERE t.id=?").get(row.terapeuta_id) as {email:string;phone:null};
    queueCancellationNotice(auth.clinicId,therapist,String(id));response.json({status:"CANCELLED",notifications:"NOT_CONFIGURED"});
  }catch(e){next(e);}
});
appointmentRouter.post("/appointments/:id/reschedule",requireAuth,(request,response,next)=>{
  try{
    const auth=getAuth(request);const id=z.coerce.number().positive().parse(request.params.id);
    const start=z.string().datetime({offset:true}).parse(z.object({startsAt:z.string()}).parse(request.body).startsAt);
    const old=db.prepare(`${select} WHERE a.id=? AND p.clinica_id=?`).get(id,Number(auth.clinicId)) as Record<string,any>|undefined;
    if(!old) throw new HttpError(404,"APPOINTMENT_NOT_FOUND","Agendamento não encontrado.");
    if(auth.role==="PATIENT" && Number(db.prepare("SELECT id FROM PACIENTE WHERE usuario_id=?").pluck().get(Number(auth.userId)))!==old.paciente_id) throw new HttpError(403,"FORBIDDEN","Você só pode remarcar seus próprios agendamentos.");
    if(auth.role==="THERAPIST" && Number(db.prepare("SELECT id FROM TERAPEUTA WHERE usuario_id=?").pluck().get(Number(auth.userId)))!==old.terapeuta_id) throw new HttpError(403,"FORBIDDEN","Você só pode remarcar seus próprios atendimentos.");
    const duration=db.prepare("SELECT duracao_min FROM TERAPIA WHERE id=?").get(old.terapia_id) as {duracao_min:number};
    const startDate=new Date(start);const endDate=new Date(startDate.getTime()+duration.duracao_min*60000);
    ensureAvailability(old.terapeuta_id,startDate,endDate,Number(auth.clinicId));ensureNoConflict(Number(auth.clinicId),old.paciente_id,old.terapeuta_id,startDate.toISOString(),endDate.toISOString(),id);
    db.prepare("UPDATE AGENDA SET dt_inicio=?,dt_fim=?,status=5 WHERE id=?").run(startDate.toISOString(),endDate.toISOString(),id);
    const recipients=db.prepare(`SELECT u.email,p.telefone AS phone FROM PACIENTE p JOIN USUARIO u ON u.id=p.usuario_id WHERE p.id=?
      UNION ALL SELECT u.email,NULL AS phone FROM TERAPEUTA t JOIN USUARIO u ON u.id=t.usuario_id WHERE t.id=?`).all(old.paciente_id,old.terapeuta_id) as Array<{email:string;phone:string|null}>;
    queueAppointmentNotice(auth.clinicId,recipients,"APPOINTMENT_RESCHEDULED",String(id));
    response.json({notifications:"NOT_CONFIGURED"});
  }catch(e){next(e);}
});
appointmentRouter.patch("/appointments/:id/status",requireAuth,requireRole("THERAPIST"),(request,response,next)=>{
  try{const auth=getAuth(request);const id=z.coerce.number().positive().parse(request.params.id);const input=z.object({status:z.enum(["IN_PROGRESS"])}).parse(request.body);
    const row=db.prepare(`${select} WHERE a.id=? AND p.clinica_id=?`).get(id,Number(auth.clinicId)) as Record<string,any>|undefined;
    if(!row)throw new HttpError(404,"APPOINTMENT_NOT_FOUND","Agendamento não encontrado.");
    if(Number(db.prepare("SELECT id FROM TERAPEUTA WHERE usuario_id=?").pluck().get(Number(auth.userId)))!==row.terapeuta_id) throw new HttpError(403,"FORBIDDEN","Você só pode iniciar seus próprios atendimentos.");
    const startedAt=new Date().toISOString();
    db.prepare("UPDATE AGENDA SET status=7 WHERE id=?").run(id);
    const attendance=db.prepare("SELECT id FROM ATENDIMENTO WHERE paciente_id=? AND terapeuta_id=? AND terapia_id=? AND dt_atend=?").get(row.paciente_id,row.terapeuta_id,row.terapia_id,row.startsAt);
    let attendanceId = attendance ? Number((attendance as {id:number}).id) : 0;
    if(!attendanceId) attendanceId = Number(db.prepare("INSERT INTO ATENDIMENTO(paciente_id,terapeuta_id,terapia_id,dt_atend,status,dt_inicio_real) VALUES(?,?,?,?,7,?)").run(row.paciente_id,row.terapeuta_id,row.terapia_id,row.startsAt,startedAt).lastInsertRowid);
    else db.prepare("UPDATE ATENDIMENTO SET status=7,dt_inicio_real=COALESCE(dt_inicio_real,?) WHERE id=?").run(startedAt,attendanceId);
    if(!db.prepare("SELECT id FROM PRONTUARIO WHERE atendimento_id=?").get(attendanceId)) db.prepare("INSERT INTO PRONTUARIO(paciente_id,atendimento_id,status) VALUES(?,?,1)").run(row.paciente_id,attendanceId);
    response.json({status:input.status});}catch(e){next(e);}
});

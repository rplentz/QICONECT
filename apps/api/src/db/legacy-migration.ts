import type Database from "better-sqlite3";

type Row = Record<string, any>;
type Snapshot = Record<string, Row[]>;
const legacyTables = ["CLINICA","USUARIO","memberships","PACIENTE","TERAPEUTA","ESPECIALIDADE","TERAPEUTA_ESPECIALIDADE","TERAPIA","PROTOCOLO","PROTOCOLO_ETAPA","DIAGNOSTICO","DIAGNOSTICO_PROTOCOLO","EVOLUCAO","AGENDA","ATENDIMENTO","PRONTUARIO","ANAMNESE","PERGUNTAS","ANAMNESE_PERGUNTAS","ANEXO","BIOWELL_AVALIACAO","RELATORIO","PAGAMENTO","sessions","notifications"];
const profiles = ["Administrador","Empresa","Terapeuta","Paciente"];
const statuses = ["Ativo","Inativo","Confirmado","Cancelado","Remarcado","Aguardando","Em atendimento","Pago"];

export function captureLegacyData(db: Database.Database): Snapshot {
  const result: Snapshot = {};
  for (const table of legacyTables) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    result[table] = exists ? db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all() as Row[] : [];
  }
  return result;
}

export function importLegacyData(db: Database.Database, data: Snapshot): void {
  const rows = (table: string) => data[table] ?? [];
  const idMap = (items: Row[]) => new Map(items.map((row, index) => [String(row.id), index + 1]));
  const clinicMap=idMap(rows("CLINICA")), userMap=idMap(rows("USUARIO")), linkMap=idMap(rows("memberships"));
  const patientMap=idMap(rows("PACIENTE")), therapistMap=idMap(rows("TERAPEUTA")), specialtyMap=idMap(rows("ESPECIALIDADE"));
  const therapyMap=idMap(rows("TERAPIA")), protocolMap=idMap(rows("PROTOCOLO")), stepMap=idMap(rows("PROTOCOLO_ETAPA"));
  const diagnosisMap=idMap(rows("DIAGNOSTICO")), diagnosisProtocolMap=idMap(rows("DIAGNOSTICO_PROTOCOLO"));
  const appointmentMap=idMap(rows("AGENDA")), attendanceMap=idMap(rows("ATENDIMENTO")), anamnesisMap=idMap(rows("ANAMNESE"));
  const questionMap=idMap(rows("PERGUNTAS"));
  const mapped=(map:Map<string,number>, value:unknown)=>value==null?null:map.get(String(value))??null;
  const profileId=(role:string)=>({CLINIC_ADMIN:1,COMPANY:2,THERAPIST:3,PATIENT:4,ADMINISTRATOR:1,EMPRESA:2,TERAPEUTA:3,PACIENTE:4} as Record<string,number>)[role.toUpperCase()]??1;
  const statusId=(value:unknown, fallback=1)=>{
    const key=String(value??"").trim().toUpperCase();
    const mapping:Record<string,number>={ACTIVE:1,ATIVO:1,INVITED:6,INACTIVE:2,INATIVO:2,SUSPENDED:2,CONFIRMED:3,CONFIRMADO:3,CANCELLED:4,CANCELADO:4,RESCHEDULED:5,REMARCADO:5,PLANNED:6,WAITING:6,AGUARDANDO:6,IN_PROGRESS:7,ACTIVE_ATTENDANCE:7,"EM ATENDIMENTO":7,COMPLETED:7,NO_SHOW:4,PAID:8,PAGO:8};
    return mapping[key]??(Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=8?Number(value):fallback);
  };
  const insert=(sql:string, ...values:unknown[])=>db.prepare(sql).run(...values);
  for(const [index,name] of statuses.entries())insert("INSERT INTO STATUS(id,nome) VALUES(?,?)",index+1,name);
  for(const [index,name] of profiles.entries())insert("INSERT INTO PERFIL(id,nome) VALUES(?,?)",index+1,name);
  for(const [index,row] of rows("CLINICA").entries())insert("INSERT INTO CLINICA(id,nome,cnpj,email,telefone,endereco,status,dt_registro,dt_atualizacao) VALUES(?,?,?,?,?,?,?,?,?)",index+1,row.nome??"Clínica",row.cnpj??null,row.email??null,row.telefone??null,row.endereco??null,statusId(row.status??row.ativo),row.dt_registro??null,row.dt_atualizacao??null);
  const linkByUser=new Map<string,Row>();for(const link of rows("memberships"))if(!linkByUser.has(String(link.user_id)))linkByUser.set(String(link.user_id),link);
  for(const [index,row] of rows("USUARIO").entries()){const link=linkByUser.get(String(row.id));insert("INSERT INTO USUARIO(id,nome,email,senha,perfil,dt_ult_acesso,dt_registro,dt_atualizacao) VALUES(?,?,?,?,?,?,?,?)",index+1,row.nome??row.full_name??row.email,row.email, row.senha??row.password_hash??"",profileId(link?.role??"CLINIC_ADMIN"),row.dt_ult_acesso??null,row.dt_registro??row.created_at??null,row.dt_atualizacao??null);}
  for(const [index,row] of rows("memberships").entries())insert("INSERT INTO USUARIO_CLINICA(id,usuario_id,perfil_id,clinica_id,status) VALUES(?,?,?,?,?)",index+1,mapped(userMap,row.user_id),profileId(row.role),mapped(clinicMap,row.clinic_id),statusId(row.status));
  for(const [index,row] of rows("PACIENTE").entries())insert("INSERT INTO PACIENTE(id,usuario_id,clinica_id,cpf,dt_nasc,telefone,sexo,endereco,Signo) VALUES(?,?,?,?,?,?,?,?,?)",index+1,mapped(userMap,row.usuario_id),mapped(clinicMap,row.clinica_id??row.clinic_id),row.cpf??null,row.dt_nasc??null,row.telefone??null,row.sexo??null,row.endereco??null,row.Signo??null);
  for(const [index,row] of rows("TERAPEUTA").entries())insert("INSERT INTO TERAPEUTA(id,usuario_id,cpf,registro_prof,formacao) VALUES(?,?,?,?,?)",index+1,mapped(userMap,row.usuario_id),row.cpf??null,row.registro_prof??null,row.formacao??null);
  for(const [index,row] of rows("ESPECIALIDADE").entries())insert("INSERT INTO ESPECIALIDADE(id,nome,descricao,status) VALUES(?,?,?,?)",index+1,row.nome??"Especialidade",row.descricao??null,statusId(row.status??row.ativo));
  for(const [index,row] of rows("TERAPEUTA_ESPECIALIDADE").entries())insert("INSERT OR IGNORE INTO TERAPEUTA_ESPECIALIDADE(id,terapeuta_id,especialidade_id,clinica_id) VALUES(?,?,?,?)",index+1,mapped(therapistMap,row.terapeuta_id??row.therapist_id),mapped(specialtyMap,row.especialidade_id),mapped(clinicMap,row.clinic_id));
  for(const [index,row] of rows("TERAPIA").entries())insert("INSERT INTO TERAPIA(id,especialidade_id,nome,descricao,duracao_min,status) VALUES(?,?,?,?,?,?)",index+1,mapped(specialtyMap,row.especialidade_id),row.nome??"Terapia",row.descricao??null,row.duracao_min??60,statusId(row.status??row.ativa));
  for(const [index,row] of rows("DIAGNOSTICO").entries())insert("INSERT INTO DIAGNOSTICO(id,terapeuta_id,paciente_id,descricao,dt_diagnostico) VALUES(?,?,?,?,?)",index+1,mapped(therapistMap,row.terapeuta_id),mapped(patientMap,row.paciente_id),row.descricao??"",row.dt_diagnostico??null);
  for(const [index,row] of rows("PROTOCOLO").entries())insert("INSERT INTO PROTOCOLO(id,terapeuta_id,diagnostico_id,nome,Sintomas,objetivo) VALUES(?,?,?,?,?,?)",index+1,mapped(therapistMap,row.terapeuta_id),mapped(diagnosisMap,row.diagnostico_id),row.nome??"Protocolo",row.Sintomas??row.descricao??null,row.objetivo??null);
  for(const [index,row] of rows("PROTOCOLO_ETAPA").entries())insert("INSERT INTO PROTOCOLO_ETAPA(id,protocolo_id,sequencia,terapia_id,dt_inicio,dt_fim,descricao,obs) VALUES(?,?,?,?,?,?,?,?)",index+1,mapped(protocolMap,row.protocolo_id),row.sequencia??index+1,mapped(therapyMap,row.terapia_id),row.dt_inicio??null,row.dt_fim??null,row.descricao??null,row.obs??null);
  for(const [index,row] of rows("DIAGNOSTICO_PROTOCOLO").entries())insert("INSERT INTO DIAGNOSTICO_PROTOCOLO(id,diagnostico_id,protocolo_etapa_id,dt_diagnostico,status) VALUES(?,?,?,?,?)",index+1,mapped(diagnosisMap,row.diagnostico_id),mapped(stepMap,row.protocolo_etapa_id),row.dt_diagnostico??null,statusId(row.status,6));
  for(const [index,row] of rows("EVOLUCAO").entries())insert("INSERT INTO EVOLUCAO(id,diagnostico_protocolo_id,descricao,dt_evolucao,status) VALUES(?,?,?,?,?)",index+1,mapped(diagnosisProtocolMap,row.diagnostico_protocolo_id),row.descricao??"",row.dt_evolucao??null,statusId(row.status,7));
  for(const [index,row] of rows("AGENDA").entries())insert("INSERT INTO AGENDA(id,paciente_id,terapeuta_id,terapia_id,dt_inicio,dt_fim,status) VALUES(?,?,?,?,?,?,?)",index+1,mapped(patientMap,row.paciente_id),mapped(therapistMap,row.terapeuta_id),mapped(therapyMap,row.terapia_id),row.dt_inicio,row.dt_fim,statusId(row.status,3));
  const attendanceRows=rows("ATENDIMENTO");
  for(const [index,row] of attendanceRows.entries())insert("INSERT INTO ATENDIMENTO(id,paciente_id,terapeuta_id,terapia_id,dt_atend,status) VALUES(?,?,?,?,?,?)",index+1,mapped(patientMap,row.paciente_id),mapped(therapistMap,row.terapeuta_id),mapped(therapyMap,row.terapia_id),row.dt_atend,statusId(row.status,7));
  const chartRows=rows("PRONTUARIO");const chartBySource=new Map(chartRows.map(r=>[String(r.id),r]));
  for(const [index,attendance] of attendanceRows.entries()){
    const sourceChart=chartRows.find(c=>String(c.paciente_id??"")===String(attendance.paciente_id??"")||String(c.patient_membership_id??"")===String(attendance.patient_membership_id??""));
    insert("INSERT INTO PRONTUARIO(id,paciente_id,atendimento_id,status) VALUES(?,?,?,?)",index+1,mapped(patientMap,attendance.paciente_id),index+1,statusId(sourceChart?.status??"ACTIVE"));
  }
  for(const [index,row] of rows("ANAMNESE").entries())insert("INSERT INTO ANAMNESE(id,atendimento_id,descricao,dt_registro) VALUES(?,?,?,?)",index+1,mapped(attendanceMap,row.atendimento_id),[row.tipo,row.descricao].filter(Boolean).join(": "),row.dt_registro??row.created_at??null);
  for(const [index,row] of rows("PERGUNTAS").entries())insert("INSERT INTO PERGUNTAS(id,descricao) VALUES(?,?)",index+1,row.descricao??"");
  for(const [index,row] of rows("ANAMNESE_PERGUNTAS").entries())insert("INSERT INTO ANAMNESE_PERGUNTAS(id,anamnese_id,pergunta_id,Resposta) VALUES(?,?,?,?)",index+1,mapped(anamnesisMap,row.anamnese_id),mapped(questionMap,row.pergunta_id),row.Resposta??null);
  for(const row of rows("ANEXO")){const attendanceId=mapped(attendanceMap,row.atendimento_id);if(!attendanceId)continue;const chartId=attendanceRows.findIndex(a=>String(a.id)===String(row.atendimento_id))+1;const metadata=JSON.stringify({storageKey:row.storage_key??row.arquivo,originalFilename:row.original_filename??"arquivo",contentType:row.content_type??"application/octet-stream",sizeBytes:row.size_bytes??0,type:row.tipo??"EXAM"});insert("INSERT INTO ANEXO(prontuario_id,atendimento_id,arquivo,descricao,dt_atualizacao) VALUES(?,?,?,?,?)",chartId,attendanceId,metadata,row.descricao??null,row.dt_upload??row.created_at??null);}
  for(const [index,row] of rows("BIOWELL_AVALIACAO").entries()){const attendanceId=mapped(attendanceMap,row.atendimento_id);if(!attendanceId)continue;insert("INSERT INTO BIOWELL_AVALIACAO(id,prontuario_id,atendimento_id,dt_avaliacao,indice_energetico,indice_estresse) VALUES(?,?,?,?,?,?)",index+1,attendanceRows.findIndex(a=>String(a.id)===String(row.atendimento_id))+1,attendanceId,row.dt_avaliacao,row.indice_energetico,row.indice_estresse);}
  for(const [index,row] of rows("RELATORIO").entries()){const attendanceId=mapped(attendanceMap,row.atendimento_id);if(attendanceId)insert("INSERT INTO RELATORIO(id,atendimento_id,tipo,arquivo_pdf,dt_geracao) VALUES(?,?,?,?,?)",index+1,attendanceId,row.tipo??null,row.arquivo_pdf??null,row.dt_geracao??null);}
  for(const [index,row] of rows("PAGAMENTO").entries())insert("INSERT INTO PAGAMENTO(id,agenda_id,atendimento_id,valor,forma_pagamento,status) VALUES(?,?,?,?,?,?)",index+1,mapped(appointmentMap,row.agenda_id),mapped(attendanceMap,row.atendimento_id),row.valor??null,row.forma_pagamento??null,statusId(row.status,6));
  for(const row of rows("sessions")){const userId=mapped(userMap,row.user_id),clinicId=mapped(clinicMap,row.clinic_id);const link=rows("memberships").find(m=>String(m.user_id)===String(row.user_id)&&String(m.clinic_id)===String(row.clinic_id));if(userId&&clinicId&&link){const profile=profileId(link.role);const patientId=profile===4?mapped(patientMap,rows("PACIENTE").find(p=>String(p.usuario_id)===String(row.user_id)&&String(p.clinica_id??p.clinic_id)===String(link.clinic_id))?.id):null;const therapistId=profile===3?mapped(therapistMap,rows("TERAPEUTA").find(t=>String(t.usuario_id)===String(row.user_id))?.id):null;insert("INSERT INTO sessions(token_hash,user_id,clinic_id,user_clinic_id,patient_id,therapist_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)",row.token_hash,userId,clinicId,mapped(linkMap,link.id),patientId,therapistId,row.expires_at,row.created_at);}}
  for(const [index,row] of rows("notifications").entries()){const clinicId=mapped(clinicMap,row.clinic_id);if(clinicId)insert("INSERT INTO notifications(id,clinic_id,recipient,channel,event,status,details,created_at) VALUES(?,?,?,?,?,?,?,?)",index+1,clinicId,row.recipient??"",row.channel??"EMAIL",row.event??"LEGACY",row.status??"NOT_CONFIGURED",row.details??null,row.created_at??new Date().toISOString());}
}

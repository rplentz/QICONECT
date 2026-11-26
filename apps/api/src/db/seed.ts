import { db } from "./database.js";

export async function seedDemoData(): Promise<void> {
  if (db.prepare("SELECT id FROM CLINICA LIMIT 1").get()) return;
  const seed = db.transaction(() => {
    db.prepare("INSERT INTO STATUS(id,nome) VALUES (1,'Ativo'),(2,'Inativo'),(3,'Confirmado'),(4,'Cancelado'),(5,'Remarcado'),(6,'Aguardando'),(7,'Em atendimento'),(8,'Pago'),(9,'Finalizado')").run();
    db.prepare("INSERT INTO PERFIL(id,nome) VALUES (1,'Administrador'),(2,'Empresa'),(3,'Terapeuta'),(4,'Paciente')").run();
    db.prepare("INSERT INTO CLINICA(id,nome,cnpj,email,telefone,endereco,status,dt_registro,dt_atualizacao) VALUES (1,'Clínica QIConect','12.345.678/0001-99','contato@qiconect.com.br','(48)99999-0000','Florianópolis/SC',1,datetime('now'),datetime('now'))").run();
    const users = [
      [1, "Administrador QIConect", "admin@qiconect.local", "Admin123!", 1],
      [2, "Ana Terapeuta", "terapeuta@qiconect.local", "Terapeuta123!", 3],
      [3, "Joana Paciente", "paciente@qiconect.local", "Paciente123!", 4],
    ] as const;
    const insertUser = db.prepare("INSERT INTO USUARIO(id,nome,email,senha,perfil,dt_registro,dt_atualizacao) VALUES (?,?,?,?,?,datetime('now'),datetime('now'))");
    const insertClinicUser = db.prepare("INSERT INTO USUARIO_CLINICA(id,usuario_id,perfil_id,clinica_id,status) VALUES (?,?,?,?,1)");
    users.forEach(([id, name, email, password, profile], index) => {
      insertUser.run(id, name, email, password, profile);
      insertClinicUser.run(index + 1, id, profile, 1);
    });
    db.prepare("INSERT INTO PACIENTE(id,usuario_id,clinica_id,telefone) VALUES (1,3,1,'+5511988888888')").run();
    db.prepare("INSERT INTO TERAPEUTA(id,usuario_id,registro_prof,formacao) VALUES (1,2,'DEMO-001','Terapias integrativas')").run();
    db.prepare("INSERT INTO ESPECIALIDADE(id,nome,descricao,status) VALUES (1,'Naturopatia','Acompanhamento terapêutico integrativo.',1)").run();
    db.prepare("INSERT INTO TERAPEUTA_ESPECIALIDADE(terapeuta_id,especialidade_id,clinica_id) VALUES (1,1,1)").run();
    db.prepare("INSERT INTO TERAPIA(id,especialidade_id,nome,descricao,duracao_min,status) VALUES (1,1,'Consulta integrativa','Atendimento inicial ou de acompanhamento.',60,1)").run();
    const addAvailability = db.prepare("INSERT INTO TERAPEUTA_DISPONIBILIDADE(usuario_id,clinica_id,dia_semana,hr_ini,hr_fim) VALUES (2,1,?,'08:00','18:00')");
    for (let weekday = 1; weekday <= 5; weekday += 1) addAvailability.run(weekday);
    db.prepare("INSERT INTO PERGUNTAS(id,descricao) VALUES (1,'Como está a qualidade do sono?'),(2,'Possui ansiedade?'),(3,'Nível de energia?')").run();
  });
  seed.immediate();
}

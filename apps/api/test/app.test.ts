import { afterAll, beforeAll, describe, expect, it } from "vitest";

const demoPatient = { email: "paciente@qiconect.local", password: "Paciente123!" };

let baseUrl = "";
let server: { close: (callback?: (error?: Error) => void) => void } | undefined;
let db: typeof import("../src/db/database.js").db;
let patientInOtherClinic = "";

async function login(email: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`Test login failed with status ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Login did not return a session cookie.");
  return cookie;
}

function nextWeekdayAtTen(): string {
  const candidate = new Date();
  candidate.setUTCDate(candidate.getUTCDate() + 1);
  while (true) {
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" })
      .format(candidate);
    if (weekday !== "Sat" && weekday !== "Sun") break;
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(candidate);
  return new Date(`${date}T10:00:00-03:00`).toISOString();
}

beforeAll(async () => {
  const [{ app }, database, seed, accounts] = await Promise.all([
    import("../src/app.js"),
    import("../src/db/database.js"),
    import("../src/db/seed.js"),
    import("../src/services/accounts.js"),
  ]);
  db = database.db;
  await seed.seedDemoData();

  const otherClinicId = crypto.randomUUID();
  db.prepare("INSERT INTO CLINICA (id, slug, nome, timezone, dt_registro) VALUES (?, ?, ?, ?, ?)").run(
    otherClinicId,
    "another-clinic",
    "Outra clínica",
    "America/Sao_Paulo",
    new Date().toISOString(),
  );
  const account = await accounts.createClinicAccount({
    clinicId: otherClinicId,
    email: "paciente@outraclinica.local",
    fullName: "Paciente de outra clínica",
    password: "OutraSenha123!",
    role: "PATIENT",
  });
  patientInOtherClinic = account.membershipId;
  db.prepare("INSERT INTO PACIENTE (id, usuario_id, clinica_id, membership_id, clinic_id) VALUES (?, ?, ?, ?, ?)").run(
    account.membershipId, account.userId, otherClinicId, account.membershipId, otherClinicId,
  );

  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    const listeningServer = server as typeof server & { once: (event: string, listener: (error?: Error) => void) => void; address: () => { port: number } | string | null };
    listeningServer.once("listening", () => {
      const address = listeningServer.address();
      if (!address || typeof address === "string") {
        reject(new Error("Test server did not get a TCP port."));
        return;
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
    listeningServer.once("error", reject);
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
  db?.close();
});

describe("QIConect API MVP", () => {
  it("applies the workbook model migration and assigns normalized profile roles", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const names = new Set(tables.map((table) => table.name));

    expect([...names]).toEqual(
      expect.arrayContaining([
        "CLINICA",
        "PERFIL",
        "USUARIO",
        "PACIENTE",
        "TERAPEUTA",
        "ESPECIALIDADE",
        "TERAPEUTA_ESPECIALIDADE",
        "TERAPIA",
        "PROTOCOLO",
        "PROTOCOLO_ETAPA",
        "DIAGNOSTICO",
        "DIAGNOSTICO_PROTOCOLO",
        "EVOLUCAO",
        "AGENDA",
        "ATENDIMENTO",
        "PRONTUARIO",
        "ANAMNESE",
        "PERGUNTAS",
        "ANAMNESE_PERGUNTAS",
        "ANEXO",
        "BIOWELL_AVALIACAO",
        "BIOWELL_CHAKRA",
        "ANALISE_LINGUA",
        "RELATORIO",
        "PAGAMENTO",
        "PACOTE",
        "AUDITORIA",
        "anamnesis_question_options",
        "anamnesis_assignments",
        "workbook_import_batches",
        "workbook_import_rejections",
      ]),
    );
    expect([...names]).not.toEqual(
      expect.arrayContaining([
        "clinics",
        "profiles",
        "users",
        "patient_profiles",
        "therapist_profiles",
        "specialties",
        "therapist_specialties",
        "therapies",
        "protocols",
        "protocol_steps",
        "diagnoses",
        "diagnosis_protocols",
        "evolutions",
        "appointments",
        "encounters",
        "patient_charts",
        "anamneses",
        "anamnesis_questions",
        "anamnesis_answers",
        "attachments",
        "biowell_assessments",
        "biowell_chakras",
        "tongue_analyses",
        "reports",
        "payments",
        "therapeutic_packages",
        "audit_events",
      ]),
    );
    expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: 5 });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    const userColumns = db.prepare("PRAGMA table_info(USUARIO)").all() as Array<{ name: string }>;
    const answerColumns = db.prepare("PRAGMA table_info(ANAMNESE_PERGUNTAS)").all() as Array<{ name: string }>;
    expect(userColumns.map((column) => column.name)).toEqual(expect.arrayContaining(["nome", "telefone", "ativo"]));
    expect(answerColumns.map((column) => column.name)).toContain("Resposta");
    expect(
      db
        .prepare(
          `SELECT p.nome AS name FROM memberships m JOIN PERFIL p ON p.id = m.profile_id
           WHERE m.role = 'CLINIC_ADMIN' LIMIT 1`,
        )
        .get(),
    ).toEqual({ name: "Empresa" });
    expect(
      db
        .prepare(
          `SELECT p.nome AS name FROM memberships m JOIN PERFIL p ON p.id = m.profile_id
           WHERE m.id = ?`,
        )
        .get(patientInOtherClinic),
    ).toEqual({ name: "Paciente" });
  });

  it("authenticates demo accounts and returns the active clinic", async () => {
    const cookie = await login("admin@qiconect.local", "Admin123!");
    const response = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie } });
    const payload = await response.json() as { activeClinic: { name: string; role: string } };

    expect(response.status).toBe(200);
    expect(payload.activeClinic.name).toBe("Clínica QIConect");
    expect(payload.activeClinic.role).toBe("CLINIC_ADMIN");
    const loginStamp = db.prepare("SELECT dt_ult_acesso FROM USUARIO WHERE email = ?").get("admin@qiconect.local") as {
      dt_ult_acesso: string | null;
    };
    expect(loginStamp.dt_ult_acesso).toBeTruthy();
  });

  it("filters dashboard appointments by clinic date and returns the therapy protocols", async () => {
    const adminCookie = await login("admin@qiconect.local", "Admin123!");
    const patientCookie = await login(demoPatient.email, demoPatient.password);
    const clinic = db.prepare(
      `SELECT c.id, c.timezone FROM CLINICA c
       JOIN memberships m ON m.clinic_id = c.id
       JOIN USUARIO u ON u.id = m.user_id
       WHERE u.email = 'admin@qiconect.local' LIMIT 1`,
    ).get() as { id: string; timezone: string };
    const patient = db.prepare(
      `SELECT m.id FROM memberships m JOIN USUARIO u ON u.id = m.user_id
       WHERE u.email = ? AND m.clinic_id = ?`,
    ).get(demoPatient.email, clinic.id) as { id: string };
    const therapist = db.prepare(
      `SELECT m.id FROM memberships m JOIN USUARIO u ON u.id = m.user_id
       WHERE u.email = 'terapeuta@qiconect.local' AND m.clinic_id = ?`,
    ).get(clinic.id) as { id: string };
    const therapy = db.prepare("SELECT id FROM TERAPIA WHERE clinic_id = ? LIMIT 1").get(clinic.id) as { id: string };
    const clinicDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: clinic.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const startsAt = new Date(`${clinicDate}T12:00:00.000Z`);
    const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
    const createdAt = new Date().toISOString();
    const appointmentId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO AGENDA
       (id, clinic_id, patient_membership_id, therapist_membership_id, terapia_id, dt_inicio, dt_fim, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?)`,
    ).run(
      appointmentId, clinic.id, patient.id, therapist.id, therapy.id,
      startsAt.toISOString(), endsAt.toISOString(), createdAt, createdAt,
    );

    const createProtocol = await fetch(`${baseUrl}/api/v1/registrations/protocol`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({
        therapyId: therapy.id,
        name: "Protocolo da agenda",
        description: "Protocolo exibido pela visão geral",
        objective: "Validar vínculo com a terapia",
        active: true,
      }),
    });
    expect(createProtocol.status).toBe(201);
    const protocol = await createProtocol.json() as { id: string };
    const createStep = await fetch(`${baseUrl}/api/v1/registrations/protocol-steps`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ protocolId: protocol.id, sequence: 1, description: "Etapa de avaliação" }),
    });
    expect(createStep.status).toBe(201);

    const createChart = await fetch(`${baseUrl}/api/v1/registrations/chart`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ patientId: patient.id, openedAt: clinicDate }),
    });
    expect(createChart.status).toBe(201);
    const chart = await createChart.json() as { id: string };
    const createOlderEncounter = await fetch(`${baseUrl}/api/v1/registrations/encounter`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({
        chartId: chart.id,
        therapistId: therapist.id,
        therapyId: therapy.id,
        attendedAt: new Date(startsAt.getTime() - 24 * 60 * 60_000).toISOString(),
        status: "COMPLETED",
      }),
    });
    expect(createOlderEncounter.status).toBe(201);
    const createEncounter = await fetch(`${baseUrl}/api/v1/registrations/encounter`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({
        chartId: chart.id,
        therapistId: therapist.id,
        therapyId: therapy.id,
        appointmentId,
        attendedAt: startsAt.toISOString(),
        status: "COMPLETED",
      }),
    });
    expect(createEncounter.status).toBe(201);
    const encounter = await createEncounter.json() as { id: string };

    const dashboardResponse = await fetch(
      `${baseUrl}/api/v1/dashboard?date=${encodeURIComponent(clinicDate)}`,
      { headers: { cookie: adminCookie } },
    );
    expect(dashboardResponse.status).toBe(200);
    const dashboard = await dashboardResponse.json() as {
      selectedDate: string;
      appointmentsForDate: Array<{
        id: string;
        therapyId: string;
        patientName: string;
        therapistName: string;
      }>;
    };
    expect(dashboard.selectedDate).toBe(clinicDate);
    expect(dashboard.appointmentsForDate).toContainEqual(expect.objectContaining({
      id: appointmentId,
      therapyId: therapy.id,
      patientName: "Joana Paciente",
      therapistName: "Ana Terapeuta",
    }));

    const patientDashboard = await fetch(
      `${baseUrl}/api/v1/dashboard?date=${encodeURIComponent(clinicDate)}`,
      { headers: { cookie: patientCookie } },
    );
    const patientData = await patientDashboard.json() as {
      appointmentsForDate: Array<{ id: string }>;
      lastEncounter: { id: string; attendedAt: string; therapyId: string; therapyName: string } | null;
    };
    expect(patientData.appointmentsForDate).toEqual([expect.objectContaining({ id: appointmentId })]);
    expect(patientData.lastEncounter).toEqual(expect.objectContaining({
      id: encounter.id,
      therapyId: therapy.id,
      therapyName: expect.any(String),
    }));

    const otherDate = new Date(`${clinicDate}T00:00:00.000Z`);
    otherDate.setUTCDate(otherDate.getUTCDate() + 1);
    const emptyDay = await fetch(
      `${baseUrl}/api/v1/dashboard?date=${otherDate.toISOString().slice(0, 10)}`,
      { headers: { cookie: adminCookie } },
    );
    const emptyDayData = await emptyDay.json() as { appointmentsForDate: unknown[] };
    expect(emptyDayData.appointmentsForDate).toHaveLength(0);

    const protocolsResponse = await fetch(
      `${baseUrl}/api/v1/dashboard/therapies/${therapy.id}/protocols`,
      { headers: { cookie: patientCookie } },
    );
    expect(protocolsResponse.status).toBe(200);
    const protocolData = await protocolsResponse.json() as {
      protocols: Array<{ id: string; name: string; steps: Array<{ description: string }> }>;
    };
    expect(protocolData.protocols).toContainEqual(expect.objectContaining({
      id: protocol.id,
      name: "Protocolo da agenda",
      steps: [expect.objectContaining({ description: "Etapa de avaliação" })],
    }));

    const encounterProtocolsResponse = await fetch(
      `${baseUrl}/api/v1/dashboard/encounters/${encounter.id}/protocols`,
      { headers: { cookie: patientCookie } },
    );
    expect(encounterProtocolsResponse.status).toBe(200);
    const encounterProtocolData = await encounterProtocolsResponse.json() as {
      protocols: Array<{ id: string; name: string; steps: Array<{ description: string }> }>;
    };
    expect(encounterProtocolData.protocols).toContainEqual(expect.objectContaining({
      id: protocol.id,
      name: "Protocolo da agenda",
      steps: [expect.objectContaining({ description: "Etapa de avaliação" })],
    }));

    const unownedEncounterResponse = await fetch(
      `${baseUrl}/api/v1/dashboard/encounters/${crypto.randomUUID()}/protocols`,
      { headers: { cookie: patientCookie } },
    );
    expect(unownedEncounterResponse.status).toBe(404);
  });

  it("creates patient profiles with workbook identifiers", async () => {
    const cookie = await login("terapeuta@qiconect.local", "Terapeuta123!");
    const response = await fetch(`${baseUrl}/api/v1/patients`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        fullName: "Paciente de teste",
        email: "paciente.novo@qiconect.local",
        phone: "+5511999999999",
        password: "SenhaSegura123!",
      }),
    });
    expect(response.status).toBe(201);
    const payload = await response.json() as { membershipId: string };
    const patient = db
      .prepare(
        `SELECT p.id, p.usuario_id AS userId, p.clinica_id AS clinicId, p.ativo,
                m.user_id AS expectedUserId, m.clinic_id AS expectedClinicId
         FROM PACIENTE p JOIN memberships m ON m.id = p.membership_id
         WHERE p.membership_id = ?`,
      )
      .get(payload.membershipId) as {
      id: string;
      userId: string;
      clinicId: string;
      ativo: number;
      expectedUserId: string;
      expectedClinicId: string;
    };
    expect(patient.id).toBeTruthy();
    expect(patient.userId).toBe(patient.expectedUserId);
    expect(patient.clinicId).toBe(patient.expectedClinicId);
    expect(patient.ativo).toBe(1);
  });

  it("persists workbook registration forms and protects them from non-admin roles", async () => {
    const adminCookie = await login("admin@qiconect.local", "Admin123!");
    const patientCookie = await login(demoPatient.email, demoPatient.password);
    const forbidden = await fetch(`${baseUrl}/api/v1/registrations/options`, { headers: { cookie: patientCookie } });
    expect(forbidden.status).toBe(403);

    const optionsResponse = await fetch(`${baseUrl}/api/v1/registrations/options`, { headers: { cookie: adminCookie } });
    expect(optionsResponse.status).toBe(200);
    const { options } = await optionsResponse.json() as {
      options: {
        patients: Array<{ value: string; label: string }>;
        therapists: Array<{ value: string; label: string }>;
        therapies: Array<{ value: string; label: string }>;
      };
    };
    expect(options.patients.length).toBeGreaterThan(0);
    expect(options.therapists.length).toBeGreaterThan(0);
    expect(options.therapies.length).toBeGreaterThan(0);

    const createPatient = await fetch(`${baseUrl}/api/v1/registrations/patient`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({
        fullName: "Paciente cadastrado pela tela",
        email: "registro.paciente@qiconect.local",
        phone: "+5511999999990",
        password: "SenhaSegura123!",
        cpf: "987.654.321-00",
        birthDate: "1990-04-12",
        sex: "F",
        address: "Rua de teste, 10",
      }),
    });
    expect(createPatient.status).toBe(201);
    const createdPatient = await createPatient.json() as { id: string };
    const savedPatient = db.prepare(
      `SELECT p.cpf, p.dt_nasc AS birthDate, p.sexo AS sex, p.endereco AS address,
              u.password_hash AS passwordHash
       FROM PACIENTE p JOIN USUARIO u ON u.id = p.usuario_id
       WHERE p.membership_id = ?`,
    ).get(createdPatient.id) as { cpf: string; birthDate: string; sex: string; address: string; passwordHash: string };
    expect(savedPatient).toMatchObject({
      cpf: "987.654.321-00",
      birthDate: "1990-04-12",
      sex: "F",
      address: "Rua de teste, 10",
    });
    expect(savedPatient.passwordHash).not.toBe("SenhaSegura123!");

    const protocol = await fetch(`${baseUrl}/api/v1/registrations/protocol`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({
        therapyId: options.therapies[0].value,
        therapistId: options.therapists[0].value,
        name: "Protocolo de validação",
        description: "Descrição do protocolo",
        objective: "Objetivo de validação",
        active: true,
      }),
    });
    expect(protocol.status).toBe(201);
    const createdProtocol = await protocol.json() as { id: string };

    const step = await fetch(`${baseUrl}/api/v1/registrations/protocol-steps`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({
        protocolId: createdProtocol.id,
        sequence: 1,
        description: "Etapa inicial",
      }),
    });
    expect(step.status).toBe(201);

    const therapistId = options.therapists[0].value;
    const diagnosis = await fetch(`${baseUrl}/api/v1/registrations/diagnosis`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({
        patientId: createdPatient.id,
        therapistId,
        description: "Diagnóstico de validação",
        diagnosedAt: new Date().toISOString().slice(0, 10),
      }),
    });
    const createdDiagnosis = await diagnosis.json() as { id: string };
    expect(diagnosis.status, JSON.stringify(createdDiagnosis)).toBe(201);

    const attachDiagnosis = await fetch(`${baseUrl}/api/v1/registrations/protocol/${createdProtocol.id}`, {
      method: "PATCH",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ diagnosisId: createdDiagnosis.id }),
    });
    expect(attachDiagnosis.status).toBe(200);

    const evolutionOptions = await fetch(`${baseUrl}/api/v1/registrations/options`, { headers: { cookie: adminCookie } });
    const linkedOptions = await evolutionOptions.json() as { options: { diagnosisProtocols: Array<{ value: string }> } };
    expect(linkedOptions.options.diagnosisProtocols).toHaveLength(1);

    const evolution = await fetch(`${baseUrl}/api/v1/registrations/evolution`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({
        diagnosisProtocolId: linkedOptions.options.diagnosisProtocols[0].value,
        description: "Paciente apresenta melhora",
        evolvedAt: new Date().toISOString().slice(0, 10),
        status: "IN_PROGRESS",
      }),
    });
    expect(evolution.status).toBe(201);
    const createdEvolution = await evolution.json() as { id: string };
    const listEvolution = await fetch(`${baseUrl}/api/v1/registrations/evolution`, { headers: { cookie: adminCookie } });
    const evolutionRows = await listEvolution.json() as { records: Array<{ id: string; description: string }> };
    expect(evolutionRows.records).toContainEqual(expect.objectContaining({
      id: createdEvolution.id,
      description: "Paciente apresenta melhora",
    }));

    const chart = db.prepare("SELECT id FROM PRONTUARIO WHERE patient_membership_id = ?").get(createdPatient.id) as { id: string };
    const encounter = await fetch(`${baseUrl}/api/v1/registrations/encounter`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({
        chartId: chart.id,
        therapistId,
        therapyId: options.therapies[0].value,
        attendedAt: new Date().toISOString(),
        status: "COMPLETED",
        notes: "Atendimento de validação",
      }),
    });
    expect(encounter.status).toBe(201);

    const specialty = await fetch(`${baseUrl}/api/v1/registrations/specialty`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Especialidade de validação", description: "Descrição preservada", active: true }),
    });
    expect(specialty.status).toBe(201);
    const createdSpecialty = await specialty.json() as { id: string };
    const createTherapist = await fetch(`${baseUrl}/api/v1/registrations/therapist`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({
        fullName: "Terapeuta cadastrada pela tela",
        email: "registro.terapeuta@qiconect.local",
        phone: "+5511999999991",
        password: "SenhaSegura123!",
        cpf: "123.987.456-00",
        professionalRegistration: "CRT-TESTE",
        formation: "Formação de teste",
        specialtyIds: [createdSpecialty.id],
        therapyIds: [options.therapies[0].value],
      }),
    });
    expect(createTherapist.status).toBe(201);
    const createdTherapist = await createTherapist.json() as { id: string };
    expect(
      db.prepare(
        `SELECT s.nome AS specialtyName
         FROM TERAPEUTA_ESPECIALIDADE ts
         JOIN ESPECIALIDADE s ON s.id = ts.especialidade_id
         WHERE ts.therapist_membership_id = ?`,
      ).get(createdTherapist.id),
    ).toEqual({ specialtyName: "Especialidade de validação" });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM therapist_therapies WHERE membership_id = ?").get(createdTherapist.id),
    ).toEqual({ count: 1 });

    const deactivateSpecialty = await fetch(`${baseUrl}/api/v1/registrations/specialty/${createdSpecialty.id}`, {
      method: "PATCH",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    expect(deactivateSpecialty.status).toBe(200);
    expect(
      db.prepare("SELECT descricao AS description, ativo AS active FROM ESPECIALIDADE WHERE id = ?").get(createdSpecialty.id),
    ).toEqual({ description: "Descrição preservada", active: 0 });

    for (const resource of [
      "clinic", "user", "patient", "therapist", "specialty", "therapy",
      "protocol", "diagnosis", "evolution", "agenda", "encounter", "chart",
    ]) {
      const response = await fetch(`${baseUrl}/api/v1/registrations/${resource}`, { headers: { cookie: adminCookie } });
      expect(response.status, resource).toBe(200);
    }

    const deactivatePatient = await fetch(`${baseUrl}/api/v1/registrations/patient/${createdPatient.id}`, {
      method: "PATCH",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    expect(deactivatePatient.status).toBe(200);
    expect(db.prepare(
      `SELECT p.ativo AS profileActive, u.ativo AS accountActive, m.status AS membershipStatus,
              (SELECT COUNT(*) FROM DIAGNOSTICO WHERE patient_membership_id = p.membership_id) AS diagnosisCount
       FROM PACIENTE p JOIN USUARIO u ON u.id = p.usuario_id
       JOIN memberships m ON m.id = p.membership_id
       WHERE p.membership_id = ?`,
    ).get(createdPatient.id)).toEqual({
      profileActive: 0,
      accountActive: 0,
      membershipStatus: "SUSPENDED",
      diagnosisCount: 1,
    });

    const restorePatient = await fetch(`${baseUrl}/api/v1/registrations/patient/${createdPatient.id}`, {
      method: "PATCH",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    expect(restorePatient.status).toBe(200);
  });

  it("archives clinics only when the administrator can restore them from another active clinic", async () => {
    const adminCookie = await login("admin@qiconect.local", "Admin123!");
    const clinicResponse = await fetch(`${baseUrl}/api/v1/registrations/clinic`, { headers: { cookie: adminCookie } });
    const clinicPayload = await clinicResponse.json() as { records: Array<{ id: string }> };
    const clinicId = clinicPayload.records[0].id;

    const blockedArchive = await fetch(`${baseUrl}/api/v1/registrations/clinic/${clinicId}`, {
      method: "PATCH",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    expect(blockedArchive.status).toBe(409);
    expect(db.prepare("SELECT ativo AS active FROM CLINICA WHERE id = ?").get(clinicId)).toEqual({ active: 1 });

    const createClinic = await fetch(`${baseUrl}/api/v1/registrations/clinic`, {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Clínica de recuperação", timezone: "America/Sao_Paulo" }),
    });
    expect(createClinic.status).toBe(201);
    const createdClinic = await createClinic.json() as { id: string };
    expect(db.prepare(
      "SELECT role, status FROM memberships WHERE clinic_id = ? AND user_id = (SELECT id FROM USUARIO WHERE email = ?)",
    ).get(createdClinic.id, "admin@qiconect.local")).toEqual({ role: "CLINIC_ADMIN", status: "ACTIVE" });

    const archive = await fetch(`${baseUrl}/api/v1/registrations/clinic/${clinicId}`, {
      method: "PATCH",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    expect(archive.status).toBe(200);
    expect(db.prepare("SELECT ativo AS active FROM CLINICA WHERE id = ?").get(clinicId)).toEqual({ active: 0 });

    const recoveryCookie = await login("admin@qiconect.local", "Admin123!");
    const archivedResponse = await fetch(`${baseUrl}/api/v1/registrations/archived-clinics`, {
      headers: { cookie: recoveryCookie },
    });
    const archivedPayload = await archivedResponse.json() as { clinics: Array<{ id: string; name: string }> };
    expect(archivedPayload.clinics).toContainEqual({ id: clinicId, name: "Clínica QIConect" });

    const restore = await fetch(`${baseUrl}/api/v1/registrations/clinic/${clinicId}/restore`, {
      method: "POST",
      headers: { cookie: recoveryCookie },
    });
    expect(restore.status).toBe(200);
    expect(db.prepare("SELECT ativo AS active FROM CLINICA WHERE id = ?").get(clinicId)).toEqual({ active: 1 });
  });

  it("does not expose patients across clinic boundaries", async () => {
    const otherClinicCookie = await login("paciente@outraclinica.local", "OutraSenha123!");
    const listResponse = await fetch(`${baseUrl}/api/v1/patients`, { headers: { cookie: otherClinicCookie } });
    const listPayload = await listResponse.json() as { patients: Array<{ membershipId: string }> };
    expect(listPayload.patients).toHaveLength(1);
    expect(listPayload.patients[0].membershipId).toBe(patientInOtherClinic);

    const crossClinicResponse = await fetch(`${baseUrl}/api/v1/patients/${patientInOtherClinic}`, {
      headers: { cookie: await login(demoPatient.email, demoPatient.password) },
    });
    expect(crossClinicResponse.status).toBe(403);

    const therapist = db.prepare("SELECT id FROM memberships WHERE role = 'THERAPIST' AND clinic_id = (SELECT id FROM CLINICA WHERE slug = 'qiconect-demo')").get() as { id: string };
    const availabilityResponse = await fetch(`${baseUrl}/api/v1/availability`, {
      method: "POST",
      headers: { cookie: otherClinicCookie, "content-type": "application/json" },
      body: JSON.stringify({ therapistMembershipId: therapist.id, weekday: 1, startsAt: "08:00", endsAt: "09:00" }),
    });
    expect(availabilityResponse.status).toBe(403);
  });

  it("prevents double booking and records cancellation notices", async () => {
    const cookie = await login(demoPatient.email, demoPatient.password);
    const therapist = db.prepare("SELECT id FROM memberships WHERE role = 'THERAPIST' AND clinic_id = (SELECT id FROM CLINICA WHERE slug = 'qiconect-demo')").get() as { id: string };
    const therapy = db.prepare("SELECT id FROM TERAPIA WHERE clinic_id = (SELECT id FROM CLINICA WHERE slug = 'qiconect-demo')").get() as { id: string };
    const body = {
      therapistMembershipId: therapist.id,
      therapyId: therapy.id,
      startsAt: nextWeekdayAtTen(),
    };

    const first = await fetch(`${baseUrl}/api/v1/appointments`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(201);
    const created = await first.json() as { appointment: { id: string } };

    const duplicate = await fetch(`${baseUrl}/api/v1/appointments`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(duplicate.status).toBe(409);

    const rescheduledAt = new Date(new Date(body.startsAt).getTime() + 60 * 60 * 1000).toISOString();
    const reschedule = await fetch(`${baseUrl}/api/v1/appointments/${created.appointment.id}/reschedule`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ startsAt: rescheduledAt }),
    });
    expect(reschedule.status).toBe(200);
    const updated = await reschedule.json() as { appointment: { startsAt: string } };
    expect(updated.appointment.startsAt).toBe(rescheduledAt);

    const cancellation = await fetch(`${baseUrl}/api/v1/appointments/${created.appointment.id}/cancel`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
    });
    expect(cancellation.status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE event = 'APPOINTMENT_CANCELLED'").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE event = 'APPOINTMENT_CONFIRMED'").get()).toEqual({ count: 4 });
  });
});

import { useEffect, useState, type FormEvent } from "react";
import logoImage from "../../../../../Documentacao/Logo1.png";
import { ApiError, apiRequest, type Session } from "../../lib/api.js";

export type RegistrationId =
  | "clinic"
  | "user"
  | "patient"
  | "therapist"
  | "specialty"
  | "therapy"
  | "protocol"
  | "diagnosis"
  | "evolution"
  | "agenda"
  | "encounter"
  | "chart";

interface RegistrationRecord extends Record<string, unknown> {
  id: string;
}

interface SelectOption {
  value: string;
  label: string;
}

type FieldType = "text" | "email" | "tel" | "password" | "date" | "datetime-local" | "number" | "textarea" | "select" | "multiselect" | "checkbox";

interface FieldDefinition {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  optionsKey?: string;
  options?: SelectOption[];
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

interface ResourceDefinition {
  title: string;
  description: string;
  fields: FieldDefinition[];
  columns: Array<{ key: string; label: string }>;
}

type RegistrationOptions = Record<string, SelectOption[]>;

const choice = (value: string, label: string): SelectOption => ({ value, label });
const encounterStatusChoices = [
  choice("ACTIVE", "Ativo"),
  choice("COMPLETED", "Concluído"),
  choice("CANCELLED", "Cancelado"),
];
const evolutionStatusChoices = [
  choice("IN_PROGRESS", "Em andamento"),
  choice("COMPLETED", "Concluído"),
  choice("CANCELLED", "Cancelado"),
];

const definitions: Record<RegistrationId, ResourceDefinition> = {
  clinic: {
    title: "Clínica",
    description: "Dados cadastrais da clínica ativa.",
    fields: [
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "cnpj", label: "CNPJ", type: "text" },
      { name: "email", label: "E-mail", type: "email" },
      { name: "phone", label: "Telefone", type: "tel" },
      { name: "address", label: "Endereço", type: "text" },
      { name: "timezone", label: "Fuso horário", type: "text", required: true },
    ],
    columns: [
      { key: "name", label: "Clínica" },
      { key: "cnpj", label: "CNPJ" },
      { key: "email", label: "E-mail" },
      { key: "phone", label: "Telefone" },
      { key: "active", label: "Status" },
    ],
  },
  user: {
    title: "Usuário",
    description: "Contas e perfis vinculados à clínica.",
    fields: [
      { name: "fullName", label: "Nome completo", type: "text", required: true },
      { name: "email", label: "E-mail", type: "email", required: true },
      { name: "phone", label: "Telefone", type: "tel" },
      { name: "role", label: "Perfil", type: "select", optionsKey: "profiles", required: true },
      { name: "password", label: "Senha inicial / nova senha", type: "password", hint: "Mínimo de 10 caracteres. Senhas nunca são exibidas após o cadastro." },
    ],
    columns: [
      { key: "fullName", label: "Usuário" },
      { key: "email", label: "E-mail" },
      { key: "profileName", label: "Perfil" },
      { key: "active", label: "Status" },
    ],
  },
  patient: {
    title: "Paciente",
    description: "Dados pessoais e acesso do paciente.",
    fields: [
      { name: "fullName", label: "Nome completo", type: "text", required: true },
      { name: "email", label: "E-mail", type: "email", required: true },
      { name: "phone", label: "Telefone", type: "tel" },
      { name: "cpf", label: "CPF", type: "text" },
      { name: "birthDate", label: "Data de nascimento", type: "date" },
      {
        name: "sex",
        label: "Sexo",
        type: "select",
        options: [choice("F", "Feminino"), choice("M", "Masculino"), choice("OTHER", "Outro"), choice("UNSPECIFIED", "Não informado")],
      },
      { name: "address", label: "Endereço", type: "text" },
      { name: "password", label: "Senha inicial", type: "password", hint: "Mínimo de 10 caracteres. Compartilhe a senha com segurança." },
    ],
    columns: [
      { key: "fullName", label: "Paciente" },
      { key: "cpf", label: "CPF" },
      { key: "email", label: "E-mail" },
      { key: "phone", label: "Telefone" },
      { key: "birthDate", label: "Nascimento" },
      { key: "active", label: "Status" },
    ],
  },
  therapist: {
    title: "Terapeuta",
    description: "Dados profissionais e acesso do terapeuta.",
    fields: [
      { name: "fullName", label: "Nome completo", type: "text", required: true },
      { name: "email", label: "E-mail", type: "email", required: true },
      { name: "phone", label: "Telefone", type: "tel" },
      { name: "cpf", label: "CPF", type: "text" },
      { name: "professionalRegistration", label: "Registro profissional", type: "text" },
      { name: "formation", label: "Formação", type: "textarea" },
      { name: "specialtyIds", label: "Especialidades", type: "multiselect", optionsKey: "specialties" },
      { name: "therapyIds", label: "Terapias habilitadas para agendamento", type: "multiselect", optionsKey: "therapies" },
      { name: "password", label: "Senha inicial", type: "password", hint: "Mínimo de 10 caracteres. Compartilhe a senha com segurança." },
    ],
    columns: [
      { key: "fullName", label: "Terapeuta" },
      { key: "cpf", label: "CPF" },
      { key: "professionalRegistration", label: "Registro" },
      { key: "formation", label: "Formação" },
      { key: "specialties", label: "Especialidades" },
      { key: "therapies", label: "Terapias" },
      { key: "active", label: "Status" },
    ],
  },
  specialty: {
    title: "Especialidade",
    description: "Especialidades oferecidas pela clínica.",
    fields: [
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "description", label: "Descrição", type: "textarea" },
      { name: "active", label: "Ativa", type: "checkbox" },
    ],
    columns: [
      { key: "name", label: "Especialidade" },
      { key: "description", label: "Descrição" },
      { key: "active", label: "Status" },
    ],
  },
  therapy: {
    title: "Terapia",
    description: "Serviços, especialidade vinculada e duração.",
    fields: [
      { name: "specialtyId", label: "Especialidade", type: "select", optionsKey: "specialties", required: true },
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "description", label: "Descrição", type: "textarea" },
      { name: "durationMinutes", label: "Duração (minutos)", type: "number", min: 10, max: 480, step: 5, required: true },
      { name: "active", label: "Ativa", type: "checkbox" },
    ],
    columns: [
      { key: "name", label: "Terapia" },
      { key: "specialtyName", label: "Especialidade" },
      { key: "description", label: "Descrição" },
      { key: "durationMinutes", label: "Duração" },
      { key: "active", label: "Status" },
    ],
  },
  protocol: {
    title: "Protocolo",
    description: "Protocolos, objetivos, equipe e etapas de atendimento.",
    fields: [
      { name: "therapyId", label: "Terapia", type: "select", optionsKey: "therapies", required: true },
      { name: "therapistId", label: "Terapeuta responsável", type: "select", optionsKey: "therapists" },
      { name: "diagnosisId", label: "Diagnóstico relacionado", type: "select", optionsKey: "diagnoses" },
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "description", label: "Descrição", type: "textarea" },
      { name: "objective", label: "Objetivo", type: "textarea" },
      { name: "active", label: "Ativo", type: "checkbox" },
    ],
    columns: [
      { key: "name", label: "Protocolo" },
      { key: "therapyName", label: "Terapia" },
      { key: "therapistName", label: "Terapeuta" },
      { key: "diagnosisDescription", label: "Diagnóstico" },
      { key: "active", label: "Status" },
    ],
  },
  diagnosis: {
    title: "Diagnóstico",
    description: "Diagnósticos vinculados ao paciente e ao terapeuta responsável.",
    fields: [
      { name: "patientId", label: "Paciente", type: "select", optionsKey: "patients", required: true },
      { name: "therapistId", label: "Terapeuta", type: "select", optionsKey: "therapists", required: true },
      { name: "description", label: "Descrição", type: "textarea", required: true },
      { name: "diagnosedAt", label: "Data do diagnóstico", type: "date", required: true },
    ],
    columns: [
      { key: "patientName", label: "Paciente" },
      { key: "therapistName", label: "Terapeuta" },
      { key: "description", label: "Diagnóstico" },
      { key: "diagnosedAt", label: "Data" },
    ],
  },
  evolution: {
    title: "Evolução",
    description: "Registros de evolução vinculados a diagnóstico e etapa de protocolo.",
    fields: [
      { name: "diagnosisProtocolId", label: "Diagnóstico / etapa do protocolo", type: "select", optionsKey: "diagnosisProtocols", required: true },
      { name: "description", label: "Descrição", type: "textarea", required: true },
      { name: "evolvedAt", label: "Data da evolução", type: "date", required: true },
      { name: "status", label: "Status", type: "select", options: evolutionStatusChoices, required: true },
    ],
    columns: [
      { key: "diagnosisDescription", label: "Diagnóstico" },
      { key: "protocolName", label: "Protocolo" },
      { key: "description", label: "Evolução" },
      { key: "evolvedAt", label: "Data" },
      { key: "status", label: "Status" },
    ],
  },
  agenda: {
    title: "Agenda",
    description: "Agendamentos com validação de disponibilidade e conflitos.",
    fields: [
      { name: "patientId", label: "Paciente", type: "select", optionsKey: "patients", required: true },
      { name: "therapistId", label: "Terapeuta", type: "select", optionsKey: "therapists", required: true },
      { name: "therapyId", label: "Terapia", type: "select", optionsKey: "therapies", required: true },
      { name: "startsAt", label: "Data e horário", type: "datetime-local", required: true },
    ],
    columns: [
      { key: "patientName", label: "Paciente" },
      { key: "therapistName", label: "Terapeuta" },
      { key: "therapyName", label: "Terapia" },
      { key: "startsAt", label: "Início" },
      { key: "endsAt", label: "Fim" },
      { key: "status", label: "Status" },
    ],
  },
  encounter: {
    title: "Atendimento",
    description: "Atendimentos realizados e seus vínculos clínicos.",
    fields: [
      { name: "chartId", label: "Prontuário", type: "select", optionsKey: "charts", required: true },
      { name: "therapistId", label: "Terapeuta", type: "select", optionsKey: "therapists", required: true },
      { name: "therapyId", label: "Terapia", type: "select", optionsKey: "therapies", required: true },
      { name: "appointmentId", label: "Agendamento relacionado", type: "select", optionsKey: "appointments" },
      { name: "attendedAt", label: "Data e horário", type: "datetime-local", required: true },
      { name: "status", label: "Status", type: "select", options: encounterStatusChoices, required: true },
      { name: "notes", label: "Observações", type: "textarea" },
    ],
    columns: [
      { key: "patientName", label: "Paciente" },
      { key: "therapistName", label: "Terapeuta" },
      { key: "therapyName", label: "Terapia" },
      { key: "attendedAt", label: "Data" },
      { key: "status", label: "Status" },
    ],
  },
  chart: {
    title: "Prontuário",
    description: "Abertura e situação do prontuário de cada paciente.",
    fields: [
      { name: "patientId", label: "Paciente", type: "select", optionsKey: "patientsWithoutChart", required: true },
      { name: "openedAt", label: "Data de abertura", type: "date", required: true },
      { name: "status", label: "Status", type: "select", options: [
        choice("ACTIVE", "Ativo"),
        choice("CLOSED", "Encerrado"),
        choice("ARCHIVED", "Arquivado"),
      ], required: true },
    ],
    columns: [
      { key: "patientName", label: "Paciente" },
      { key: "openedAt", label: "Abertura" },
      { key: "status", label: "Status" },
    ],
  },
};

const recordLabels: Record<RegistrationId, { singular: string; plural: string; create: string }> = {
  clinic: { singular: "clínica", plural: "clínicas", create: "Nova clínica" },
  user: { singular: "usuário", plural: "usuários", create: "Novo usuário" },
  patient: { singular: "paciente", plural: "pacientes", create: "Novo paciente" },
  therapist: { singular: "terapeuta", plural: "terapeutas", create: "Novo terapeuta" },
  specialty: { singular: "especialidade", plural: "especialidades", create: "Nova especialidade" },
  therapy: { singular: "terapia", plural: "terapias", create: "Nova terapia" },
  protocol: { singular: "protocolo", plural: "protocolos", create: "Novo protocolo" },
  diagnosis: { singular: "diagnóstico", plural: "diagnósticos", create: "Novo diagnóstico" },
  evolution: { singular: "evolução", plural: "evoluções", create: "Nova evolução" },
  agenda: { singular: "agendamento", plural: "agendamentos", create: "Novo agendamento" },
  encounter: { singular: "atendimento", plural: "atendimentos", create: "Novo atendimento" },
  chart: { singular: "prontuário", plural: "prontuários", create: "Novo prontuário" },
};

function initialForm(resource: RegistrationId): Record<string, string | boolean | string[]> {
  const form: Record<string, string | boolean | string[]> = {};
  for (const field of definitions[resource].fields) {
    if (field.type === "checkbox") form[field.name] = true;
    else if (field.type === "multiselect") form[field.name] = [];
    else if (field.name === "status") form[field.name] = field.options?.[0]?.value ?? "";
    else if (field.type === "date") form[field.name] = field.name === "birthDate" ? "" : new Date().toISOString().slice(0, 10);
    else form[field.name] = "";
  }
  return form;
}

function normalizeDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  const brDate = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (brDate) return `${brDate[3]}-${brDate[2]}-${brDate[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 0 && serial < 100_000) {
      return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
    }
  }
  return "";
}

function toFormValue(field: FieldDefinition, value: unknown): string | boolean | string[] {
  if (field.type === "checkbox") return value === true || value === 1;
  if (field.type === "multiselect") {
    if (Array.isArray(value)) return value.map(String);
    return typeof value === "string" && value ? value.split(",").filter(Boolean) : [];
  }
  if (value == null) return "";
  if (field.type === "datetime-local") {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) {
      return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    }
  }
  if (field.type === "date") return normalizeDate(value);
  return String(value);
}

function displayValue(value: unknown, key: string): string {
  if (value == null || value === "") return "—";
  if (key === "active") return value === true || value === 1 ? "Ativo" : "Inativo";
  if (["birthDate", "diagnosedAt", "evolvedAt", "openedAt"].includes(key)) {
    const date = normalizeDate(value);
    return date
      ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))
      : String(value);
  }
  if (["startsAt", "endsAt", "attendedAt", "lastLoginAt", "createdAt", "updatedAt"].includes(key)) {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        ...(key === "startsAt" || key === "endsAt" || key === "attendedAt" ? { timeStyle: "short" as const } : {}),
      }).format(date);
    }
  }
  const statusLabels: Record<string, string> = {
    ACTIVE: "Ativo",
    CONFIRMED: "Confirmado",
    CANCELLED: "Cancelado",
    COMPLETED: "Concluído",
    NO_SHOW: "Não compareceu",
    IN_PROGRESS: "Em andamento",
    CLOSED: "Encerrado",
    ARCHIVED: "Arquivado",
    SUSPENDED: "Suspenso",
  };
  return statusLabels[String(value)] ?? String(value);
}

function actionErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Não foi possível concluir a operação.";
}

interface RegistrationPageProps {
  resource: RegistrationId;
  session: Session;
}

export function RegistrationPage({ resource, session }: RegistrationPageProps) {
  const definition = definitions[resource];
  const [records, setRecords] = useState<RegistrationRecord[]>([]);
  const [options, setOptions] = useState<RegistrationOptions>({});
  const [archivedClinics, setArchivedClinics] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState<Record<string, string | boolean | string[]>>(() => initialForm(resource));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedProtocolId, setSelectedProtocolId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  async function load() {
    const archivedClinicsRequest = resource === "clinic"
      ? apiRequest<{ clinics: Array<{ id: string; name: string }> }>("/registrations/archived-clinics")
      : Promise.resolve({ clinics: [] as Array<{ id: string; name: string }> });
    const [recordResult, optionResult, archivedClinicsResult] = await Promise.all([
      apiRequest<{ records: RegistrationRecord[] }>(`/registrations/${resource}`),
      apiRequest<{ options: RegistrationOptions }>("/registrations/options"),
      archivedClinicsRequest,
    ]);
    setRecords(recordResult.records);
    setOptions(optionResult.options);
    setArchivedClinics(archivedClinicsResult.clinics);
    if (resource === "clinic" && recordResult.records[0]) {
      const clinic = recordResult.records[0];
      setEditingId(clinic.id);
      setForm(Object.fromEntries(definition.fields.map((field) => [field.name, toFormValue(field, clinic[field.name])])) as Record<string, string | boolean | string[]>);
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setNotice("");
    setEditingId(null);
    setSelectedProtocolId("");
    setForm(initialForm(resource));
    setArchivedClinics([]);
    const archivedClinicsRequest = resource === "clinic"
      ? apiRequest<{ clinics: Array<{ id: string; name: string }> }>("/registrations/archived-clinics")
      : Promise.resolve({ clinics: [] as Array<{ id: string; name: string }> });
    Promise.all([
      apiRequest<{ records: RegistrationRecord[] }>(`/registrations/${resource}`),
      apiRequest<{ options: RegistrationOptions }>("/registrations/options"),
      archivedClinicsRequest,
    ]).then(([recordResult, optionResult, archivedClinicsResult]) => {
      if (!active) return;
      setRecords(recordResult.records);
      setOptions(optionResult.options);
      setArchivedClinics(archivedClinicsResult.clinics);
      if (resource === "clinic" && recordResult.records[0]) {
        const clinic = recordResult.records[0];
        setEditingId(clinic.id);
        setForm(Object.fromEntries(definition.fields.map((field) => [field.name, toFormValue(field, clinic[field.name])])) as Record<string, string | boolean | string[]>);
      }
    }).catch((reason: unknown) => {
      if (active) setError(actionErrorMessage(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [resource]);

  function startCreate() {
    setEditingId(null);
    setForm(initialForm(resource));
    setError("");
    setNotice("");
  }

  function startEdit(record: RegistrationRecord) {
    setEditingId(record.id);
    setForm(Object.fromEntries(definition.fields.map((field) => [
      field.name,
      field.name === "password" ? "" : toFormValue(field, record[field.name]),
    ])) as Record<string, string | boolean | string[]>);
    if (resource === "protocol") setSelectedProtocolId(record.id);
    setError("");
    setNotice("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const body: Record<string, unknown> = {};
      for (const field of definition.fields) {
        const value = form[field.name];
        if (field.type === "checkbox") {
          body[field.name] = Boolean(value);
        } else if (field.type === "multiselect") {
          body[field.name] = Array.isArray(value) ? value : [];
        } else if (field.type === "number") {
          body[field.name] = value === "" ? undefined : Number(value);
        } else if (field.type === "password" && editingId && !value) {
          continue;
        } else if (!value && !field.required && (field.type === "select" || field.type === "date")) {
          body[field.name] = null;
        } else if ((field.type === "text" || field.type === "tel" || field.type === "email" || field.type === "textarea" || field.type === "password") && value === "") {
          body[field.name] = "";
        } else {
          body[field.name] = value;
        }
      }

      if (resource === "agenda") {
        await apiRequest<{ appointment: { id: string } }>("/appointments", {
          method: "POST",
          body: JSON.stringify({
            patientMembershipId: body.patientId,
            therapistMembershipId: body.therapistId,
            therapyId: body.therapyId,
            startsAt: new Date(String(body.startsAt)).toISOString(),
          }),
        });
        setNotice("Agendamento confirmado.");
        if (!editingId) setForm(initialForm(resource));
        await load();
        return;
      }

      const path = `/registrations/${resource}${editingId ? `/${encodeURIComponent(editingId)}` : ""}`;
      const response = await apiRequest<{ id?: string }>(path, {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      if (resource === "clinic" && !editingId) {
        if (!response.id) throw new Error("A clínica foi criada sem retornar um identificador.");
        await apiRequest("/auth/clinic", {
          method: "POST",
          body: JSON.stringify({ clinicId: response.id }),
        });
        window.location.reload();
        return;
      }
      setNotice(editingId ? "Cadastro atualizado." : "Cadastro salvo.");
      if (resource === "protocol" && response.id) setSelectedProtocolId(response.id);
      if (resource !== "clinic" && !editingId) setForm(initialForm(resource));
      if (resource !== "clinic") setEditingId(null);
      await load();
    } catch (reason) {
      setError(actionErrorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function setActive(record: RegistrationRecord, active: boolean) {
    const deleting = !active;
    const entityName = String(record.fullName ?? record.name ?? record.email ?? record.id);
    if (resource === "clinic" && deleting) {
      const confirmed = window.confirm(
        `Arquivar a clínica "${entityName}"? Isso encerra o acesso atual. Você precisará entrar novamente em outra clínica ativa para restaurá-la.`,
      );
      if (!confirmed) return;
    } else if (["user", "patient", "therapist", "specialty", "therapy"].includes(resource)) {
      const action = deleting ? "Excluir" : "Restaurar";
      const detail = deleting ? "O registro será inativado, mas permanecerá no banco e manterá seus vínculos." : "O registro voltará a ficar ativo.";
      if (!window.confirm(`${action} "${entityName}"? ${detail}`)) return;
    }

    setError("");
    setNotice("");
    setPendingActionId(record.id);
    try {
      await apiRequest(`/registrations/${resource}/${encodeURIComponent(record.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      if (resource === "clinic" && deleting) {
        window.location.reload();
        return;
      }
      setNotice(active ? "Cadastro restaurado." : "Cadastro excluído logicamente e inativado.");
      await load();
    } catch (reason) {
      setError(actionErrorMessage(reason));
    } finally {
      setPendingActionId(null);
    }
  }

  async function restoreClinic(clinic: { id: string; name: string }) {
    if (!window.confirm(`Restaurar a clínica "${clinic.name}"?`)) return;
    setError("");
    setNotice("");
    setPendingActionId(clinic.id);
    try {
      await apiRequest(`/registrations/clinic/${encodeURIComponent(clinic.id)}/restore`, { method: "POST" });
      window.location.reload();
    } catch (reason) {
      setError(actionErrorMessage(reason));
    } finally {
      setPendingActionId(null);
    }
  }

  async function appointmentAction(record: RegistrationRecord, action: "cancel" | "reschedule" | "COMPLETED" | "NO_SHOW") {
    setError("");
    setNotice("");
    try {
      if (action === "cancel") {
        const reason = window.prompt("Informe o motivo do cancelamento:");
        if (!reason?.trim()) return;
        await apiRequest(`/appointments/${encodeURIComponent(record.id)}/cancel`, {
          method: "POST",
          body: JSON.stringify({ reason: reason.trim() }),
        });
        setNotice("Agendamento cancelado. As notificações dependem da configuração dos provedores.");
      } else if (action === "reschedule") {
        const suggestedDate = new Date(new Date(String(record.startsAt)).getTime() + 24 * 60 * 60 * 1000);
        const suggested = new Date(suggestedDate.getTime() - suggestedDate.getTimezoneOffset() * 60_000)
          .toISOString()
          .slice(0, 16);
        const input = window.prompt("Novo horário local (AAAA-MM-DDTHH:mm):", suggested);
        if (!input) return;
        const startsAt = new Date(input);
        if (Number.isNaN(startsAt.getTime())) throw new Error("Informe uma data e horário válidos.");
        await apiRequest(`/appointments/${encodeURIComponent(record.id)}/reschedule`, {
          method: "POST",
          body: JSON.stringify({ startsAt: startsAt.toISOString() }),
        });
        setNotice("Agendamento remarcado.");
      } else {
        await apiRequest(`/appointments/${encodeURIComponent(record.id)}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: action }),
        });
        setNotice(action === "COMPLETED" ? "Atendimento concluído." : "Atendimento registrado como não compareceu.");
      }
      await load();
    } catch (reason) {
      setError(actionErrorMessage(reason));
    }
  }

  const fields = definition.fields;
  const missingOptions = fields.find((field) => field.optionsKey && field.required && (options[field.optionsKey]?.length ?? 0) === 0);
  const canArchiveClinic = session.clinics.some(
    (clinic) => clinic.clinicId !== session.activeClinic.id && clinic.role === "CLINIC_ADMIN",
  );

  return (
    <div className="page-content registration-page">
      <header className="registration-brand">
        <img src={logoImage} alt="QIConect" />
        <div className="registration-brand-copy">
          <strong>QIConect</strong>
          <span>CADASTROS DA CLÍNICA</span>
        </div>
        <div className="brand-spectrum" aria-hidden="true"><span /><span /><span /></div>
      </header>
      <div className="page-heading registration-heading">
        <div>
          <p className="eyebrow">Administração da clínica</p>
          <h1>Cadastro de {definition.title}</h1>
          <p className="muted">{definition.description}</p>
        </div>
        <span className="soft-badge">{session.activeClinic.name}</span>
      </div>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {notice && <p className="alert alert-success" role="status">{notice}</p>}
      {missingOptions && (
        <p className="alert alert-error">
          Cadastre primeiro: {missingOptions.optionsKey === "therapies" ? "terapia" : missingOptions.optionsKey === "specialties" ? "especialidade" : missingOptions.optionsKey === "charts" ? "prontuário" : missingOptions.optionsKey === "diagnosisProtocols" ? "vínculo de diagnóstico e etapa de protocolo" : "os registros relacionados"}.
        </p>
      )}
      {resource === "clinic" && !canArchiveClinic && (
        <p className="muted">Para arquivar esta clínica, seu usuário precisa ter acesso administrativo a outra clínica ativa.</p>
      )}
      <form className="panel form-panel registration-form" onSubmit={submit}>
        <div className="panel-heading">
          <div>
            <h2>{resource === "clinic" ? editingId ? "Dados da clínica" : "Nova clínica" : editingId ? `Editar ${recordLabels[resource].singular}` : recordLabels[resource].create}</h2>
            <p className="muted">Campos identificadores e datas de auditoria são gerados pelo sistema.</p>
          </div>
          <button type="button" className="button button-secondary" onClick={startCreate}>
            {resource === "clinic" ? "Nova clínica" : "Limpar formulário"}
          </button>
        </div>
        <div className="form-grid">
          {fields.map((field) => {
            const value = form[field.name] ?? "";
            const required = field.name === "password" ? !editingId : Boolean(field.required);
            if (field.type === "checkbox") {
              return (
                <label className="checkbox-option registration-checkbox" key={field.name}>
                  <input type="checkbox" checked={Boolean(value)} onChange={(event) => setForm({ ...form, [field.name]: event.target.checked })} />
                  {field.label}
                </label>
              );
            }
            if (field.type === "multiselect") {
              const selected = Array.isArray(value) ? value : [];
              const choices = options[field.optionsKey ?? ""] ?? [];
              return (
                <fieldset className="span-two checkbox-field" key={field.name}>
                  <legend>{field.label}</legend>
                  {choices.length === 0 ? <span className="muted">Nenhuma opção ativa.</span> : (
                    <div className="checkbox-grid">
                      {choices.map((option) => (
                        <label className="checkbox-option" key={option.value}>
                          <input
                            type="checkbox"
                            checked={selected.includes(option.value)}
                            onChange={(event) => setForm({
                              ...form,
                              [field.name]: event.target.checked
                                ? [...selected, option.value]
                                : selected.filter((item) => item !== option.value),
                            })}
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              );
            }
            if (field.type === "select") {
              const choices = field.options ?? (
                field.optionsKey === "patientsWithoutChart" && editingId
                  ? options.patients ?? []
                  : options[field.optionsKey ?? ""] ?? []
              );
              return (
                <label key={field.name}>
                  {field.label}
                  <select required={required} disabled={resource === "user" && field.name === "role" && Boolean(editingId)} value={String(value)} onChange={(event) => setForm({ ...form, [field.name]: event.target.value })}>
                    <option value="">{field.required ? "Selecione" : "Não informado"}</option>
                    {choices.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              );
            }
            if (field.type === "textarea") {
              return (
                <label className="span-two" key={field.name}>
                  {field.label}
                  <textarea required={required} value={String(value)} onChange={(event) => setForm({ ...form, [field.name]: event.target.value })} />
                  {field.hint && <small className="field-hint">{field.hint}</small>}
                </label>
              );
            }
            return (
              <label key={field.name}>
                {field.label}
                <input
                  type={field.type}
                  required={required}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  minLength={field.type === "password" && !editingId ? 10 : undefined}
                  value={String(value)}
                  onChange={(event) => setForm({ ...form, [field.name]: event.target.value })}
                />
                {field.hint && <small className="field-hint">{field.hint}</small>}
              </label>
            );
          })}
        </div>
        <div className="registration-form-actions">
          <button className="button button-primary" disabled={saving || loading || Boolean(missingOptions)}>
            {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Salvar cadastro"}
          </button>
          {editingId && resource !== "clinic" && (
            <button type="button" className="button button-secondary" onClick={startCreate}>Cancelar edição</button>
          )}
        </div>
      </form>

      {resource === "clinic" && archivedClinics.length > 0 && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Clínicas arquivadas</h2>
              <p className="muted">Restaure o acesso a uma clínica vinculada ao seu usuário administrador.</p>
            </div>
          </div>
          <div className="registration-row-actions">
            {archivedClinics.map((clinic) => (
              <button
                key={clinic.id}
                type="button"
                className="button button-secondary button-small"
                disabled={pendingActionId === clinic.id}
                onClick={() => void restoreClinic(clinic)}
              >
                {pendingActionId === clinic.id ? "Restaurando..." : `Restaurar ${clinic.name}`}
              </button>
            ))}
          </div>
        </section>
      )}

      {resource === "protocol" && (
        <ProtocolStepsPanel
          protocols={records.filter((record) => record.active === 1 || record.active === true).map((record) => ({ id: record.id, name: String(record.name) }))}
          selectedProtocolId={selectedProtocolId}
          onSelect={setSelectedProtocolId}
          onChanged={async () => { await load(); }}
        />
      )}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{records.length} {records.length === 1 ? recordLabels[resource].singular : recordLabels[resource].plural}</h2>
            <p className="muted">Registros vinculados a {session.activeClinic.name}.</p>
          </div>
        </div>
        {loading ? <p className="empty-state">Carregando cadastros...</p> : records.length === 0 ? (
          <p className="empty-state">Nenhum registro para exibir.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr>{definition.columns.map((column) => <th key={column.key}>{column.label}</th>)}<th>Ações</th></tr></thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    {definition.columns.map((column) => <td key={column.key}>{displayValue(record[column.key], column.key)}</td>)}
                    <td className="registration-row-actions">
                      {resource !== "agenda" && (
                        <button type="button" className="button button-secondary button-small" onClick={() => startEdit(record)}>Editar</button>
                      )}
                      {resource === "clinic" && (
                        <button type="button" className="button button-secondary button-small" onClick={() => startEdit(record)}>Editar</button>
                      )}
                      {resource === "agenda" && record.status === "CONFIRMED" && (
                        <>
                          <button type="button" className="button button-secondary button-small" onClick={() => void appointmentAction(record, "reschedule")}>Remarcar</button>
                          <button type="button" className="button button-primary button-small" onClick={() => void appointmentAction(record, "COMPLETED")}>Concluir</button>
                          <button type="button" className="button button-secondary button-small" onClick={() => void appointmentAction(record, "NO_SHOW")}>Falta</button>
                          <button type="button" className="button button-danger button-small" onClick={() => void appointmentAction(record, "cancel")}>Cancelar</button>
                        </>
                      )}
                      {resource !== "agenda" && "active" in record && (
                        <button
                          type="button"
                          className={`button button-small ${record.active === true || record.active === 1 ? "button-danger" : "button-secondary"}`}
                          disabled={pendingActionId === record.id || (resource === "clinic" && !canArchiveClinic)}
                          title={resource === "clinic" && !canArchiveClinic
                            ? "Vincule-se como administrador a outra clínica ativa antes de arquivar."
                            : undefined}
                          onClick={() => void setActive(record, !(record.active === true || record.active === 1))}
                        >
                          {pendingActionId === record.id
                            ? "Processando..."
                            : ["user", "patient", "therapist", "specialty", "therapy", "clinic"].includes(resource)
                              ? record.active === true || record.active === 1 ? "Excluir" : "Restaurar"
                              : record.active === true || record.active === 1 ? "Inativar" : "Ativar"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

interface ProtocolStepsPanelProps {
  protocols: Array<{ id: string; name: string }>;
  selectedProtocolId: string;
  onSelect: (id: string) => void;
  onChanged: () => Promise<void>;
}

function ProtocolStepsPanel({ protocols, selectedProtocolId, onSelect, onChanged }: ProtocolStepsPanelProps) {
  const [steps, setSteps] = useState<Array<Record<string, unknown>>>([]);
  const [sequence, setSequence] = useState("1");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  async function loadSteps() {
    if (!selectedProtocolId) {
      setSteps([]);
      return;
    }
    const result = await apiRequest<{ steps: Array<Record<string, unknown>> }>(
      `/registrations/protocol-steps?protocolId=${encodeURIComponent(selectedProtocolId)}`,
    );
    setSteps(result.steps);
    setSequence(String(result.steps.reduce((maximum, step) => Math.max(maximum, Number(step.sequence) || 0), 0) + 1));
  }

  useEffect(() => {
    loadSteps().catch((reason: unknown) => setError(actionErrorMessage(reason)));
  }, [selectedProtocolId]);

  async function addStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await apiRequest("/registrations/protocol-steps", {
        method: "POST",
        body: JSON.stringify({
          protocolId: selectedProtocolId,
          sequence: Number(sequence),
          startsAt: startsAt || undefined,
          endsAt: endsAt || undefined,
          description,
          notes: notes || undefined,
        }),
      });
      setDescription("");
      setStartsAt("");
      setEndsAt("");
      setNotes("");
      await loadSteps();
      await onChanged();
    } catch (reason) {
      setError(actionErrorMessage(reason));
    }
  }

  return (
    <section className="panel form-panel protocol-steps-panel">
      <div className="panel-heading">
        <div><h2>Etapas do protocolo</h2><p className="muted">Defina a sequência de ações para habilitar o registro de evoluções.</p></div>
      </div>
      {protocols.length === 0 ? (
        <p className="empty-state">Salve um protocolo ativo para adicionar etapas.</p>
      ) : (
        <>
          <label>Protocolo
            <select value={selectedProtocolId} onChange={(event) => onSelect(event.target.value)}>
              <option value="">Selecione</option>
              {protocols.map((protocol) => <option key={protocol.id} value={protocol.id}>{protocol.name}</option>)}
            </select>
          </label>
          {selectedProtocolId && (
            <>
              {error && <p className="alert alert-error">{error}</p>}
              <form className="protocol-step-form" onSubmit={addStep}>
                <label>Sequência<input type="number" min={1} required value={sequence} onChange={(event) => setSequence(event.target.value)} /></label>
                <label>Data inicial<input type="date" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
                <label>Data final<input type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
                <label>Descrição<input required minLength={2} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
                <label>Observações<input value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
                <button className="button button-primary">Adicionar etapa</button>
              </form>
              {steps.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Seq.</th><th>Descrição</th><th>Início</th><th>Fim</th><th>Observações</th></tr></thead>
                    <tbody>{steps.map((step) => (
                      <tr key={String(step.id)}>
                        <td>{String(step.sequence)}</td>
                        <td>{String(step.description)}</td>
                        <td>{displayValue(step.startsAt, "date")}</td>
                        <td>{displayValue(step.endsAt, "date")}</td>
                        <td>{displayValue(step.notes, "notes")}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

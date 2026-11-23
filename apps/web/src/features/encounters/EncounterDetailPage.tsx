import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest, type EncounterDetails, type Session } from "../../lib/api.js";

type EncounterTab = "anamnesis" | "diagnosis" | "protocol" | "evolutions";

interface EncounterDetailPageProps {
  appointmentId: string;
  session: Session;
  onBack: () => void;
}

const tabs: Array<{ id: EncounterTab; label: string }> = [
  { id: "anamnesis", label: "Anamnese" },
  { id: "diagnosis", label: "Diagnóstico" },
  { id: "protocol", label: "Protocolo" },
  { id: "evolutions", label: "Evoluções" },
];

const stageStatusLabels = {
  ACTIVE: "Ativo", INACTIVE: "Inativo", CONFIRMED: "Confirmada", CANCELLED: "Cancelada",
  RESCHEDULED: "Remarcada", WAITING: "Aguardando", IN_PROGRESS: "Em atendimento", PAID: "Pago",
} as const;

type ProtocolStage = EncounterDetails["protocols"][number];
interface DiagnosisProtocolGroup {
  diagnosisId: string;
  diagnosisDescription: string;
  diagnosedAt: string | null;
  protocols: Array<{ protocolId: string; protocolName: string; stages: ProtocolStage[] }>;
}
interface EvolutionDiagnosisGroup {
  diagnosisId: string;
  diagnosisDescription: string;
  diagnosedAt: string | null;
  protocols: Array<{
    protocolId: string;
    protocolName: string;
    stages: Array<ProtocolStage & { evolutions: EncounterDetails["evolutions"] }>;
  }>;
}

const evolutionStatusLabels = { ...stageStatusLabels };

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data não informada"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatClinicalDate(value: string | null | undefined) {
  if (!value) return "Data não informada";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime())
    ? "Data não informada"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(date);
}

function groupProtocolsByDiagnosis(stages: ProtocolStage[]): DiagnosisProtocolGroup[] {
  const groups = new Map<string, DiagnosisProtocolGroup>();
  for (const stage of stages) {
    let diagnosis = groups.get(stage.diagnosisId);
    if (!diagnosis) {
      diagnosis = {
        diagnosisId: stage.diagnosisId,
        diagnosisDescription: stage.diagnosisDescription,
        diagnosedAt: stage.diagnosedAt,
        protocols: [],
      };
      groups.set(stage.diagnosisId, diagnosis);
    }
    let protocol = diagnosis.protocols.find((item) => item.protocolId === stage.protocolId);
    if (!protocol) {
      protocol = { protocolId: stage.protocolId, protocolName: stage.protocolName, stages: [] };
      diagnosis.protocols.push(protocol);
    }
    protocol.stages.push(stage);
  }
  return [...groups.values()].sort((first, second) => {
    const firstTime = first.diagnosedAt ? new Date(first.diagnosedAt).getTime() : 0;
    const secondTime = second.diagnosedAt ? new Date(second.diagnosedAt).getTime() : 0;
    return (Number.isFinite(secondTime) ? secondTime : 0) - (Number.isFinite(firstTime) ? firstTime : 0)
      || second.diagnosisId.localeCompare(first.diagnosisId, undefined, { numeric: true });
  });
}

function groupProtocolCatalogByDiagnosis(protocols: EncounterDetails["protocolCatalog"]) {
  const groups = new Map<string, { diagnosisId: string; diagnosisDescription: string; diagnosedAt: string | null; protocols: typeof protocols }>();
  for (const protocol of protocols) {
    let group = groups.get(protocol.diagnosisId);
    if (!group) {
      group = { diagnosisId: protocol.diagnosisId, diagnosisDescription: protocol.diagnosisDescription, diagnosedAt: protocol.diagnosedAt, protocols: [] };
      groups.set(protocol.diagnosisId, group);
    }
    group.protocols.push(protocol);
  }
  return [...groups.values()];
}

function dateOrderValue(value: string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function dateInputValue(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function evolutionStageEligibility(stage: ProtocolStage, stages: ProtocolStage[], evolutions: EncounterDetails["evolutions"]) {
  const previousStages = stages.filter((item) => item.diagnosisId === stage.diagnosisId && item.protocolId === stage.protocolId && item.sequence < stage.sequence)
    .sort((first, second) => first.sequence - second.sequence);
  const missingPrevious = previousStages.find((previous) => !evolutions.some((evolution) => evolution.diagnosisProtocolId === previous.diagnosisProtocolId));
  const dates = [stage.startsAt, ...evolutions.filter((evolution) => {
    const previousStage = previousStages.find((item) => item.diagnosisProtocolId === evolution.diagnosisProtocolId);
    return Boolean(previousStage);
  }).map((evolution) => evolution.evolvedAt)]
    .map(dateInputValue).filter((date): date is string => Boolean(date)).sort();
  return { allowed: !missingPrevious, missingSequence: missingPrevious?.sequence, minDate: dates.at(-1) ?? null };
}

function groupEvolutionsByDiagnosisAndStage(
  stages: ProtocolStage[],
  evolutions: EncounterDetails["evolutions"],
): EvolutionDiagnosisGroup[] {
  const groups = new Map<string, EvolutionDiagnosisGroup>();
  for (const stage of stages) {
    let diagnosis = groups.get(stage.diagnosisId);
    if (!diagnosis) {
      diagnosis = {
        diagnosisId: stage.diagnosisId,
        diagnosisDescription: stage.diagnosisDescription,
        diagnosedAt: stage.diagnosedAt,
        protocols: [],
      };
      groups.set(stage.diagnosisId, diagnosis);
    }
    let protocol = diagnosis.protocols.find((item) => item.protocolId === stage.protocolId);
    if (!protocol) {
      protocol = { protocolId: stage.protocolId, protocolName: stage.protocolName, stages: [] };
      diagnosis.protocols.push(protocol);
    }
    protocol.stages.push({
      ...stage,
      evolutions: evolutions
        .filter((evolution) => evolution.diagnosisProtocolId === stage.diagnosisProtocolId)
        .sort((first, second) => dateOrderValue(second.evolvedAt) - dateOrderValue(first.evolvedAt)),
    });
  }

  for (const diagnosis of groups.values()) {
    for (const protocol of diagnosis.protocols) {
      protocol.stages.sort((first, second) =>
        dateOrderValue(second.startsAt) - dateOrderValue(first.startsAt)
          || second.sequence - first.sequence,
      );
    }
    diagnosis.protocols.sort((first, second) =>
      dateOrderValue(second.stages[0]?.startsAt) - dateOrderValue(first.stages[0]?.startsAt)
        || first.protocolName.localeCompare(second.protocolName, "pt-BR"),
    );
  }

  return [...groups.values()].sort((first, second) =>
    dateOrderValue(second.diagnosedAt) - dateOrderValue(first.diagnosedAt)
      || second.diagnosisId.localeCompare(first.diagnosisId, undefined, { numeric: true }),
  );
}

function today() {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function formatElapsed(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours, minutes, remainingSeconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function EncounterDetailPage({ appointmentId, session, onBack }: EncounterDetailPageProps) {
  const [detail, setDetail] = useState<EncounterDetails | null>(null);
  const [tab, setTab] = useState<EncounterTab>("anamnesis");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [editingAnamnesisId, setEditingAnamnesisId] = useState<string | null>(null);
  const [anamnesisSaved, setAnamnesisSaved] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  const [questionSearch, setQuestionSearch] = useState("");
  const [showNewQuestion, setShowNewQuestion] = useState(false);
  const [examFiles, setExamFiles] = useState<File[]>([]);
  const [tongueFile, setTongueFile] = useState<File | null>(null);
  const examInputRef = useRef<HTMLInputElement>(null);
  const tongueInputRef = useRef<HTMLInputElement>(null);
  const [attachmentDescription, setAttachmentDescription] = useState("");
  const [anamnesisForm, setAnamnesisForm] = useState({ type: "Anamnese clínica", description: "", answers: {} as Record<string, string> });
  const [diagnosisForm, setDiagnosisForm] = useState({ description: "", diagnosedAt: today() });
  const [patientAnswers, setPatientAnswers] = useState<Record<string, Record<string, string>>>({});
  const [protocolForm, setProtocolForm] = useState({ diagnosisId: "", protocolId: "" });
  const [showProtocolCreateForm, setShowProtocolCreateForm] = useState(false);
  const [newProtocolForm, setNewProtocolForm] = useState({ name: "", symptoms: "", objective: "" });
  const [stageProtocol, setStageProtocol] = useState<{ id: string; name: string } | null>(null);
  const [unassignedProtocols, setUnassignedProtocols] = useState<Array<{ id: string; name: string; symptoms: string | null; objective: string | null }>>([]);
  const [newStageForm, setNewStageForm] = useState({ description: "", startsAt: "", endsAt: "", notes: "" });
  const [evolutionForm, setEvolutionForm] = useState({
    diagnosisProtocolId: "",
    description: "",
    evolvedAt: today(),
    status: "IN_PROGRESS" as keyof typeof evolutionStatusLabels,
  });

  async function load() {
    const result = await apiRequest<EncounterDetails>(`/encounters/${appointmentId}`);
    const evolutionStages = [...result.protocols].sort((first, second) => dateOrderValue(second.diagnosedAt) - dateOrderValue(first.diagnosedAt) || first.protocolName.localeCompare(second.protocolName, "pt-BR") || dateOrderValue(first.startsAt) - dateOrderValue(second.startsAt) || first.sequence - second.sequence);
    const firstAvailableStage = evolutionStages.find((stage) => evolutionStageEligibility(stage, result.protocols, result.evolutions).allowed) ?? evolutionStages[0];
    const firstStageMinimumDate = firstAvailableStage ? evolutionStageEligibility(firstAvailableStage, result.protocols, result.evolutions).minDate : null;
    setDetail(result);
    if (session.activeClinic.role === "PATIENT") setPatientAnswers(Object.fromEntries(result.anamneses.map((item) => [item.id, Object.fromEntries(item.answers.map((answer) => [answer.questionId, answer.answer ?? ""]))])));
    setProtocolForm((current) => ({
      ...current,
      diagnosisId: current.diagnosisId || result.diagnoses[0]?.id || "",
      protocolId: current.protocolId || result.protocolOptions[0]?.id || "",
    }));
    setEvolutionForm((current) => ({
      ...current,
      diagnosisProtocolId: current.diagnosisProtocolId || firstAvailableStage?.diagnosisProtocolId || "",
      evolvedAt: current.evolvedAt < today() || (firstStageMinimumDate && current.evolvedAt < firstStageMinimumDate) ? (firstStageMinimumDate && firstStageMinimumDate > today() ? firstStageMinimumDate : today()) : current.evolvedAt,
    }));
  }

  async function loadUnassignedProtocols() {
    if (session.activeClinic.role !== "THERAPIST") return;
    const result = await apiRequest<{ protocols: Array<{ id: string; name: string; symptoms: string | null; objective: string | null }> }>(`/encounters/${appointmentId}/protocol-catalog/unassigned`);
    setUnassignedProtocols(result.protocols);
  }

  useEffect(() => {
    load().then(() => loadUnassignedProtocols()).catch((reason: Error) => setError(reason.message));
  }, [appointmentId]);

  useEffect(() => {
    const attendance = detail?.attendance;
    if (attendance?.status !== "IN_PROGRESS") return;
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(attendance.startedAt).getTime()) / 1000)));
    updateElapsed();
    const timerId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timerId);
  }, [detail?.attendance?.startedAt, detail?.attendance?.status]);

  async function mutate(path: string, method: "POST" | "PATCH", body: object, successMessage: string): Promise<boolean> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(path, { method, body: JSON.stringify(body) });
      setNotice(successMessage);
      await load();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar as informações.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createQuestion() {
    const description = newQuestion.trim();
    if (!description) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{ question: { id: string; description: string } }>(
        `/encounters/${appointmentId}/questions`,
        { method: "POST", body: JSON.stringify({ description }) },
      );
      setDetail((current) => current && current.questions.some((question) => question.id === result.question.id)
        ? current
        : current ? { ...current, questions: [result.question, ...current.questions] } : current);
      setSelectedQuestionIds((current) => [result.question.id, ...current.filter((id) => id !== result.question.id)]);
      setAnamnesisSaved(false);
      setNewQuestion("");
      setShowNewQuestion(false);
      setNotice("Pergunta adicionada e selecionada para esta anamnese.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar a pergunta.");
    } finally {
      setBusy(false);
    }
  }

  async function requestAttachments() {
    if (!detail || !canEdit) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(`/encounters/${appointmentId}/exam-request`, { method: "POST" });
      setNotice("Solicitação de exames e fotos enviada ao paciente."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível solicitar os arquivos."); }
    finally { setBusy(false); }
  }

  async function uploadAttachments() {
    if (!detail || !canUploadAttachments || (!examFiles.length && !tongueFile)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const files = [
        ...examFiles.map((file) => ({ file, type: "EXAM" as const })),
        ...(tongueFile ? [{ file: tongueFile, type: "TONGUE_PHOTO" as const }] : []),
      ];
      for (const item of files) {
        if (item.file.size > 10 * 1024 * 1024) throw new Error(`O arquivo ${item.file.name} excede o limite de 10 MB.`);
        const contentType = item.file.type || (item.file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
        if (!["application/pdf", "image/jpeg", "image/png"].includes(contentType)) {
          throw new Error("Envie apenas arquivos PDF, JPG ou PNG.");
        }
        const result = await apiRequest<{ attachment: EncounterDetails["attachments"][number] }>(`/encounters/${appointmentId}/attachments`, {
          method: "POST",
          body: JSON.stringify({
            type: item.type,
            originalFilename: item.file.name,
            contentType,
            contentBase64: await fileToBase64(item.file),
            description: attachmentDescription.trim() || undefined,
          }),
        });
        setDetail((current) => current
          ? { ...current, attachments: [...current.attachments.filter((attachment) => attachment.id !== result.attachment.id), result.attachment] }
          : current);
      }
      setExamFiles([]);
      setTongueFile(null);
      if (examInputRef.current) examInputRef.current.value = "";
      if (tongueInputRef.current) tongueInputRef.current.value = "";
      setAttachmentDescription("");
      setNotice("Arquivos enviados e anexados ao atendimento.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar os arquivos.");
    } finally {
      setBusy(false);
    }
  }

  async function startAttendance() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/encounters/${appointmentId}/start`, { method: "POST" });
      await load();
      setNotice("Atendimento iniciado.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível iniciar o atendimento.");
    } finally {
      setBusy(false);
    }
  }

  async function retryLoad() {
    setError("");
    try {
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "NÃ£o foi possÃ­vel carregar o atendimento.");
    }
  }

  async function saveAnamnesis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setBusy(true);
    setError("");
    setNotice("");
    const answers = Object.fromEntries(
      detail.questions
        .filter((question) => selectedQuestionIds.includes(question.id))
        .map((question) => [question.id, anamnesisForm.answers[question.id]?.trim() ?? ""]),
    );
    try {
      const result = await apiRequest<{ id: string }>(
        editingAnamnesisId
          ? `/encounters/${appointmentId}/anamneses/${editingAnamnesisId}`
          : `/encounters/${appointmentId}/anamneses`,
        {
          method: editingAnamnesisId ? "PATCH" : "POST",
          body: JSON.stringify({ type: anamnesisForm.type, description: anamnesisForm.description, selectedQuestionIds, answers }),
        },
      );
      setEditingAnamnesisId(result.id);
      setAnamnesisSaved(true);
      setNotice("Anamnese salva. Continue preenchendo e salve novamente para atualizar.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "NÃ£o foi possÃ­vel salvar a anamnese.");
    } finally {
      setBusy(false);
    }
  }

  async function savePatientAnswers(event: FormEvent<HTMLFormElement>, anamnesisId: string) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(`/encounters/${appointmentId}/anamneses/${anamnesisId}/answers`, { method: "PATCH", body: JSON.stringify({ answers: patientAnswers[anamnesisId] ?? {} }) });
      setNotice("Suas respostas foram salvas."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar suas respostas."); }
    finally { setBusy(false); }
  }

  function editAnamnesis(anamnesis: EncounterDetails["anamneses"][number]) {
    setEditingAnamnesisId(anamnesis.id);
    setAnamnesisSaved(true);
    setSelectedQuestionIds(anamnesis.answers.map((answer) => answer.questionId));
    setAnamnesisForm({
      type: anamnesis.type,
      description: anamnesis.description,
      answers: Object.fromEntries(anamnesis.answers.map((answer) => [answer.questionId, answer.answer])),
    });
    setError("");
    setNotice("Anamnese carregada. Selecione novas perguntas ou atualize as respostas.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelAnamnesisEdit() {
    setEditingAnamnesisId(null);
    setSelectedQuestionIds([]);
    setAnamnesisForm({ type: "Anamnese clínica", description: "", answers: {} });
    setNotice("");
  }

  function saveDiagnosis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void mutate(
      `/encounters/${appointmentId}/diagnoses`,
      "POST",
      diagnosisForm,
      "Diagnóstico registrado.",
    ).then((saved) => {
      if (saved) setDiagnosisForm({ description: "", diagnosedAt: today() });
    });
  }

  function attachProtocol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void mutate(
      `/encounters/${appointmentId}/protocols`,
      "POST",
      protocolForm,
      "Protocolo vinculado ao diagnóstico.",
    );
  }

  function createProtocol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    void apiRequest<{ protocolId: string; name: string }>(`/encounters/${appointmentId}/protocol-catalog`, { method: "POST", body: JSON.stringify({ ...newProtocolForm, diagnosisId: protocolForm.diagnosisId }) })
      .then(async (created) => { setStageProtocol({ id: created.protocolId, name: created.name }); setProtocolForm((current) => ({ ...current, protocolId: created.protocolId })); setNewProtocolForm({ name: "", symptoms: "", objective: "" }); setShowProtocolCreateForm(false); setNotice("Protocolo cadastrado e vinculado ao diagnóstico. Ele já está visível ao paciente; você pode adicionar etapas agora ou depois."); await load(); await loadUnassignedProtocols(); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível cadastrar o protocolo."))
      .finally(() => setBusy(false));
  }

  async function linkUnassignedProtocol(protocol: { id: string; name: string }) {
    if (!protocolForm.diagnosisId) { setError("Selecione o diagnóstico para vincular o protocolo."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(`/encounters/${appointmentId}/protocol-catalog/${protocol.id}/diagnosis`, { method: "PATCH", body: JSON.stringify({ diagnosisId: protocolForm.diagnosisId }) });
      setProtocolForm((current) => ({ ...current, protocolId: protocol.id })); setStageProtocol(protocol); setNotice("Protocolo vinculado ao diagnóstico e disponível para o paciente."); await load(); await loadUnassignedProtocols();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível vincular o protocolo."); }
    finally { setBusy(false); }
  }

  function saveProtocolStage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!stageProtocol) return;
    setBusy(true); setError(""); setNotice("");
    void apiRequest<{ sequence: number }>(`/encounters/${appointmentId}/protocol-catalog/${stageProtocol.id}/steps`, { method: "POST", body: JSON.stringify(newStageForm) })
      .then(async ({ sequence }) => { setNewStageForm({ description: "", startsAt: "", endsAt: "", notes: "" }); setNotice(`Etapa ${sequence} cadastrada.`); await load(); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível cadastrar a etapa."))
      .finally(() => setBusy(false));
  }

  function updateStage(diagnosisProtocolId: string, status: keyof typeof stageStatusLabels) {
    void mutate(
      `/encounters/${appointmentId}/protocol-stages/${diagnosisProtocolId}`,
      "PATCH",
      { status },
      "Etapa atualizada.",
    );
  }

  function saveEvolution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEvolutionEligibility?.allowed) { setError(`Registre primeiro a evolução da etapa ${selectedEvolutionEligibility?.missingSequence ?? "anterior"}.`); return; }
    if (!evolutionDateIsValid) { setError(`A data da evolução deve ser igual ou posterior a ${selectedEvolutionEligibility?.minDate}.`); return; }
    void mutate(
      `/encounters/${appointmentId}/evolutions`,
      "POST",
      evolutionForm,
      "Evolução registrada.",
    ).then(() => setEvolutionForm((current) => ({ ...current, description: "", evolvedAt: today() })));
  }

  if (!detail) {
    return (
      <div className="page-content">
        <p className="empty-state">{error || "Carregando atendimento..."}</p>
        {error && (
          <div className="form-actions">
            <button className="button button-secondary" onClick={() => void retryLoad()}>Tentar novamente</button>
            <button className="button button-quiet" onClick={onBack}>Voltar para atendimentos</button>
          </div>
        )}
      </div>
    );
  }

  const isTherapist = session.activeClinic.role === "THERAPIST";
  const canEdit = isTherapist && detail.attendance?.status === "IN_PROGRESS";
  const canUploadAttachments = canEdit || (session.activeClinic.role === "PATIENT" && detail.attendance?.examRequested === true);
  const canStart = isTherapist && (
    (!detail.attendance && detail.appointment.appointmentStatus === "CONFIRMED")
    || detail.attendance?.status === "ACTIVE"
  );
  const availableQuestions = detail.questions.filter((question) => !selectedQuestionIds.includes(question.id));
  const filteredQuestions = [...availableQuestions]
    .sort((first, second) => Number(second.id) - Number(first.id))
    .filter((question) =>
      question.description.toLocaleLowerCase("pt-BR").includes(questionSearch.trim().toLocaleLowerCase("pt-BR")),
    );
  const protocolGroups = groupProtocolsByDiagnosis(detail.protocols);
  const protocolCatalogGroups = groupProtocolCatalogByDiagnosis(detail.protocolCatalog);
  const evolutionGroups = groupEvolutionsByDiagnosisAndStage(detail.protocols, detail.evolutions);
  const selectedEvolutionStage = detail.protocols.find((item) => item.diagnosisProtocolId === evolutionForm.diagnosisProtocolId);
  const selectedEvolutionEligibility = selectedEvolutionStage ? evolutionStageEligibility(selectedEvolutionStage, detail.protocols, detail.evolutions) : null;
  const evolutionDateIsValid = !selectedEvolutionEligibility?.minDate || evolutionForm.evolvedAt >= selectedEvolutionEligibility.minDate;
  return (
    <div className="page-content">
      <button className="encounter-back-link" onClick={onBack}>← Voltar para atendimentos</button>
      <div className="page-heading encounter-heading">
        <div>
          <p className="eyebrow">Início do atendimento</p>
          <h1>Atendimento: {detail.appointment.patientName}</h1>
          <p className="muted">{formatDate(detail.appointment.startsAt)} · {detail.appointment.therapyName}</p>
        </div>
        <span className={`status-pill status-${(detail.attendance?.status ?? detail.appointment.appointmentStatus).toLowerCase()}`}>
          {detail.attendance ? ({ ACTIVE: "Ativo", INACTIVE: "Inativo", CONFIRMED: "Confirmado", CANCELLED: "Cancelado", RESCHEDULED: "Remarcado", WAITING: "Aguardando", IN_PROGRESS: "Em atendimento", PAID: "Pago" } as Record<string, string>)[detail.attendance.status] : "Agendado"}
        </span>
      </div>

      {error && <p className="alert alert-error">{error}</p>}
      {notice && <p className="alert alert-success">{notice}</p>}

      <section className="encounter-session-bar">
        <div>
          <span className="eyebrow">{detail.attendance?.status === "IN_PROGRESS" ? "Cronômetro da sessão" : "Paciente"}</span>
          <strong className={detail.attendance?.status === "IN_PROGRESS" ? "encounter-timer" : "encounter-patient-name"}>
            {detail.attendance?.status === "IN_PROGRESS"
              ? formatElapsed(elapsedSeconds)
              : detail.appointment.patientName}
          </strong>
        </div>
        {canStart && <button className="button button-primary" disabled={busy} onClick={() => void startAttendance()}>{busy ? "Iniciando..." : "Iniciar atendimento"}</button>}
        {!isTherapist && <span className="soft-badge">Consulta somente leitura</span>}
      </section>

      {!detail.attendance && <p className="notice-card"><span className="notice-icon">i</span><span>Os registros clínicos ficam disponíveis após o terapeuta iniciar o atendimento.</span></p>}

      <div className="encounter-tabs" role="tablist" aria-label="Guias do atendimento">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`encounter-tab ${tab === item.id ? "encounter-tab-active" : ""}`}
            role="tab"
            id={`encounter-tab-${item.id}`}
            aria-controls={`encounter-panel-${item.id}`}
            aria-selected={tab === item.id}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setTab(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "anamnesis" && (
        <section className="panel encounter-panel" id="encounter-panel-anamnesis" role="tabpanel" aria-labelledby="encounter-tab-anamnesis">
          <div className="panel-heading">
            <div><h2>Anamnese</h2><p className="muted">Queixa principal, descrição clínica e respostas às perguntas da terapia.</p></div>
          </div>
          {canEdit && (
            <form className="form-panel" onSubmit={saveAnamnesis}>
              <div className="form-grid">
                {editingAnamnesisId && <div className="span-two edit-anamnesis-banner"><strong>Editando anamnese existente</strong><button type="button" className="button button-secondary" onClick={cancelAnamnesisEdit}>Cancelar edição</button></div>}
                <label>Tipo<input required minLength={2} maxLength={100} value={anamnesisForm.type} onChange={(event) => { setAnamnesisForm({ ...anamnesisForm, type: event.target.value }); setAnamnesisSaved(false); }} /></label>
                <label className="span-two">Queixa principal e descrição<textarea required minLength={1} maxLength={4000} rows={4} value={anamnesisForm.description} onChange={(event) => { setAnamnesisForm({ ...anamnesisForm, description: event.target.value }); setAnamnesisSaved(false); }} /></label>
                <div className="span-two anamnesis-question-picker">
                  <div className="question-picker-heading">
                    <div>
                      <strong>Gerenciador de perguntas</strong>
                      <p className="field-hint">Selecione as perguntas existentes que farão parte desta anamnese.{availableQuestions.length > 9 ? ` Role a lista para consultar as ${availableQuestions.length} perguntas disponíveis.` : ""}</p>
                    </div>
                    <button type="button" className="button button-secondary" onClick={() => setShowNewQuestion((current) => !current)}>
                      {showNewQuestion ? "Cancelar Nova Pergunta" : "+ Adicionar nova pergunta"}
                    </button>
                  </div>
                  {showNewQuestion && <div className="anamnesis-new-question">
                    <label>Nova pergunta<input minLength={2} maxLength={500} value={newQuestion} onChange={(event) => setNewQuestion(event.target.value)} placeholder="Ex.: Como está sua qualidade do sono?" /></label>
                    <button type="button" className="button button-secondary" disabled={busy || newQuestion.trim().length < 2} onClick={() => void createQuestion()}>{busy ? "Adicionando..." : "Criar pergunta"}</button>
                  </div>}
                  <input className="question-search-input" value={questionSearch} onChange={(event) => setQuestionSearch(event.target.value)} placeholder="Buscar pergunta existente..." aria-label="Buscar pergunta existente" />
                  {detail.questions.length === 0 ? <p className="empty-state">Nenhuma pergunta cadastrada para esta terapia.</p> : filteredQuestions.length === 0 ? <p className="empty-state">{questionSearch.trim() ? "Nenhuma pergunta corresponde à busca." : "Todas as perguntas disponíveis já foram escolhidas."}</p> : (
                    <div className="anamnesis-question-list">
                      {filteredQuestions.map((question) => (
                        <label className="checkbox-option" key={question.id}>
                          <input
                            type="checkbox"
                            checked={selectedQuestionIds.includes(question.id)}
                            onChange={(event) => {
                              setSelectedQuestionIds((current) => event.target.checked
                                ? [...current, question.id]
                                : current.filter((id) => id !== question.id));
                              setAnamnesisSaved(false);
                            }}
                          />
                          <span>{question.description}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                {selectedQuestionIds.length > 0 && <div className="span-two anamnesis-answer-list">
                  {selectedQuestionIds.map((id) => detail.questions.find((question) => question.id === id)).filter((question): question is NonNullable<typeof question> => question !== undefined).map((question) => (
                    <div className="anamnesis-answer-item" key={question.id}>
                      <label className="anamnesis-answer-field">{question.description}
                        <textarea rows={1} value={anamnesisForm.answers[question.id] ?? ""} onChange={(event) => {
                          setAnamnesisForm({ ...anamnesisForm, answers: { ...anamnesisForm.answers, [question.id]: event.target.value } });
                          setAnamnesisSaved(false);
                        }} />
                      </label>
                      <button type="button" className="button button-quiet" onClick={() => {
                        setSelectedQuestionIds((current) => current.filter((selectedId) => selectedId !== question.id));
                        setAnamnesisSaved(false);
                      }}>Remover</button>
                    </div>
                  ))}
                </div>}
              </div>
              <div className="encounter-form-actions"><button className="button button-primary" disabled={busy || (editingAnamnesisId ? anamnesisSaved : anamnesisForm.description.trim().length === 0)}>{busy ? "Salvando..." : editingAnamnesisId ? "Atualizar anamnese" : "Salvar anamnese"}</button></div>
            </form>
          )}
          {detail.attendance && (
            <section className="encounter-attachments-panel" aria-labelledby="attachments-title">
              <div className="panel-heading">
                <div><h3 id="attachments-title">Exames e fotos da língua</h3><p className="muted">Anexe documentos e imagens para apoiar a avaliação deste atendimento.</p></div>
                {canEdit && <button type="button" className="button button-secondary" disabled={busy || detail.attendance.examRequested} onClick={() => void requestAttachments()}>{detail.attendance.examRequested ? "Exames e fotos solicitados" : "Solicitar Exames e fotos"}</button>}
              </div>
              {canUploadAttachments && <div className="attachment-upload-grid">
                <label>Exames (PDF, JPG ou PNG)<input ref={examInputRef} type="file" accept="application/pdf,image/jpeg,image/png" multiple disabled={busy} onChange={(event) => setExamFiles(Array.from(event.target.files ?? []))} /></label>
                <label>Foto da língua (JPG ou PNG)<input ref={tongueInputRef} type="file" accept="image/jpeg,image/png" disabled={busy} onChange={(event) => setTongueFile(event.target.files?.[0] ?? null)} /></label>
                <label className="span-two">Observações<textarea rows={2} maxLength={1000} value={attachmentDescription} disabled={busy} onChange={(event) => setAttachmentDescription(event.target.value)} placeholder="Observações sobre os arquivos" /></label>
                <div className="encounter-form-actions span-two"><button type="button" className="button button-primary" disabled={busy || (!examFiles.length && !tongueFile)} onClick={() => void uploadAttachments()}>{busy ? "Enviando..." : "Enviar arquivos"}</button></div>
              </div>}
              {session.activeClinic.role === "PATIENT" && !detail.attendance.examRequested && <p className="notice-card">A terapeuta ainda não solicitou exames ou fotos para este atendimento.</p>}
              {detail.attachments.length === 0 ? <p className="empty-state">Nenhum arquivo anexado a este atendimento.</p> : (
                <div className="attachment-list">
                  {detail.attachments.map((attachment) => (
                    <article className="attachment-card" key={attachment.id}>
                      {attachment.type === "TONGUE_PHOTO" && attachment.contentType.startsWith("image/") ? <img src={attachment.url} alt={`Foto da língua: ${attachment.originalFilename}`} /> : <span className="attachment-icon">{attachment.contentType === "application/pdf" ? "PDF" : "IMG"}</span>}
                      <div><strong>{attachment.originalFilename}</strong><span>{attachment.type === "TONGUE_PHOTO" ? "Foto da língua" : "Exame"} · {formatBytes(attachment.sizeBytes)}</span>{attachment.description && <small>{attachment.description}</small>}</div>
                      <a className="button button-secondary" href={attachment.url} target="_blank" rel="noreferrer">Visualizar</a>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
          {detail.anamneses.length === 0 ? <p className="empty-state">Nenhuma anamnese registrada.</p> : (
            <div className="encounter-record-list">
              {detail.anamneses.map((item) => (
                <article className="encounter-record-card encounter-record-card-clickable" key={item.id} onClick={() => canEdit && editAnamnesis(item)} onKeyDown={(event) => { if (canEdit && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); editAnamnesis(item); } }} role={canEdit ? "button" : undefined} tabIndex={canEdit ? 0 : undefined}>
                  <div className="record-topline"><span className="soft-badge">{item.type}</span><span className="muted">{formatDate(item.registeredAt)}</span></div>
                  <p className="encounter-record-description">{item.description}</p>
                  {session.activeClinic.role === "PATIENT" && item.answers.length > 0 ? <form className="patient-anamnesis-answers" onSubmit={(event) => void savePatientAnswers(event, item.id)}>
                    {item.answers.map((answer) => (
                      <label className="anamnesis-answer-field" key={answer.questionId}>{answer.question}
                        <textarea rows={2} maxLength={4000} value={patientAnswers[item.id]?.[answer.questionId] ?? answer.answer ?? ""} onChange={(event) => setPatientAnswers((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? {}), [answer.questionId]: event.target.value } }))} />
                      </label>
                    ))}
                    <div className="encounter-form-actions"><button className="button button-primary" disabled={busy}>{busy ? "Salvando..." : "Salvar minhas respostas"}</button></div>
                  </form> : item.answers.map((answer) => <p className="encounter-answer" key={answer.questionId}><strong>{answer.question}</strong><span>{answer.answer || (isTherapist ? "Aguardando resposta do paciente." : "Sem resposta ainda.")}</span></p>)}
                  {canEdit && <span className="encounter-record-action">Clique para adicionar perguntas ou editar respostas</span>}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "diagnosis" && (
        <section className="panel encounter-panel" id="encounter-panel-diagnosis" role="tabpanel" aria-labelledby="encounter-tab-diagnosis">
          <div className="panel-heading"><div><h2>Diagnóstico</h2><p className="muted">Registros vinculados ao prontuário e a este atendimento.</p></div></div>
          {canEdit && (
            <form className="form-panel" onSubmit={saveDiagnosis}>
              <div className="form-grid">
                <label>Data do diagnóstico<input type="date" required value={diagnosisForm.diagnosedAt} onChange={(event) => setDiagnosisForm({ ...diagnosisForm, diagnosedAt: event.target.value })} /></label>
                <label className="span-two">Descrição<textarea required minLength={2} maxLength={4000} rows={4} value={diagnosisForm.description} onChange={(event) => setDiagnosisForm({ ...diagnosisForm, description: event.target.value })} /></label>
              </div>
              <div className="encounter-form-actions"><button className="button button-primary" disabled={busy}>{busy ? "Salvando..." : "Registrar diagnóstico"}</button></div>
            </form>
          )}
          {detail.diagnoses.length === 0 ? <p className="empty-state">Nenhum diagnóstico registrado neste atendimento.</p> : (
            <div className="encounter-record-list">
              {detail.diagnoses.map((item) => (
                <article className="encounter-record-card" key={item.id}>
                  <div className="record-topline"><span className="soft-badge">Diagnóstico</span><span className="muted">{formatClinicalDate(item.diagnosedAt)}</span></div>
                  <p className="encounter-record-description">{item.description}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "protocol" && (
        <section className="panel encounter-panel" id="encounter-panel-protocol" role="tabpanel" aria-labelledby="encounter-tab-protocol">
          <div className="panel-heading"><div><h2>Protocolo e etapas</h2><p className="muted">Vincule um protocolo à hipótese diagnóstica e acompanhe suas etapas.</p></div></div>
          {canEdit && <div className="protocol-create-area">
            <button type="button" className="button button-secondary" onClick={() => setShowProtocolCreateForm((open) => !open)}>{showProtocolCreateForm ? "Cancelar cadastro" : "+ Cadastrar protocolo"}</button>
            {showProtocolCreateForm && <form className="panel form-panel protocol-create-form" onSubmit={createProtocol}>
              <h3>Novo protocolo clínico</h3>
              <div className="form-grid">
                <label className="span-two">Diagnóstico associado<select required value={protocolForm.diagnosisId} onChange={(event) => setProtocolForm({ ...protocolForm, diagnosisId: event.target.value })}><option value="">Selecione o diagnóstico</option>{detail.diagnoses.map((item) => <option key={item.id} value={item.id}>{item.description}</option>)}</select></label>
                <label className="span-two">Nome do protocolo<input required minLength={2} maxLength={150} value={newProtocolForm.name} onChange={(event) => setNewProtocolForm({ ...newProtocolForm, name: event.target.value })} /></label>
                <label className="span-two">Sintomas<input required minLength={2} maxLength={4000} value={newProtocolForm.symptoms} onChange={(event) => setNewProtocolForm({ ...newProtocolForm, symptoms: event.target.value })} /></label>
                <label className="span-two">Objetivos<textarea required minLength={2} maxLength={4000} rows={2} value={newProtocolForm.objective} onChange={(event) => setNewProtocolForm({ ...newProtocolForm, objective: event.target.value })} /></label>
              </div>
              <div className="encounter-form-actions"><button className="button button-primary" disabled={busy || !detail.diagnoses.length}>{busy ? "Salvando..." : "Salvar protocolo"}</button></div>
            </form>}
            {unassignedProtocols.length > 0 && <section className="panel unassigned-protocol-panel"><h3>Protocolos ainda sem diagnóstico</h3><p className="muted">Vincule um protocolo já cadastrado ao diagnóstico selecionado para torná-lo visível neste atendimento.</p>{unassignedProtocols.map((protocol) => <article className="unassigned-protocol-row" key={protocol.id}><div><strong>{protocol.name}</strong>{protocol.symptoms && <small>Sintomas: {protocol.symptoms}</small>}{protocol.objective && <small>Objetivos: {protocol.objective}</small>}</div><button type="button" className="button button-secondary" disabled={busy || !protocolForm.diagnosisId} onClick={() => void linkUnassignedProtocol(protocol)}>Vincular ao diagnóstico</button></article>)}</section>}
          </div>}
          {canEdit && stageProtocol && <section className="panel protocol-stage-create-panel">
            <div className="panel-heading"><div><h3>Etapas de {stageProtocol.name}</h3><p className="muted">Adicione as etapas do protocolo. Cada nova etapa recebe a próxima sequência automaticamente.</p></div></div>
            <form className="form-panel" onSubmit={saveProtocolStage}>
              <label>Descrição da etapa<textarea required minLength={2} maxLength={1000} rows={2} value={newStageForm.description} onChange={(event) => setNewStageForm({ ...newStageForm, description: event.target.value })} /></label>
              <div className="form-grid"><label>Data inicial<input type="date" value={newStageForm.startsAt} onChange={(event) => setNewStageForm({ ...newStageForm, startsAt: event.target.value })} /></label><label>Data final<input type="date" value={newStageForm.endsAt} onChange={(event) => setNewStageForm({ ...newStageForm, endsAt: event.target.value })} /></label></div>
              <label>Observações<textarea maxLength={2000} rows={2} value={newStageForm.notes} onChange={(event) => setNewStageForm({ ...newStageForm, notes: event.target.value })} /></label>
              <div className="encounter-form-actions"><button className="button button-primary" disabled={busy}>{busy ? "Salvando..." : "Adicionar etapa"}</button></div>
            </form>
            {detail.protocolOptions.find((item) => item.id === stageProtocol.id)?.steps.map((step) => <article className="protocol-stage-draft-row" key={step.id}><strong>Etapa {step.sequence}</strong><span>{step.description}</span>{step.startsAt && <small>Início: {formatClinicalDate(step.startsAt)}</small>}</article>)}
          </section>}
          {canEdit && (
            <form className="encounter-attach-form" onSubmit={attachProtocol}>
              <label>Diagnóstico<select required value={protocolForm.diagnosisId} onChange={(event) => setProtocolForm({ ...protocolForm, diagnosisId: event.target.value })}>
                <option value="">Selecione</option>{detail.diagnoses.map((item) => <option key={item.id} value={item.id}>{item.description}</option>)}
              </select></label>
              <label>Protocolo clínico<select required value={protocolForm.protocolId} onChange={(event) => setProtocolForm({ ...protocolForm, protocolId: event.target.value })}>
                <option value="">Selecione</option>{detail.protocolOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select></label>
              <button className="button button-primary" disabled={busy || !detail.diagnoses.length || !detail.protocolOptions.some((item) => item.steps.length > 0)}>
                {busy ? "Vinculando..." : "Vincular protocolo"}
              </button>
              {detail.protocolOptions.length === 0 && <p className="field-hint">Ainda não há protocolos com etapas cadastradas para esta terapia.</p>}
            </form>
          )}
          {protocolCatalogGroups.length > 0 && <div className="encounter-diagnosis-protocol-list protocol-catalog-by-diagnosis">
            <h3>Protocolos cadastrados para os diagnósticos</h3>
            {protocolCatalogGroups.map((diagnosis) => <section className="encounter-diagnosis-protocol-group" key={diagnosis.diagnosisId}>
              <header className="encounter-diagnosis-protocol-heading"><div className="record-topline"><span className="soft-badge">Diagnóstico</span><span className="muted">{formatClinicalDate(diagnosis.diagnosedAt)}</span></div><p className="encounter-record-description">{diagnosis.diagnosisDescription}</p></header>
              {diagnosis.protocols.map((protocol) => <article className="encounter-linked-protocol protocol-catalog-card" key={protocol.id}>
                <div className="panel-heading"><h3>{protocol.name}</h3>{canEdit && <button type="button" className="button button-secondary" onClick={() => { setStageProtocol({ id: protocol.id, name: protocol.name }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Adicionar etapas</button>}</div>
                {protocol.symptoms && <p><strong>Sintomas:</strong> {protocol.symptoms}</p>}{protocol.objective && <p><strong>Objetivos:</strong> {protocol.objective}</p>}
                {protocol.steps.length ? <div className="protocol-catalog-step-list">{protocol.steps.map((step) => <div className="protocol-stage-draft-row" key={step.id}><strong>Etapa {step.sequence}</strong><span>{step.description}</span>{step.startsAt && <small>{formatClinicalDate(step.startsAt)}{step.endsAt ? ` – ${formatClinicalDate(step.endsAt)}` : ""}</small>}</div>)}</div> : <p className="muted">Protocolo cadastrado; ainda sem etapas.</p>}
              </article>)}
            </section>)}
          </div>}
          {protocolGroups.length === 0 ? <p className="empty-state">Nenhuma etapa de protocolo vinculada a este atendimento.</p> : (
            <div className="encounter-diagnosis-protocol-list">
              {protocolGroups.map((diagnosis) => (
                <section className="encounter-diagnosis-protocol-group" key={diagnosis.diagnosisId}>
                  <header className="encounter-diagnosis-protocol-heading">
                    <div className="record-topline"><span className="soft-badge">Diagnóstico</span><span className="muted">{formatClinicalDate(diagnosis.diagnosedAt)}</span></div>
                    <p className="encounter-record-description">{diagnosis.diagnosisDescription}</p>
                  </header>
                  {diagnosis.protocols.map((protocol) => (
                    <section className="encounter-linked-protocol" key={protocol.protocolId}>
                      <h3>{protocol.protocolName}</h3>
                      <div className="encounter-stage-list">
                        {protocol.stages.map((item) => (
                          <article className="encounter-stage-card" key={item.diagnosisProtocolId}>
                            <div className="encounter-stage-heading">
                              <div><span className="eyebrow">Etapa {item.sequence}</span><h4>{item.stepDescription}</h4></div>
                              <span className={`status-pill status-${item.status.toLowerCase()}`}>{stageStatusLabels[item.status]}</span>
                            </div>
                            {(item.startsAt || item.endsAt) && <p className="muted">Período: {item.startsAt ?? "—"} a {item.endsAt ?? "—"}</p>}
                            {item.stepNotes && <p className="encounter-record-description">{item.stepNotes}</p>}
                            {canEdit && (
                              <label className="encounter-status-field">Status da etapa
                                <select value={item.status} disabled={busy} onChange={(event) => updateStage(item.diagnosisProtocolId, event.target.value as keyof typeof stageStatusLabels)}>
                                  {Object.entries(stageStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
                                </select>
                              </label>
                            )}
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </section>
              ))}
            </div>
          )}
          {detail.protocolOptions.length > 0 && (
            <div className="encounter-protocol-catalog">
              <h3>Etapas previstas</h3>
              {detail.protocolOptions.map((protocol) => (
                <details key={protocol.id}>
                  <summary>{protocol.name} <span>{protocol.steps.length} etapas</span></summary>
                  {protocol.description && <p><strong>Sintomas:</strong> {protocol.description}</p>}
                  {protocol.objective && <p><strong>Objetivos:</strong> {protocol.objective}</p>}
                  {protocol.steps.length > 0 ? <ol>{protocol.steps.map((step) => <li key={step.id}>{step.description}{step.notes ? ` — ${step.notes}` : ""}</li>)}</ol> : <p>Este protocolo ainda não possui etapas cadastradas.</p>}
                </details>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "evolutions" && (
        <section className="panel encounter-panel" id="encounter-panel-evolutions" role="tabpanel" aria-labelledby="encounter-tab-evolutions">
          <div className="panel-heading"><div><h2>Evoluções</h2><p className="muted">Registre a evolução clínica associada a uma etapa do protocolo.</p></div></div>
          {canEdit && (
            <form className="form-panel" onSubmit={saveEvolution}>
              <div className="form-grid">
                <label className="span-two">Etapa do protocolo<select required value={evolutionForm.diagnosisProtocolId} onChange={(event) => {
                  const nextStage = detail.protocols.find((item) => item.diagnosisProtocolId === event.target.value);
                  const eligibility = nextStage ? evolutionStageEligibility(nextStage, detail.protocols, detail.evolutions) : null;
                  setEvolutionForm({ ...evolutionForm, diagnosisProtocolId: event.target.value, ...(eligibility?.minDate && eligibility.minDate > today() ? { evolvedAt: eligibility.minDate } : {}) });
                }}>
                  <option value="">Selecione</option>{[...detail.protocols].sort((first, second) => dateOrderValue(second.diagnosedAt) - dateOrderValue(first.diagnosedAt) || first.protocolName.localeCompare(second.protocolName, "pt-BR") || dateOrderValue(first.startsAt) - dateOrderValue(second.startsAt) || first.sequence - second.sequence).map((item) => {
                    const eligibility = evolutionStageEligibility(item, detail.protocols, detail.evolutions);
                    return <option key={item.diagnosisProtocolId} value={item.diagnosisProtocolId} disabled={!eligibility.allowed}>{item.protocolName} · Etapa {item.sequence}: {item.stepDescription}{eligibility.missingSequence ? ` (aguarda evolução da etapa ${eligibility.missingSequence})` : ""}</option>;
                  })}
                </select></label>
                <label>Data<input type="date" required min={selectedEvolutionEligibility?.minDate ?? undefined} value={evolutionForm.evolvedAt} onChange={(event) => setEvolutionForm({ ...evolutionForm, evolvedAt: event.target.value })} /></label>
                <label>Status<select value={evolutionForm.status} onChange={(event) => setEvolutionForm({ ...evolutionForm, status: event.target.value as keyof typeof evolutionStatusLabels })}>
                  {Object.entries(evolutionStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
                </select></label>
                <label className="span-two">Descrição da evolução<textarea required minLength={2} maxLength={4000} rows={4} value={evolutionForm.description} onChange={(event) => setEvolutionForm({ ...evolutionForm, description: event.target.value })} /></label>
              </div>
              <div className="encounter-form-actions"><button className="button button-primary" disabled={busy || detail.protocols.length === 0 || !selectedEvolutionEligibility?.allowed || !evolutionDateIsValid}>{busy ? "Salvando..." : "Salvar evolução"}</button></div>
              {selectedEvolutionEligibility?.missingSequence && <p className="field-hint">Registre uma evolução para a etapa {selectedEvolutionEligibility.missingSequence} antes de avançar.</p>}
              {selectedEvolutionEligibility?.minDate && !evolutionDateIsValid && <p className="field-hint">A evolução deve seguir a cronologia das etapas, a partir de {formatClinicalDate(selectedEvolutionEligibility.minDate)}.</p>}
              {detail.protocols.length === 0 && <p className="field-hint">Vincule um protocolo com etapas antes de registrar evoluções.</p>}
            </form>
          )}
          {evolutionGroups.length === 0 ? <p className="empty-state">Nenhuma etapa de protocolo vinculada a um diagnóstico.</p> : (
            <div className="encounter-evolution-diagnoses">
              {evolutionGroups.map((diagnosis) => (
                <section className="encounter-evolution-diagnosis" key={diagnosis.diagnosisId}>
                  <header className="encounter-diagnosis-protocol-heading">
                    <div className="record-topline"><span className="soft-badge">Diagnóstico</span><span className="muted">{formatClinicalDate(diagnosis.diagnosedAt)}</span></div>
                    <p className="encounter-record-description">{diagnosis.diagnosisDescription}</p>
                  </header>
                  {diagnosis.protocols.map((protocol) => (
                    <section className="encounter-evolution-protocol" key={protocol.protocolId}>
                      <h3>{protocol.protocolName}</h3>
                      {protocol.stages.map((stage) => (
                        <section className="encounter-evolution-stage" key={stage.diagnosisProtocolId}>
                          <div className="encounter-stage-heading">
                            <div><span className="eyebrow">Etapa {stage.sequence}</span><h4>{stage.stepDescription}</h4><span className="muted">Início da etapa: {formatClinicalDate(stage.startsAt)}</span></div>
                            <span className={`status-pill status-${stage.status.toLowerCase()}`}>{stageStatusLabels[stage.status]}</span>
                          </div>
                          {stage.evolutions.length === 0 ? <p className="empty-state">Ainda não há evoluções registradas para esta etapa.</p> : (
                            <div className="encounter-stage-evolutions">
                              {stage.evolutions.map((item) => (
                                <article className="encounter-timeline-item" key={item.id}>
                                  <div className="record-topline"><span className="soft-badge">Evolução</span><span className={`status-pill status-${String(item.status ?? "unknown").toLowerCase()}`}>{evolutionStatusLabels[item.status] ?? "Status não informado"}</span></div>
                                  <p className="encounter-record-description">{item.description}</p>
                                  <span className="muted">{formatClinicalDate(item.evolvedAt)} · Por {item.authorName}</span>
                                </article>
                              ))}
                            </div>
                          )}
                        </section>
                      ))}
                    </section>
                  ))}
                </section>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

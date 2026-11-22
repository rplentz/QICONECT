import { useEffect, useState, type FormEvent } from "react";
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

const evolutionStatusLabels = { ...stageStatusLabels };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
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
  const [newQuestion, setNewQuestion] = useState("");
  const [questionSearch, setQuestionSearch] = useState("");
  const [showNewQuestion, setShowNewQuestion] = useState(false);
  const [examFiles, setExamFiles] = useState<File[]>([]);
  const [tongueFile, setTongueFile] = useState<File | null>(null);
  const [attachmentDescription, setAttachmentDescription] = useState("");
  const [anamnesisForm, setAnamnesisForm] = useState({ type: "Anamnese clínica", description: "", answers: {} as Record<string, string> });
  const [diagnosisForm, setDiagnosisForm] = useState({ description: "", diagnosedAt: today() });
  const [protocolForm, setProtocolForm] = useState({ diagnosisId: "", protocolId: "" });
  const [evolutionForm, setEvolutionForm] = useState({
    diagnosisProtocolId: "",
    description: "",
    evolvedAt: today(),
    status: "IN_PROGRESS" as keyof typeof evolutionStatusLabels,
  });

  async function load() {
    const result = await apiRequest<EncounterDetails>(`/encounters/${appointmentId}`);
    setDetail(result);
    setProtocolForm((current) => ({
      ...current,
      diagnosisId: current.diagnosisId || result.diagnoses[0]?.id || "",
      protocolId: current.protocolId || result.protocolOptions[0]?.id || "",
    }));
    setEvolutionForm((current) => ({
      ...current,
      diagnosisProtocolId: current.diagnosisProtocolId || result.protocols[0]?.diagnosisProtocolId || "",
    }));
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
  }, [appointmentId]);

  useEffect(() => {
    const attendance = detail?.attendance;
    if (attendance?.status !== "IN_PROGRESS") return;
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(attendance.createdAt).getTime()) / 1000)));
    updateElapsed();
    const timerId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timerId);
  }, [detail?.attendance?.createdAt, detail?.attendance?.status]);

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
        : current ? { ...current, questions: [...current.questions, result.question] } : current);
      setSelectedQuestionIds((current) => current.includes(result.question.id) ? current : [...current, result.question.id]);
      setNewQuestion("");
      setShowNewQuestion(false);
      setNotice("Pergunta adicionada e selecionada para esta anamnese.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar a pergunta.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAttachments() {
    if (!detail || !canEdit || (!examFiles.length && !tongueFile)) return;
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
        await apiRequest(`/encounters/${appointmentId}/attachments`, {
          method: "POST",
          body: JSON.stringify({
            type: item.type,
            originalFilename: item.file.name,
            contentType,
            contentBase64: await fileToBase64(item.file),
            description: attachmentDescription.trim() || undefined,
          }),
        });
      }
      setExamFiles([]);
      setTongueFile(null);
      setAttachmentDescription("");
      setNotice("Arquivos enviados para o atendimento.");
      await load();
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

  function saveAnamnesis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    if (selectedQuestionIds.length === 0) {
      setError("Selecione pelo menos uma pergunta para salvar a anamnese.");
      return;
    }
    const answers = detail.questions
      .filter((question) => selectedQuestionIds.includes(question.id))
      .map((question) => ({ questionId: question.id, answer: anamnesisForm.answers[question.id]?.trim() ?? "" }))
      .filter((answer) => answer.answer.length > 0);
    void mutate(
      editingAnamnesisId
        ? `/encounters/${appointmentId}/anamneses/${editingAnamnesisId}`
        : `/encounters/${appointmentId}/anamneses`,
      editingAnamnesisId ? "PATCH" : "POST",
      { type: anamnesisForm.type, description: anamnesisForm.description, selectedQuestionIds, answers },
      editingAnamnesisId ? "Anamnese atualizada." : "Anamnese salva.",
    ).then((saved) => {
      if (saved) {
        setEditingAnamnesisId(null);
        setSelectedQuestionIds([]);
        setAnamnesisForm((current) => ({ ...current, description: "", answers: {} }));
      }
    });
  }

  function editAnamnesis(anamnesis: EncounterDetails["anamneses"][number]) {
    setEditingAnamnesisId(anamnesis.id);
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
  const canStart = isTherapist && !detail.attendance && detail.appointment.appointmentStatus === "CONFIRMED";
  const filteredQuestions = detail.questions.filter((question) =>
    question.description.toLocaleLowerCase("pt-BR").includes(questionSearch.trim().toLocaleLowerCase("pt-BR")),
  );
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
            className={`encounter-tab ${tab === item.id ? "encounter-tab-active" : ""}`}
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "anamnesis" && (
        <section className="panel encounter-panel" role="tabpanel">
          <div className="panel-heading">
            <div><h2>Anamnese</h2><p className="muted">Queixa principal, descrição clínica e respostas às perguntas da terapia.</p></div>
          </div>
          {canEdit && (
            <form className="form-panel" onSubmit={saveAnamnesis}>
              <div className="form-grid">
                {editingAnamnesisId && <div className="span-two edit-anamnesis-banner"><strong>Editando anamnese existente</strong><button type="button" className="button button-secondary" onClick={cancelAnamnesisEdit}>Cancelar edição</button></div>}
                <label>Tipo<input required minLength={2} maxLength={100} value={anamnesisForm.type} onChange={(event) => setAnamnesisForm({ ...anamnesisForm, type: event.target.value })} /></label>
                <label className="span-two">Queixa principal e descrição<textarea required minLength={2} maxLength={4000} rows={4} value={anamnesisForm.description} onChange={(event) => setAnamnesisForm({ ...anamnesisForm, description: event.target.value })} /></label>
                <div className="span-two anamnesis-question-picker">
                  <div className="question-picker-heading">
                    <div>
                      <strong>Gerenciador de perguntas</strong>
                      <p className="field-hint">Selecione as perguntas existentes que farão parte desta anamnese.</p>
                    </div>
                    <button type="button" className="button button-secondary" onClick={() => setShowNewQuestion((current) => !current)}>
                      {showNewQuestion ? "Fechar cadastro" : "+ Adicionar nova pergunta"}
                    </button>
                  </div>
                  <input className="question-search-input" value={questionSearch} onChange={(event) => setQuestionSearch(event.target.value)} placeholder="Buscar pergunta existente..." aria-label="Buscar pergunta existente" />
                  {detail.questions.length === 0 ? <p className="empty-state">Nenhuma pergunta cadastrada para esta terapia.</p> : filteredQuestions.length === 0 ? <p className="empty-state">Nenhuma pergunta corresponde à busca.</p> : (
                    <div className="anamnesis-question-list">
                      {filteredQuestions.map((question) => (
                        <label className="checkbox-option" key={question.id}>
                          <input
                            type="checkbox"
                            checked={selectedQuestionIds.includes(question.id)}
                            onChange={(event) => setSelectedQuestionIds((current) => event.target.checked
                              ? [...current, question.id]
                              : current.filter((id) => id !== question.id))}
                          />
                          <span>{question.description}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {showNewQuestion && <div className="anamnesis-new-question">
                    <label>Nova pergunta<input required minLength={2} maxLength={500} value={newQuestion} onChange={(event) => setNewQuestion(event.target.value)} placeholder="Ex.: Como está sua qualidade do sono?" /></label>
                    <button type="button" className="button button-secondary" disabled={busy || newQuestion.trim().length < 2} onClick={() => void createQuestion()}>{busy ? "Adicionando..." : "Criar pergunta"}</button>
                  </div>}
                </div>
                {detail.questions.filter((question) => selectedQuestionIds.includes(question.id)).map((question) => (
                  <label className="span-two" key={question.id}>{question.description}
                    <textarea rows={2} value={anamnesisForm.answers[question.id] ?? ""} onChange={(event) => setAnamnesisForm({
                      ...anamnesisForm,
                      answers: { ...anamnesisForm.answers, [question.id]: event.target.value },
                    })} />
                  </label>
                ))}
              </div>
              <div className="encounter-form-actions"><button className="button button-primary" disabled={busy || selectedQuestionIds.length === 0}>{busy ? "Salvando..." : editingAnamnesisId ? "Atualizar anamnese" : "Salvar anamnese"}</button></div>
            </form>
          )}
          {detail.attendance && (
            <section className="encounter-attachments-panel" aria-labelledby="attachments-title">
              <div className="panel-heading">
                <div><h3 id="attachments-title">Exames e fotos da língua</h3><p className="muted">Anexe documentos e imagens para apoiar a avaliação deste atendimento.</p></div>
              </div>
              {canEdit && <div className="attachment-upload-grid">
                <label>Exames (PDF, JPG ou PNG)<input type="file" accept="application/pdf,image/jpeg,image/png" multiple disabled={busy} onChange={(event) => setExamFiles(Array.from(event.target.files ?? []))} /></label>
                <label>Foto da língua (JPG ou PNG)<input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={(event) => setTongueFile(event.target.files?.[0] ?? null)} /></label>
                <label className="span-two">Observações<textarea rows={2} maxLength={1000} value={attachmentDescription} disabled={busy} onChange={(event) => setAttachmentDescription(event.target.value)} placeholder="Observações sobre os arquivos" /></label>
                <div className="encounter-form-actions span-two"><button type="button" className="button button-primary" disabled={busy || (!examFiles.length && !tongueFile)} onClick={() => void uploadAttachments()}>{busy ? "Enviando..." : "Enviar arquivos"}</button></div>
              </div>}
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
                  {item.answers.map((answer) => <p className="encounter-answer" key={answer.questionId}><strong>{answer.question}</strong><span>{answer.answer}</span></p>)}
                  {canEdit && <span className="encounter-record-action">Clique para adicionar perguntas ou editar respostas</span>}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "diagnosis" && (
        <section className="panel encounter-panel" role="tabpanel">
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
                  <div className="record-topline"><span className="soft-badge">Diagnóstico</span><span className="muted">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(`${item.diagnosedAt}T12:00:00`))}</span></div>
                  <p className="encounter-record-description">{item.description}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "protocol" && (
        <section className="panel encounter-panel" role="tabpanel">
          <div className="panel-heading"><div><h2>Protocolo e etapas</h2><p className="muted">Vincule um protocolo à hipótese diagnóstica e acompanhe suas etapas.</p></div></div>
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
              {detail.protocolOptions.length === 0 && <p className="field-hint">Não há protocolos ativos cadastrados para esta terapia.</p>}
            </form>
          )}
          {detail.protocols.length === 0 ? <p className="empty-state">Nenhuma etapa de protocolo vinculada a este atendimento.</p> : (
            <div className="encounter-stage-list">
              {detail.protocols.map((item) => (
                <article className="encounter-stage-card" key={item.diagnosisProtocolId}>
                  <div className="encounter-stage-heading">
                    <div><span className="eyebrow">Etapa {item.sequence}</span><h3>{item.stepDescription}</h3><p className="muted">{item.protocolName} · Diagnóstico: {item.diagnosisDescription}</p></div>
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
          )}
          {detail.protocolOptions.length > 0 && (
            <div className="encounter-protocol-catalog">
              <h3>Etapas previstas</h3>
              {detail.protocolOptions.map((protocol) => (
                <details key={protocol.id}>
                  <summary>{protocol.name} <span>{protocol.steps.length} etapas</span></summary>
                  {protocol.objective && <p>{protocol.objective}</p>}
                  {protocol.steps.length > 0 ? <ol>{protocol.steps.map((step) => <li key={step.id}>{step.description}{step.notes ? ` — ${step.notes}` : ""}</li>)}</ol> : <p>Este protocolo ainda não possui etapas cadastradas.</p>}
                </details>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "evolutions" && (
        <section className="panel encounter-panel" role="tabpanel">
          <div className="panel-heading"><div><h2>Evoluções</h2><p className="muted">Registre a evolução clínica associada a uma etapa do protocolo.</p></div></div>
          {canEdit && (
            <form className="form-panel" onSubmit={saveEvolution}>
              <div className="form-grid">
                <label className="span-two">Etapa do protocolo<select required value={evolutionForm.diagnosisProtocolId} onChange={(event) => setEvolutionForm({ ...evolutionForm, diagnosisProtocolId: event.target.value })}>
                  <option value="">Selecione</option>{detail.protocols.map((item) => <option key={item.diagnosisProtocolId} value={item.diagnosisProtocolId}>{item.protocolName} · Etapa {item.sequence}: {item.stepDescription}</option>)}
                </select></label>
                <label>Data<input type="date" required value={evolutionForm.evolvedAt} onChange={(event) => setEvolutionForm({ ...evolutionForm, evolvedAt: event.target.value })} /></label>
                <label>Status<select value={evolutionForm.status} onChange={(event) => setEvolutionForm({ ...evolutionForm, status: event.target.value as keyof typeof evolutionStatusLabels })}>
                  {Object.entries(evolutionStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
                </select></label>
                <label className="span-two">Descrição da evolução<textarea required minLength={2} maxLength={4000} rows={4} value={evolutionForm.description} onChange={(event) => setEvolutionForm({ ...evolutionForm, description: event.target.value })} /></label>
              </div>
              <div className="encounter-form-actions"><button className="button button-primary" disabled={busy || detail.protocols.length === 0}>{busy ? "Salvando..." : "Salvar evolução"}</button></div>
              {detail.protocols.length === 0 && <p className="field-hint">Vincule um protocolo com etapas antes de registrar evoluções.</p>}
            </form>
          )}
          {detail.evolutions.length === 0 ? <p className="empty-state">Nenhuma evolução registrada.</p> : (
            <div className="encounter-timeline">
              {detail.evolutions.map((item) => (
                <article className="encounter-timeline-item" key={item.id}>
                  <div className="record-topline"><span className="soft-badge">{item.protocolName} · Etapa {item.sequence}</span><span className={`status-pill status-${item.status.toLowerCase()}`}>{evolutionStatusLabels[item.status]}</span></div>
                  <p className="encounter-record-description">{item.description}</p>
                  <span className="muted">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(`${item.evolvedAt}T12:00:00`))} · Por {item.authorName}</span>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

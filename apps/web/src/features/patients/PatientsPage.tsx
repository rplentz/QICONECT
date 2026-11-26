import { digitsOnly, formatCpf, formatPhone, MaskedInput } from "../../lib/masked-input.js";
import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, type EncounterSummary, type Patient, type Session } from "../../lib/api.js";

interface PatientsPageProps {
  session: Session;
  selectedPatientId?: string;
  onSelectPatient: (patientId: string) => void;
  onClearSelection: () => void;
  onOpenEncounters: (patientId: string) => void;
  onOpenEncounter: (appointmentId: string) => void;
  title?: string;
}

const emptyForm = { fullName: "", email: "", phone: "", password: "", birthDate: "", cpf: "" };
const emptyUpdateForm = { fullName: "", email: "", phone: "", birthDate: "", cpf: "" };

function displayPhone(value: string | null | undefined) {
  return value ? formatPhone(value) : "—";
}

export function PatientsPage({ session, selectedPatientId, onSelectPatient, onClearSelection, onOpenEncounters, onOpenEncounter, title }: PatientsPageProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientEncounters, setPatientEncounters] = useState<EncounterSummary[]>([]);
  const [encountersLoading, setEncountersLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [updateForm, setUpdateForm] = useState(emptyUpdateForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const canManage = session.activeClinic.role !== "PATIENT";
  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId);

  async function loadPatients(searchTerm = search) {
    const query = searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : "";
    const result = await apiRequest<{ patients: Patient[] }>(`/patients${query}`);
    setPatients(result.patients.map((patient) => ({ ...patient, id: String(patient.id) })));
  }

  useEffect(() => {
    loadPatients().catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!selectedPatientId || !canManage) { setPatientEncounters([]); return; }
    let active = true; setEncountersLoading(true);
    apiRequest<{ encounters: EncounterSummary[] }>("/encounters")
      .then(({ encounters }) => { if (active) setPatientEncounters(encounters.filter((item) => String(item.patientId) === String(selectedPatientId))); })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setEncountersLoading(false); });
    return () => { active = false; };
  }, [selectedPatientId, canManage]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    try {
      await apiRequest("/patients", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          phone: digitsOnly(form.phone) || undefined,
          birthDate: form.birthDate || undefined,
          cpf: digitsOnly(form.cpf) || undefined,
        }),
      });
      setForm(emptyForm);
      setShowForm(false);
      setSuccess("Cadastro de paciente criado.");
      await loadPatients();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível cadastrar o paciente.");
    }
  }

  async function submitUpdateRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    try {
      await apiRequest("/patients/update-requests", {
        method: "POST",
        body: JSON.stringify({
          fullName: updateForm.fullName || undefined,
          email: updateForm.email || undefined,
          phone: digitsOnly(updateForm.phone) || undefined,
          birthDate: updateForm.birthDate || undefined,
          cpf: digitsOnly(updateForm.cpf) || undefined,
        }),
      });
      setUpdateForm(emptyUpdateForm);
      setSuccess("Cadastro atualizado.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar a solicitação.");
    }
  }

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Relacionamento clínico</p>
          <h1>{title ?? (canManage ? "Pacientes" : "Meu cadastro")}</h1>
          <p className="muted">Dados pessoais e vínculos na clínica selecionada.</p>
        </div>
        {canManage && (
          <button className="button button-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Fechar cadastro" : "+ Novo paciente"}
          </button>
        )}
      </div>
      {error && <p className="alert alert-error">{error}</p>}
      {success && <p className="alert alert-success">{success}</p>}
      {selectedPatient && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Ficha do paciente</p>
              <h2>{selectedPatient.fullName}</h2>
            </div>
            <button className="button button-quiet" onClick={onClearSelection}>Voltar à lista</button>
          </div>
          <div className="form-grid">
            <div><span className="field-hint">E-mail</span><p>{selectedPatient.email}</p></div>
            <div><span className="field-hint">Telefone</span><p>{displayPhone(selectedPatient.phone)}</p></div>
            <div><span className="field-hint">CPF</span><p>{selectedPatient.cpf ? formatCpf(selectedPatient.cpf) : "—"}</p></div>
            <div><span className="field-hint">Nascimento</span><p>{selectedPatient.birthDate ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${selectedPatient.birthDate}T12:00:00`)) : "—"}</p></div>
            <div><span className="field-hint">Último atendimento</span><p>{selectedPatient.lastAppointmentAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(selectedPatient.lastAppointmentAt)) : "Nenhum atendimento"}</p></div>
          </div>
          {canManage && <button className="button button-secondary" onClick={() => onOpenEncounters(selectedPatient.id)}>Ver atendimentos</button>}
        </section>
      )}
      {canManage && selectedPatient && <section className="panel patient-encounters-panel" id="patient-encounters">
        <div className="panel-heading"><div><h2>Atendimentos de {selectedPatient.fullName}</h2><p className="muted">Histórico e próximos atendimentos deste paciente.</p></div><span className="soft-badge">{patientEncounters.length} {patientEncounters.length === 1 ? "atendimento" : "atendimentos"}</span></div>
        {encountersLoading ? <p className="empty-state">Carregando atendimentos...</p> : patientEncounters.length === 0 ? <p className="empty-state">Nenhum atendimento encontrado para este paciente.</p> : <div className="patient-encounter-list">{patientEncounters.map((item) => <article className="patient-encounter-row" key={item.appointmentId}>
          <div className="appointment-date"><strong>{new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(new Date(item.startsAt))}</strong><span>{new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(new Date(item.startsAt)).replace(".", "")}</span></div>
          <div className="patient-encounter-main"><strong>{item.therapyName}</strong><span>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.startsAt))}</span><small>Terapeuta: {item.therapistName}</small></div>
          <span className={`status-pill status-${item.appointmentStatus.toLowerCase()}`}>{item.appointmentStatus === "IN_PROGRESS" ? "Em atendimento" : item.appointmentStatus === "CONFIRMED" ? "Confirmado" : item.appointmentStatus === "CANCELLED" ? "Cancelado" : item.appointmentStatus === "RESCHEDULED" ? "Remarcado" : item.appointmentStatus}</span>
          <button type="button" className="button button-secondary" onClick={() => onOpenEncounter(item.appointmentId)}>Acessar atendimento</button>
        </article>)}</div>}
      </section>}
      {!canManage && patients[0] ? (
        <section className="panel profile-update-panel">
          <div className="panel-heading">
            <div>
              <h2>Atualização cadastral</h2>
              <p className="muted">Confira seus dados e informe ao terapeuta o que precisa ser alterado.</p>
            </div>
          </div>
          <form onSubmit={submitUpdateRequest}>
            <p className="field-hint">Os dados atuais são somente leitura. Preencha apenas os campos que deseja solicitar.</p>
            <div className="profile-update-grid">
              <div className="profile-update-heading"><strong>Dados atuais</strong><strong>Nova informação</strong></div>
              <div className="profile-update-row"><label>Nome completo<input readOnly value={patients[0].fullName} /></label><label>Nome completo<input value={updateForm.fullName} onChange={(event) => setUpdateForm({ ...updateForm, fullName: event.target.value })} placeholder="Informe o novo nome" /></label></div>
              <div className="profile-update-row"><label>E-mail<input readOnly value={patients[0].email} /></label><label>E-mail<input type="email" value={updateForm.email} onChange={(event) => setUpdateForm({ ...updateForm, email: event.target.value })} placeholder="Informe o novo e-mail" /></label></div>
              <div className="profile-update-row"><label>Telefone<input readOnly value={displayPhone(patients[0].phone)} /></label><label>Telefone<MaskedInput mask="phone" value={updateForm.phone} onValueChange={(value) => setUpdateForm({ ...updateForm, phone: value })} /></label></div>
              <div className="profile-update-row"><label>CPF<input readOnly value={patients[0].cpf ? formatCpf(patients[0].cpf) : ""} /></label><label>CPF<MaskedInput mask="cpf" value={updateForm.cpf} onValueChange={(value) => setUpdateForm({ ...updateForm, cpf: value })} /></label></div>
              <div className="profile-update-row"><label>Data de nascimento<input readOnly value={patients[0].birthDate ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${patients[0].birthDate}T12:00:00`)) : ""} /></label><label>Data de nascimento<MaskedInput mask="date" value={updateForm.birthDate} onValueChange={(value) => setUpdateForm({ ...updateForm, birthDate: value })} /></label></div>
            </div>
            <div className="encounter-form-actions"><button className="button button-primary">Salvar alterações</button></div>
          </form>
        </section>
      ) : canManage && showForm ? (
        <form className="panel form-panel" onSubmit={submit}>
          <h2>Novo paciente</h2>
          <p className="muted">A conta será vinculada somente a esta clínica. Compartilhe a senha inicial com segurança.</p>
          <div className="form-grid">
            <label>Nome completo<input required minLength={2} value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label>
            <label>E-mail<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
            <label>Telefone<MaskedInput mask="phone" value={form.phone} onValueChange={(value) => setForm({ ...form, phone: value })} /></label>
            <label>Nascimento<MaskedInput mask="date" value={form.birthDate} onValueChange={(value) => setForm({ ...form, birthDate: value })} /></label>
            <label>CPF<MaskedInput mask="cpf" value={form.cpf} onValueChange={(value) => setForm({ ...form, cpf: value })} /></label>
            <label>Senha inicial<input required type="password" minLength={10} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          </div>
          <button className="button button-primary">Salvar paciente</button>
        </form>
      ) : null}
      {canManage && !selectedPatient && <section className="panel">
        <div className="panel-heading">
          <div><h2>{patients.length} {patients.length === 1 ? "paciente" : "pacientes"}</h2><p className="muted">Cadastros ativos desta clínica.</p></div>
          {canManage && <input className="search-input" placeholder="Buscar paciente..." value={search} onChange={(event) => { setSearch(event.target.value); loadPatients(event.target.value).catch((reason: Error) => setError(reason.message)); }} />}
        </div>
        {patients.length === 0 ? (
          <p className="empty-state">Nenhum cadastro para exibir.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Paciente</th><th>E-mail</th><th>Telefone</th><th>Último atendimento</th></tr></thead>
              <tbody>
                {patients.map((patient) => (
                  <tr key={patient.id}>
                    <td><button className="patient-attendance-link" onClick={() => onSelectPatient(patient.id)}><span className="person-cell"><span className="avatar">{patient.fullName.charAt(0)}</span><strong>{patient.fullName}</strong></span></button></td>
                    <td>{patient.email}</td><td>{displayPhone(patient.phone)}</td>
                    <td>{patient.lastAppointmentAt ? <button className="patient-attendance-link" onClick={() => onOpenEncounters(patient.id)}>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(patient.lastAppointmentAt))}</button> : <span className="muted">Nenhum atendimento</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}
    </div>
  );
}

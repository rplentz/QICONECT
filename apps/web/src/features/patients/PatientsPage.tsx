import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, type Patient, type Session } from "../../lib/api.js";

interface PatientsPageProps {
  session: Session;
  selectedPatientId?: string;
  onSelectPatient: (patientId: string) => void;
  onClearSelection: () => void;
  onOpenEncounters: (patientId: string) => void;
}

const emptyForm = { fullName: "", email: "", phone: "", password: "", birthDate: "", cpf: "" };
const emptyUpdateForm = { fullName: "", email: "", phone: "", birthDate: "", cpf: "" };

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function formatCpf(value: string) {
  const digits = digitsOnly(value).slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function formatPhone(value: string) {
  let digits = digitsOnly(value);
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function displayPhone(value: string | null | undefined) {
  return value ? formatPhone(value) : "—";
}

export function PatientsPage({ session, selectedPatientId, onSelectPatient, onClearSelection, onOpenEncounters }: PatientsPageProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
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
    setPatients(result.patients);
  }

  useEffect(() => {
    loadPatients().catch((reason: Error) => setError(reason.message));
  }, []);

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
          <h1>{canManage ? "Pacientes" : "Meu cadastro"}</h1>
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
              <div className="profile-update-row"><label>Telefone<input readOnly value={displayPhone(patients[0].phone)} /></label><label>Telefone<input type="tel" inputMode="tel" maxLength={15} value={updateForm.phone} onChange={(event) => setUpdateForm({ ...updateForm, phone: formatPhone(event.target.value) })} placeholder="(48) 99999-9999" /></label></div>
              <div className="profile-update-row"><label>CPF<input readOnly value={patients[0].cpf ? formatCpf(patients[0].cpf) : ""} /></label><label>CPF<input inputMode="numeric" maxLength={14} value={updateForm.cpf} onChange={(event) => setUpdateForm({ ...updateForm, cpf: formatCpf(event.target.value) })} placeholder="000.000.000-00" /></label></div>
              <div className="profile-update-row"><label>Data de nascimento<input readOnly value={patients[0].birthDate ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${patients[0].birthDate}T12:00:00`)) : ""} /></label><label>Data de nascimento<input type="date" value={updateForm.birthDate} onChange={(event) => setUpdateForm({ ...updateForm, birthDate: event.target.value })} /></label></div>
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
            <label>Telefone<input type="tel" inputMode="tel" maxLength={15} placeholder="(48) 99999-9999" value={form.phone} onChange={(event) => setForm({ ...form, phone: formatPhone(event.target.value) })} /></label>
            <label>Nascimento<input type="date" value={form.birthDate} onChange={(event) => setForm({ ...form, birthDate: event.target.value })} /></label>
            <label>CPF<input inputMode="numeric" maxLength={14} placeholder="000.000.000-00" value={form.cpf} onChange={(event) => setForm({ ...form, cpf: formatCpf(event.target.value) })} /></label>
            <label>Senha inicial<input required type="password" minLength={10} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          </div>
          <button className="button button-primary">Salvar paciente</button>
        </form>
      ) : null}
      {canManage && <section className="panel">
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

import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, type Patient, type Session } from "../../lib/api.js";

interface PatientsPageProps {
  session: Session;
}

const emptyForm = { fullName: "", email: "", phone: "", password: "", birthDate: "", cpf: "" };

export function PatientsPage({ session }: PatientsPageProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const canManage = session.activeClinic.role !== "PATIENT";

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
          phone: form.phone || undefined,
          birthDate: form.birthDate || undefined,
          cpf: form.cpf || undefined,
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
      {showForm && (
        <form className="panel form-panel" onSubmit={submit}>
          <h2>Novo paciente</h2>
          <p className="muted">A conta será vinculada somente a esta clínica. Compartilhe a senha inicial com segurança.</p>
          <div className="form-grid">
            <label>Nome completo<input required minLength={2} value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label>
            <label>E-mail<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
            <label>Telefone<input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
            <label>Nascimento<input type="date" value={form.birthDate} onChange={(event) => setForm({ ...form, birthDate: event.target.value })} /></label>
            <label>CPF<input value={form.cpf} onChange={(event) => setForm({ ...form, cpf: event.target.value })} /></label>
            <label>Senha inicial<input required type="password" minLength={10} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          </div>
          <button className="button button-primary">Salvar paciente</button>
        </form>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div><h2>{patients.length} {patients.length === 1 ? "paciente" : "pacientes"}</h2><p className="muted">Cadastros ativos desta clínica.</p></div>
          {canManage && <input className="search-input" placeholder="Buscar paciente..." value={search} onChange={(event) => { setSearch(event.target.value); loadPatients(event.target.value).catch((reason: Error) => setError(reason.message)); }} />}
        </div>
        {patients.length === 0 ? (
          <p className="empty-state">Nenhum cadastro para exibir.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Paciente</th><th>E-mail</th><th>Telefone</th><th>Nascimento</th></tr></thead>
              <tbody>
                {patients.map((patient) => (
                  <tr key={patient.membershipId}>
                    <td><span className="person-cell"><span className="avatar">{patient.fullName.charAt(0)}</span><strong>{patient.fullName}</strong></span></td>
                    <td>{patient.email}</td><td>{patient.phone || "—"}</td>
                    <td>{patient.birthDate ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${patient.birthDate}T12:00:00`)) : "—"}</td>
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

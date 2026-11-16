import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, type ClinicalRecord, type Patient, type Session } from "../../lib/api.js";

interface RecordsPageProps {
  session: Session;
}

const labels: Record<ClinicalRecord["type"], string> = {
  ANAMNESIS: "Anamnese",
  DIAGNOSIS: "Diagnóstico",
  PROTOCOL: "Protocolo",
  EVOLUTION: "Evolução",
};

export function RecordsPage({ session }: RecordsPageProps) {
  const [records, setRecords] = useState<ClinicalRecord[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [form, setForm] = useState({ patientMembershipId: "", type: "EVOLUTION" as ClinicalRecord["type"], title: "", content: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isTherapist = session.activeClinic.role === "THERAPIST";

  async function load() {
    const results = await Promise.all([
      apiRequest<{ records: ClinicalRecord[] }>("/records"),
      ...(isTherapist ? [apiRequest<{ patients: Patient[] }>("/patients")] : []),
    ] as const);
    setRecords(results[0].records);
    setPatients(results[1]?.patients ?? []);
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
  }, []);

  async function saveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      await apiRequest("/records", {
        method: "POST",
        body: JSON.stringify({
          patientMembershipId: form.patientMembershipId,
          type: form.type,
          title: form.title,
          content: { observacao: form.content },
        }),
      });
      setForm({ ...form, title: "", content: "" });
      setNotice("Registro salvo no prontuário.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar o registro.");
    }
  }

  async function release(recordId: string) {
    try {
      await apiRequest(`/records/${recordId}/release`, { method: "POST" });
      setNotice("Registro liberado para o paciente.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível liberar o registro.");
    }
  }

  return (
    <div className="page-content">
      <div className="page-heading"><div><p className="eyebrow">Acompanhamento terapêutico</p><h1>Prontuário</h1><p className="muted">Registros clínicos protegidos por vínculo e permissão.</p></div></div>
      {error && <p className="alert alert-error">{error}</p>}
      {notice && <p className="alert alert-success">{notice}</p>}
      {isTherapist && (
        <form className="panel form-panel" onSubmit={saveRecord}>
          <h2>Novo registro clínico</h2>
          <div className="form-grid">
            <label>Paciente<select required value={form.patientMembershipId} onChange={(event) => setForm({ ...form, patientMembershipId: event.target.value })}>
              <option value="">Selecione</option>{patients.map((patient) => <option key={patient.membershipId} value={patient.membershipId}>{patient.fullName}</option>)}
            </select></label>
            <label>Tipo<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as ClinicalRecord["type"] })}>
              {Object.entries(labels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
            </select></label>
            <label className="span-two">Título<input required minLength={2} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
            <label className="span-two">Observações<textarea required rows={4} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} /></label>
          </div>
          <button className="button button-primary">Salvar registro</button>
        </form>
      )}
      <section className="panel">
        <div className="panel-heading"><div><h2>{isTherapist ? "Registros da clínica" : "Registros liberados para você"}</h2><p className="muted">Cada lançamento preserva autoria e data de criação.</p></div><span className="soft-badge">{records.length} registros</span></div>
        {records.length === 0 ? <p className="empty-state">Nenhum registro disponível.</p> : (
          <div className="record-list">
            {records.map((record) => (
              <article className="record-card" key={record.id}>
                <div className="record-topline"><span className="soft-badge">{labels[record.type]}</span><span className="muted">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(record.createdAt))}</span></div>
                <h3>{record.title}</h3>
                {record.patientName && <p className="muted">Paciente: {record.patientName}</p>}
                <p>{String(record.content.observacao ?? "Registro clínico")}</p>
                <div className="record-footer"><span className={record.releasedAt ? "status-pill status-confirmed" : "status-pill status-pending"}>{record.releasedAt ? "Liberado ao paciente" : "Visível apenas à equipe"}</span><span className="muted">Por {record.authorName}</span>
                  {isTherapist && !record.releasedAt && <button className="button button-secondary" onClick={() => release(record.id)}>Liberar para paciente</button>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

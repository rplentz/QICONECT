import { useEffect, useState } from "react";
import { apiRequest, type ClinicalRecord, type Session } from "../../lib/api.js";
import logoImage from "../../../../../Documentacao/Logo1.png";

interface Props { session: Session }

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character);
}

function formatClinicalDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data não informada" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function generateProntuario(records: ClinicalRecord[], session: Session) {
  const orderedRecords = [...records].sort((first, second) => (Date.parse(first.createdAt) || 0) - (Date.parse(second.createdAt) || 0));
  const generatedAt = new Date().toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" });
  const popup = window.open("", "_blank", "width=900,height=700");
  if (!popup) return;
  popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Prontuário - QIConect</title><style>body{font:14px Arial,sans-serif;color:#18251d;max-width:850px;margin:36px auto;line-height:1.5}header{display:flex;align-items:center;gap:16px;margin-bottom:22px}header img{width:64px;height:64px;object-fit:contain}h1{font-size:22px}h2{font-size:17px;border-bottom:1px solid #ccd8ce;padding-bottom:6px}.event{break-inside:avoid;border-bottom:1px solid #e1e7e2;padding:12px 0;white-space:pre-wrap}.date{font-size:11px;color:#52675a}@media print{body{margin:12mm auto}}</style></head><body><header><img src="${escapeHtml(logoImage)}" alt="QIConect"><div><h1>Prontuário</h1><div>${escapeHtml(session.activeClinic.name)}</div></div></header><p><b>Paciente:</b> ${session.activeClinic.role === "PATIENT" ? escapeHtml(session.user.fullName) : "Pacientes listados neste prontuário"}<br><b>Emitido por:</b> ${escapeHtml(session.user.fullName)}<br><b>Gerado em:</b> ${escapeHtml(generatedAt)}<br><b>Registros:</b> ${orderedRecords.length} evoluções clínicas</p><h2>Histórico cronológico</h2>${orderedRecords.length ? orderedRecords.map((record) => `<section class="event"><strong>${escapeHtml(record.patientName ? `${record.patientName} — ` : "")}${escapeHtml(record.title)}</strong><div class="date">${escapeHtml(formatClinicalDate(record.createdAt))} · ${escapeHtml(record.authorName)}</div><div>${escapeHtml(record.content.observacao ?? "")}</div></section>`).join("") : "<p>Não há registros clínicos neste prontuário.</p>"}<script>window.onload=()=>window.print()</script></body></html>`);
  popup.document.close();
}

export function RecordsPage({ session }: Props) {
  const [records, setRecords] = useState<ClinicalRecord[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    apiRequest<{ records: ClinicalRecord[] }>("/records")
      .then((result) => setRecords(result.records))
      .catch((reason: Error) => setError(reason.message));
  }, []);
  const isTherapist = session.activeClinic.role === "THERAPIST";
  return <div className="page-content">
    <div className="page-heading"><div><p className="eyebrow">Acompanhamento terapêutico</p><h1>Prontuário</h1><p className="muted">Evoluções clínicas vinculadas aos diagnósticos e etapas do protocolo.</p></div><button type="button" className="button button-secondary" onClick={() => generateProntuario(records, session)}>Gerar Prontuário</button></div>
    {error && <p className="alert alert-error">{error}</p>}
    <section className="panel"><div className="panel-heading"><div><h2>{isTherapist ? "Evoluções dos pacientes" : "Evoluções do seu prontuário"}</h2><p className="muted">As evoluções são registradas dentro do atendimento correspondente.</p></div><span className="soft-badge">{records.length} registros</span></div>
      {records.length === 0 ? <p className="empty-state">Nenhuma evolução encontrada.</p> : <div className="record-list">{records.map((record) => <article className="record-card" key={record.id}>
        <div className="record-topline"><span className="soft-badge">Evolução</span><span className="muted">{record.createdAt ? formatClinicalDate(record.createdAt) : ""}</span></div>
        {record.patientName && <p className="record-patient-name"><span>Paciente</span><strong>{record.patientName}</strong></p>}<h3>{record.title}</h3><p>{String(record.content.observacao ?? "")}</p><div className="record-footer"><span className="status-pill status-confirmed">Disponível no prontuário</span><span className="muted">Por {record.authorName}</span></div>
      </article>)}</div>}
    </section>
  </div>;
}

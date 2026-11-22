import { useEffect, useState } from "react";
import { apiRequest, type ClinicalRecord, type Session } from "../../lib/api.js";

interface Props { session: Session }
export function RecordsPage({ session }: Props) {
  const [records,setRecords]=useState<ClinicalRecord[]>([]);const [error,setError]=useState("");
  useEffect(()=>{apiRequest<{records:ClinicalRecord[]}>("/records").then(r=>setRecords(r.records)).catch((e:Error)=>setError(e.message));},[]);
  const isTherapist=session.activeClinic.role==="THERAPIST";
  return <div className="page-content">
    <div className="page-heading"><div><p className="eyebrow">Acompanhamento terapêutico</p><h1>Prontuário</h1><p className="muted">Evoluções clínicas vinculadas aos diagnósticos e etapas do protocolo.</p></div></div>
    {error&&<p className="alert alert-error">{error}</p>}
    <section className="panel"><div className="panel-heading"><div><h2>{isTherapist?"Evoluções dos pacientes":"Evoluções do seu prontuário"}</h2><p className="muted">As evoluções são registradas dentro do atendimento correspondente.</p></div><span className="soft-badge">{records.length} registros</span></div>
      {records.length===0?<p className="empty-state">Nenhuma evolução encontrada.</p>:<div className="record-list">{records.map(record=><article className="record-card" key={record.id}>
        <div className="record-topline"><span className="soft-badge">Evolução</span><span className="muted">{record.createdAt?new Intl.DateTimeFormat("pt-BR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(record.createdAt)):""}</span></div>
        {record.patientName&&<p className="muted">Paciente: {record.patientName}</p>}<h3>{record.title}</h3><p>{String(record.content.observacao??"")}</p><div className="record-footer"><span className="status-pill status-confirmed">Disponível no prontuário</span><span className="muted">Por {record.authorName}</span></div>
      </article>)}</div>}
    </section>
  </div>;
}

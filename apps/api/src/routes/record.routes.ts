import { Router } from "express";
import { db } from "../db/database.js";
import { getAuth, requireAuth } from "../middleware/auth.js";

export const recordRouter=Router();
recordRouter.get("/records",requireAuth,(request,response)=>{
 const auth=getAuth(request);const params:number[]=[];let where="";
 if(auth.role==="PATIENT"){where="WHERE p.usuario_id=?";params.push(Number(auth.userId));}
 else if(auth.role==="THERAPIST"){where="WHERE d.terapeuta_id=(SELECT id FROM TERAPEUTA WHERE usuario_id=?)";params.push(Number(auth.userId));}
 const rows=db.prepare(`SELECT e.id,CAST(d.paciente_id AS TEXT) AS patientId,pu.nome AS patientName,
   'EVOLUTION' AS type,'Evolução clínica' AS title,e.descricao AS description,e.dt_evolucao AS createdAt,
   tu.nome AS authorName FROM EVOLUCAO e JOIN DIAGNOSTICO_PROTOCOLO dp ON dp.id=e.diagnostico_protocolo_id
   JOIN DIAGNOSTICO d ON d.id=dp.diagnostico_id JOIN PACIENTE p ON p.id=d.paciente_id
   JOIN USUARIO pu ON pu.id=p.usuario_id JOIN TERAPEUTA t ON t.id=d.terapeuta_id JOIN USUARIO tu ON tu.id=t.usuario_id ${where}
   ORDER BY e.dt_evolucao DESC LIMIT 200`).all(...params) as Array<Record<string,any>>;
 response.json({records:rows.map(row=>({id:String(row.id),patientId:row.patientId,patientName:row.patientName,
   type:row.type,title:row.title,content:{observacao:row.description},createdAt:row.createdAt,authorName:row.authorName}))});
});

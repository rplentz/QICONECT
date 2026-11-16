#!/usr/bin/env python3
"""Replace QIConect data from a workbook while preserving one existing admin."""

from __future__ import annotations

import argparse
import hashlib
import json
import secrets
import sqlite3
import sys
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from import_excel_to_sqlite import (
    ROOT,
    safe_database_path,
    stable_id,
)
from import_excel_to_sqlite import read_workbook as read_partial_workbook


EXCEL_EPOCH = datetime(1899, 12, 30, tzinfo=timezone.utc)
PASSWORD_COLUMNS = {"senha", "password", "password_hash"}
PROFILE_BY_ROLE = {
    "CLINIC_ADMIN": "profile-company",
    "THERAPIST": "profile-therapist",
    "PATIENT": "profile-patient",
}


class ImportIssue(Exception):
    def __init__(self, reason: str, *fields: str):
        super().__init__(reason)
        self.reason = reason
        self.fields = list(fields)


def read_workbook(path: Path) -> dict[str, list[dict[str, str]]]:
    return read_partial_workbook(path, include_nonpassword_fields=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def value(row: dict[str, str], key: str, required: bool = True) -> str:
    result = row.get(key, "").strip()
    if required and not result:
        raise ImportIssue("REQUIRED_FIELD_MISSING", key)
    return result


def parse_date(raw: str, required: bool = True) -> str | None:
    text = raw.strip()
    if not text:
        if required:
            raise ImportIssue("REQUIRED_DATE_MISSING")
        return None

    try:
        serial = float(text)
        if 1 <= serial <= 100000:
            return (EXCEL_EPOCH + timedelta(days=serial)).isoformat()
    except ValueError:
        pass

    for pattern in (
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            parsed = datetime.strptime(text, pattern).replace(tzinfo=timezone.utc)
            return parsed.isoformat()
        except ValueError:
            continue
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except ValueError as error:
        raise ImportIssue("INVALID_DATE") from error


def parse_bool(raw: str, default: int = 1) -> int:
    normalized = raw.strip().casefold()
    if not normalized:
        return default
    if normalized in {"1", "true", "sim", "ativo", "ativa", "yes"}:
        return 1
    if normalized in {"0", "false", "não", "nao", "inativo", "inativa", "no"}:
        return 0
    raise ImportIssue("INVALID_BOOLEAN")


def parse_number(raw: str, required: bool = False) -> float | None:
    text = raw.strip()
    if not text:
        if required:
            raise ImportIssue("REQUIRED_NUMBER_MISSING")
        return None
    try:
        return float(text.replace(",", "."))
    except ValueError as error:
        raise ImportIssue("INVALID_NUMBER") from error


def parse_integer(raw: str) -> int:
    number = parse_number(raw, required=True)
    if number is None or not number.is_integer():
        raise ImportIssue("INVALID_INTEGER")
    return int(number)


def parse_status(raw: str, mapping: dict[str, str], default: str) -> str:
    normalized = raw.strip().casefold()
    if not normalized:
        return default
    result = mapping.get(normalized)
    if result is None:
        raise ImportIssue("UNSUPPORTED_STATUS")
    return result


def status_map(*entries: tuple[str, str]) -> dict[str, str]:
    return {source.casefold(): target for source, target in entries}


def make_password() -> tuple[str, str]:
    password = secrets.token_urlsafe(18)
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt.encode("ascii"),
        n=16384,
        r=8,
        p=1,
        dklen=64,
        maxmem=128 * 1024 * 1024,
    )
    return password, f"scrypt${salt}${digest.hex()}"


def target_id(source_name: str, sheet: str, row: dict[str, str]) -> str:
    return stable_id(source_name, sheet, value(row, "id"))


def insert(
    connection: sqlite3.Connection,
    table: str,
    columns: tuple[str, ...],
    parameters: tuple[Any, ...],
) -> None:
    placeholders = ", ".join("?" for _ in columns)
    column_names = ", ".join(columns)
    connection.execute(
        f"INSERT INTO {table} ({column_names}) VALUES ({placeholders})",
        parameters,
    )


def delete_existing_data(connection: sqlite3.Connection, admin_user_id: str) -> None:
    for table in (
        "workbook_import_rejections",
        "workbook_import_batches",
        "sessions",
        "appointment_events",
        "AUDITORIA",
        "notifications",
        "ANAMNESE_PERGUNTAS",
        "anamnesis_assignments",
        "anamnesis_question_options",
        "ANAMNESE",
        "ANEXO",
        "BIOWELL_CHAKRA",
        "BIOWELL_AVALIACAO",
        "ANALISE_LINGUA",
        "RELATORIO",
        "PAGAMENTO",
        "PACOTE",
        "EVOLUCAO",
        "DIAGNOSTICO_PROTOCOLO",
        "DIAGNOSTICO",
        "PROTOCOLO_ETAPA",
        "PROTOCOLO",
        "ATENDIMENTO",
        "AGENDA",
        "PRONTUARIO",
        "TERAPEUTA_ESPECIALIDADE",
        "therapist_therapies",
        "availability_rules",
        "schedule_blocks",
        "clinical_records",
        "PACIENTE",
        "TERAPEUTA",
        "memberships",
        "PERGUNTAS",
        "TERAPIA",
        "ESPECIALIDADE",
        "CLINICA",
    ):
        connection.execute(f"DELETE FROM {table}")
    connection.execute("DELETE FROM USUARIO WHERE id != ?", (admin_user_id,))


def ensure_patient_contact_columns(connection: sqlite3.Connection) -> None:
    columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(PACIENTE)")
    }
    for column in ("emergency_contact_name", "emergency_contact_phone"):
        if column not in columns:
            connection.execute(f"ALTER TABLE PACIENTE ADD COLUMN {column} TEXT")


def stage_row(
    connection: sqlite3.Connection,
    batch_id: str,
    source_name: str,
    sheet: str,
    row: dict[str, str],
    reason: str,
    fields: list[str] | None = None,
) -> None:
    source_id = row.get("id", "").strip() or None
    safe_payload = {
        key: item
        for key, item in row.items()
        if key.strip().casefold() not in PASSWORD_COLUMNS
    }
    insert(
        connection,
        "workbook_import_rejections",
        (
            "id", "batch_id", "sheet_name", "source_id", "reason_code",
            "unresolved_fields_json", "source_row_json", "created_at",
        ),
        (
            stable_id(source_name, f"REJECTED_{sheet}", source_id or reason),
            batch_id,
            sheet,
            source_id,
            reason,
            json.dumps(fields or [], ensure_ascii=False),
            json.dumps(safe_payload, ensure_ascii=False, sort_keys=True),
            utc_now(),
        ),
    )


def add_rejection(
    connection: sqlite3.Connection,
    batch_id: str,
    source_name: str,
    counts: dict[str, Counter[str]],
    sheet: str,
    row: dict[str, str],
    issue: ImportIssue,
) -> None:
    stage_row(connection, batch_id, source_name, sheet, row, issue.reason, issue.fields)
    counts.setdefault(sheet, Counter())["staged"] += 1
    counts[sheet][f"reason_{issue.reason.lower()}"] += 1


def reference(
    mapping: dict[str, str],
    raw: str,
    field: str,
    required: bool = True,
) -> str | None:
    source_id = raw.strip()
    if not source_id and not required:
        return None
    mapped = mapping.get(source_id)
    if mapped is None:
        raise ImportIssue("UNRESOLVED_REFERENCE", field)
    return mapped


def import_workbook(
    connection: sqlite3.Connection,
    batch_id: str,
    source_name: str,
    source_hash: str,
    sheets: dict[str, list[dict[str, str]]],
    admin_user_id: str,
) -> dict[str, Any]:
    now = utc_now()
    counts: dict[str, Counter[str]] = {
        sheet: Counter() for sheet in sheets
    }
    credentials: list[dict[str, str]] = []
    clinic_rows = sheets.get("CLINICA", [])
    if len(clinic_rows) != 1:
        raise RuntimeError("The workbook must contain exactly one CLINICA row.")
    clinic_row = clinic_rows[0]
    clinic_id = target_id(source_name, "CLINICA", clinic_row)
    source_clinic_id = value(clinic_row, "id")
    clinic_name = value(clinic_row, "nome")
    cnpj = "".join(ch for ch in clinic_row.get("cnpj", "") if ch.isdigit())
    if cnpj and len(cnpj) != 14:
        raise RuntimeError("Clinic CNPJ is not 14 digits; replacement cancelled.")
    insert(
        connection,
        "CLINICA",
        ("id", "slug", "nome", "timezone", "dt_registro", "cnpj", "email",
         "telefone", "endereco", "ativo", "dt_atualizacao"),
        (
            clinic_id,
            "workbook-" + clinic_id.replace("-", "")[:24],
            clinic_name,
            "America/Sao_Paulo",
            parse_date(clinic_row.get("dt_registro", ""), required=False) or now,
            cnpj or None,
            clinic_row.get("email", "").strip() or None,
            clinic_row.get("telefone", "").strip() or None,
            clinic_row.get("endereco", "").strip() or None,
            parse_bool(clinic_row.get("ativo", "1")),
            now,
        ),
    )
    counts["CLINICA"]["imported"] += 1

    profile_ids = {
        row["code"]: row["id"]
        for row in connection.execute("SELECT id, code FROM PERFIL")
    }
    for role, expected_profile in PROFILE_BY_ROLE.items():
        if profile_ids.get(role) != expected_profile:
            raise RuntimeError("The installed profile catalog differs from the workbook model.")
    profile_names = {
        row["nome"].strip().casefold(): row["id"]
        for row in connection.execute("SELECT id, nome FROM PERFIL")
    }
    for row in sheets.get("PERFIL", []):
        if row.get("nome", "").strip().casefold() in profile_names:
            counts["PERFIL"]["reused"] += 1
        else:
            raise RuntimeError("A workbook profile has no matching installed profile.")

    user_ids: dict[str, str] = {}
    user_rows = sheets.get("USUARIO", [])
    admin_email = connection.execute(
        "SELECT email FROM USUARIO WHERE id = ?", (admin_user_id,)
    ).fetchone()["email"].strip().casefold()
    seen_emails = {admin_email}
    for row in user_rows:
        try:
            source_id = value(row, "id")
            full_name = value(row, "nome")
            email = value(row, "email").casefold()
            phone = row.get("telefone", "").strip() or None
            if email in seen_emails:
                raise ImportIssue("DUPLICATE_EMAIL", "email")
            seen_emails.add(email)
            generated_id = target_id(source_name, "USUARIO", row)
            password, password_hash = make_password()
            insert(
                connection,
                "USUARIO",
                ("id", "email", "password_hash", "nome", "telefone", "ativo",
                 "dt_registro", "dt_ult_acesso", "dt_atualizacao"),
                (
                    generated_id,
                    email,
                    password_hash,
                    full_name,
                    phone,
                    1,
                    parse_date(row.get("dt_registro", ""), required=False) or now,
                    None,
                    now,
                ),
            )
            user_ids[source_id] = generated_id
            credentials.append({"email": email, "password": password})
            counts["USUARIO"]["imported_active"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "USUARIO", row, issue)

    admin_membership_id = stable_id(source_name, "ADMIN_MEMBERSHIP", admin_user_id)
    insert(
        connection,
        "memberships",
        ("id", "clinic_id", "user_id", "role", "status", "created_at", "profile_id"),
        (admin_membership_id, clinic_id, admin_user_id, "CLINIC_ADMIN", "ACTIVE", now, profile_ids["CLINIC_ADMIN"]),
    )

    patient_memberships: dict[str, str] = {}
    patient_by_user: set[str] = set()
    for row in sheets.get("PACIENTE", []):
        try:
            source_id = value(row, "id")
            if row.get("clinica_id", "").strip() != source_clinic_id:
                raise ImportIssue("UNRESOLVED_REFERENCE", "clinica_id")
            user_id = reference(user_ids, row.get("usuario_id", ""), "usuario_id")
            membership_id = stable_id(source_name, "PACIENTE_MEMBERSHIP", source_id)
            if user_id in patient_by_user:
                raise ImportIssue("DUPLICATE_ROLE_MEMBERSHIP", "usuario_id")
            patient_by_user.add(user_id)
            insert(
                connection,
                "memberships",
                ("id", "clinic_id", "user_id", "role", "status", "created_at", "profile_id"),
                (membership_id, clinic_id, user_id, "PATIENT", "ACTIVE", now, profile_ids["PATIENT"]),
            )
            patient_memberships[source_id] = membership_id
            cpf = "".join(ch for ch in row.get("cpf", "") if ch.isdigit())
            birth_date = parse_date(row.get("dt_nasc", ""), required=False)
            insert(
                connection,
                "PACIENTE",
                ("id", "usuario_id", "clinica_id", "telefone", "membership_id", "clinic_id",
                 "dt_nasc", "cpf", "endereco", "sexo", "ativo", "dt_atualizacao",
                 "emergency_contact_name", "emergency_contact_phone"),
                (
                    target_id(source_name, "PACIENTE", row),
                    user_id,
                    clinic_id,
                    phone,
                    membership_id,
                    clinic_id,
                    birth_date,
                    cpf or None,
                    row.get("endereco", "").strip() or None,
                    row.get("sexo", "").strip().upper() or None,
                    1,
                    now,
                    None,
                    None,
                ),
            )
            counts["PACIENTE"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "PACIENTE", row, issue)

    therapist_memberships: dict[str, str] = {}
    therapist_by_user: set[str] = set()
    for row in sheets.get("TERAPEUTA", []):
        try:
            source_id = value(row, "id")
            if row.get("clinica_id", "").strip() != source_clinic_id:
                raise ImportIssue("UNRESOLVED_REFERENCE", "clinica_id")
            user_id = reference(user_ids, row.get("usuario_id", ""), "usuario_id")
            if user_id in patient_by_user or user_id in therapist_by_user:
                raise ImportIssue("DUPLICATE_ROLE_MEMBERSHIP", "usuario_id")
            therapist_by_user.add(user_id)
            membership_id = stable_id(source_name, "TERAPEUTA_MEMBERSHIP", source_id)
            insert(
                connection,
                "memberships",
                ("id", "clinic_id", "user_id", "role", "status", "created_at", "profile_id"),
                (membership_id, clinic_id, user_id, "THERAPIST", "ACTIVE", now, profile_ids["THERAPIST"]),
            )
            therapist_memberships[source_id] = membership_id
            cpf = "".join(ch for ch in row.get("cpf", "") if ch.isdigit())
            insert(
                connection,
                "TERAPEUTA",
                ("id", "usuario_id", "clinica_id", "membership_id", "clinic_id",
                 "registro_prof", "cpf", "formacao", "ativo", "dt_atualizacao"),
                (
                    target_id(source_name, "TERAPEUTA", row),
                    user_id,
                    clinic_id,
                    membership_id,
                    clinic_id,
                    row.get("registro_prof", "").strip() or None,
                    cpf or None,
                    row.get("formacao", "").strip() or None,
                    1,
                    now,
                ),
            )
            counts["TERAPEUTA"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "TERAPEUTA", row, issue)

    specialty_ids: dict[str, str] = {}
    for row in sheets.get("ESPECIALIDADE", []):
        try:
            source_id = value(row, "id")
            generated_id = target_id(source_name, "ESPECIALIDADE", row)
            insert(
                connection,
                "ESPECIALIDADE",
                ("id", "clinic_id", "nome", "descricao", "ativo"),
                (
                    generated_id,
                    clinic_id,
                    value(row, "nome"),
                    row.get("descricao", "").strip() or None,
                    parse_bool(row.get("ativo", "1")),
                ),
            )
            specialty_ids[source_id] = generated_id
            counts["ESPECIALIDADE"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "ESPECIALIDADE", row, issue)

    therapist_specialties: set[tuple[str, str]] = set()
    for row in sheets.get("TERAPEUTA_ESPECIALIDADE", []):
        try:
            source_id = value(row, "id")
            source_therapist_id = value(row, "terapeuta_id")
            therapist_id = reference(therapist_memberships, source_therapist_id, "terapeuta_id")
            specialty_id = reference(specialty_ids, row.get("especialidade_id", ""), "especialidade_id")
            insert(
                connection,
                "TERAPEUTA_ESPECIALIDADE",
                ("id", "clinic_id", "therapist_membership_id", "terapeuta_id", "especialidade_id", "created_at"),
                (
                    target_id(source_name, "TERAPEUTA_ESPECIALIDADE", row),
                    clinic_id,
                    therapist_id,
                    stable_id(source_name, "TERAPEUTA", source_therapist_id),
                    specialty_id,
                    now,
                ),
            )
            therapist_specialties.add((source_therapist_id, row.get("especialidade_id", "").strip()))
            counts["TERAPEUTA_ESPECIALIDADE"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "TERAPEUTA_ESPECIALIDADE", row, issue)

    therapy_ids: dict[str, str] = {}
    for row in sheets.get("TERAPIA", []):
        try:
            source_id = value(row, "id")
            specialty_id = reference(specialty_ids, row.get("especialidade_id", ""), "especialidade_id")
            therapy_id = target_id(source_name, "TERAPIA", row)
            insert(
                connection,
                "TERAPIA",
                ("id", "clinic_id", "especialidade_id", "nome", "descricao", "duracao_min", "price", "ativa"),
                (
                    therapy_id,
                    clinic_id,
                    specialty_id,
                    value(row, "nome"),
                    row.get("descricao", "").strip() or None,
                    parse_integer(row.get("duracao_min", "")),
                    parse_number(row.get("valor", "")),
                    parse_bool(row.get("ativa", "1")),
                ),
            )
            therapy_ids[source_id] = therapy_id
            counts["TERAPIA"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "TERAPIA", row, issue)

    for therapist_source_id, specialty_source_id in therapist_specialties:
        membership_id = therapist_memberships[therapist_source_id]
        for row in sheets.get("TERAPIA", []):
            if row.get("especialidade_id", "").strip() != specialty_source_id:
                continue
            therapy_id = therapy_ids.get(row.get("id", "").strip())
            if therapy_id:
                connection.execute(
                    "INSERT OR IGNORE INTO therapist_therapies (clinic_id, membership_id, therapy_id) VALUES (?, ?, ?)",
                    (clinic_id, membership_id, therapy_id),
                )

    protocol_ids: dict[str, str] = {}
    for row in sheets.get("PROTOCOLO", []):
        try:
            source_id = value(row, "id")
            therapy_id = reference(therapy_ids, row.get("terapia_id", ""), "terapia_id")
            therapist_id = reference(
                therapist_memberships, row.get("terapeuta_id", ""), "terapeuta_id", required=False
            )
            protocol_id = target_id(source_name, "PROTOCOLO", row)
            insert(
                connection,
                "PROTOCOLO",
                ("id", "clinic_id", "terapia_id", "therapist_membership_id", "nome",
                 "descricao", "objetivo", "ativo", "created_at", "updated_at", "terapeuta_id",
                 "diagnostico_id"),
                (
                    protocol_id, clinic_id, therapy_id, therapist_id, value(row, "nome"),
                    row.get("descricao", "").strip() or None,
                    row.get("objetivo", "").strip() or None,
                    parse_bool(row.get("ativo", "1")), now, now,
                    stable_id(source_name, "TERAPEUTA", row.get("terapeuta_id", "").strip()) if therapist_id else None,
                    None,
                ),
            )
            protocol_ids[source_id] = protocol_id
            counts["PROTOCOLO"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "PROTOCOLO", row, issue)

    step_ids: dict[str, str] = {}
    for index, row in enumerate(sheets.get("PROTOCOLO_ETAPA", []), start=1):
        try:
            source_id = value(row, "id")
            protocol_id = reference(protocol_ids, row.get("protocolo_id", ""), "protocolo_id")
            starts_at = parse_date(row.get("dt_inicio", ""), required=False)
            ends_at = parse_date(row.get("dt_fim", ""), required=False)
            if starts_at and ends_at and starts_at > ends_at:
                raise ImportIssue("INVALID_DATE_RANGE", "dt_inicio", "dt_fim")
            step_id = target_id(source_name, "PROTOCOLO_ETAPA", row)
            insert(
                connection,
                "PROTOCOLO_ETAPA",
                ("id", "clinic_id", "protocolo_id", "sequencia", "dt_inicio", "dt_fim", "descricao", "obs", "created_at"),
                (
                    step_id, clinic_id, protocol_id, parse_integer(row.get("sequencia", str(index))),
                    starts_at, ends_at, value(row, "descricao"),
                    row.get("obs", "").strip() or None, now,
                ),
            )
            step_ids[source_id] = step_id
            counts["PROTOCOLO_ETAPA"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "PROTOCOLO_ETAPA", row, issue)

    chart_ids: dict[str, str] = {}
    charts_by_patient: dict[str, str] = {}

    def ensure_chart(patient_source_id: str, opened_at: str | None = None) -> str:
        patient_membership = patient_memberships.get(patient_source_id)
        if not patient_membership:
            raise ImportIssue("UNRESOLVED_REFERENCE", "paciente_id")
        existing = charts_by_patient.get(patient_source_id)
        if existing:
            return existing
        chart_id = stable_id(source_name, "PRONTUARIO_AUTO", patient_source_id)
        timestamp = opened_at or now
        insert(
            connection,
            "PRONTUARIO",
            ("id", "clinic_id", "patient_membership_id", "data_abertura", "status", "created_at", "updated_at", "paciente_id"),
            (chart_id, clinic_id, patient_membership, timestamp, "ACTIVE", now, now,
             stable_id(source_name, "PACIENTE", patient_source_id)),
        )
        charts_by_patient[patient_source_id] = chart_id
        return chart_id

    for row in sheets.get("PRONTUARIO", []):
        try:
            source_id = value(row, "id")
            patient_source_id = value(row, "paciente_id")
            patient_membership = reference(patient_memberships, patient_source_id, "paciente_id")
            opened_at = parse_date(row.get("data_abertura", ""))
            status = parse_status(
                row.get("status", ""),
                status_map(("Ativo", "ACTIVE"), ("Encerrado", "CLOSED"), ("Arquivado", "ARCHIVED")),
                "ACTIVE",
            )
            chart_id = target_id(source_name, "PRONTUARIO", row)
            insert(
                connection,
                "PRONTUARIO",
                ("id", "clinic_id", "patient_membership_id", "data_abertura", "status", "created_at", "updated_at", "paciente_id"),
                (chart_id, clinic_id, patient_membership, opened_at, status, now, now,
                 stable_id(source_name, "PACIENTE", patient_source_id)),
            )
            charts_by_patient[patient_source_id] = chart_id
            chart_ids[source_id] = chart_id
            counts["PRONTUARIO"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "PRONTUARIO", row, issue)

    diagnosis_ids: dict[str, str] = {}
    diagnosis_therapists: dict[str, str] = {}
    for row in sheets.get("DIAGNOSTICO", []):
        try:
            source_id = value(row, "id")
            patient_source_id = value(row, "paciente_id")
            patient_membership = reference(patient_memberships, patient_source_id, "paciente_id")
            therapist_membership = reference(
                therapist_memberships, row.get("terapeuta_id", ""), "terapeuta_id"
            )
            chart_id = ensure_chart(patient_source_id)
            diagnosed_at = parse_date(row.get("dt_diagnostico", ""))
            diagnosis_id = target_id(source_name, "DIAGNOSTICO", row)
            insert(
                connection,
                "DIAGNOSTICO",
                ("id", "clinic_id", "patient_chart_id", "patient_membership_id",
                 "therapist_membership_id", "encounter_id", "descricao", "dt_diagnostico", "created_at",
                 "paciente_id", "terapeuta_id"),
                (
                    diagnosis_id, clinic_id, chart_id, patient_membership,
                    therapist_membership, None, value(row, "descricao"), diagnosed_at, now,
                    stable_id(source_name, "PACIENTE", patient_source_id),
                    stable_id(source_name, "TERAPEUTA", row.get("terapeuta_id", "").strip()),
                ),
            )
            diagnosis_ids[source_id] = diagnosis_id
            diagnosis_therapists[source_id] = therapist_membership
            counts["DIAGNOSTICO"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "DIAGNOSTICO", row, issue)

    for row in sheets.get("PROTOCOLO", []):
        source_diagnosis_id = row.get("diagnostico_id", "").strip()
        source_id = row.get("id", "").strip()
        protocol_id = protocol_ids.get(source_id)
        if not source_diagnosis_id or not protocol_id:
            continue
        try:
            diagnosis_id = reference(diagnosis_ids, source_diagnosis_id, "diagnostico_id")
            connection.execute(
                "UPDATE PROTOCOLO SET diagnostico_id = ? WHERE id = ?",
                (diagnosis_id, protocol_id),
            )
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "PROTOCOLO", row, issue)

    diagnosis_protocol_ids: dict[str, str] = {}
    for row in sheets.get("DIAGNOSTICO_PROTOCOLO", []):
        try:
            source_id = value(row, "id")
            diagnosis_id = reference(diagnosis_ids, row.get("diagnostico_id", ""), "diagnostico_id")
            step_id = reference(step_ids, row.get("protocolo_etapa_id", ""), "protocolo_etapa_id")
            started_at = parse_date(row.get("dt_diagnostico", ""))
            status = parse_status(
                row.get("status", ""),
                status_map(
                    ("Planejado", "PLANNED"), ("Em andamento", "IN_PROGRESS"),
                    ("Concluído", "COMPLETED"), ("Concluido", "COMPLETED"),
                    ("Cancelado", "CANCELLED"),
                ),
                "IN_PROGRESS",
            )
            target = target_id(source_name, "DIAGNOSTICO_PROTOCOLO", row)
            insert(
                connection,
                "DIAGNOSTICO_PROTOCOLO",
                ("id", "clinic_id", "diagnostico_id", "protocolo_etapa_id", "dt_diagnostico", "status", "created_at"),
                (target, clinic_id, diagnosis_id, step_id, started_at, status, now),
            )
            diagnosis_protocol_ids[source_id] = target
            counts["DIAGNOSTICO_PROTOCOLO"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "DIAGNOSTICO_PROTOCOLO", row, issue)

    evolution_ids: dict[str, str] = {}
    for row in sheets.get("EVOLUCAO", []):
        try:
            source_id = value(row, "id")
            source_protocol_id = value(row, "diagnostico_protocolo_id")
            diagnosis_protocol_id = reference(
                diagnosis_protocol_ids, source_protocol_id, "diagnostico_protocolo_id"
            )
            source_diagnosis_id = next(
                (
                    item.get("diagnostico_id", "")
                    for item in sheets.get("DIAGNOSTICO_PROTOCOLO", [])
                    if item.get("id") == source_protocol_id
                ),
                "",
            )
            author_id = reference(diagnosis_therapists, source_diagnosis_id, "author_membership_id")
            evolved_at = parse_date(row.get("dt_evolucao", ""))
            status = parse_status(
                row.get("status", ""),
                status_map(
                    ("Em andamento", "IN_PROGRESS"), ("Concluído", "COMPLETED"),
                    ("Concluido", "COMPLETED"), ("Cancelado", "CANCELLED"),
                ),
                "IN_PROGRESS",
            )
            target = target_id(source_name, "EVOLUCAO", row)
            insert(
                connection,
                "EVOLUCAO",
                ("id", "clinic_id", "diagnostico_protocolo_id", "author_membership_id",
                 "descricao", "dt_evolucao", "status", "created_at"),
                (target, clinic_id, diagnosis_protocol_id, author_id, value(row, "descricao"), evolved_at, status, now),
            )
            evolution_ids[source_id] = target
            counts["EVOLUCAO"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "EVOLUCAO", row, issue)

    appointment_ids: dict[str, str] = {}
    appointment_mapping = status_map(
        ("Agendado", "CONFIRMED"), ("Confirmado", "CONFIRMED"),
        ("Realizado", "COMPLETED"), ("Concluído", "COMPLETED"),
        ("Concluido", "COMPLETED"), ("Cancelado", "CANCELLED"),
        ("Faltou", "NO_SHOW"), ("Ausente", "NO_SHOW"),
    )
    for row in sheets.get("AGENDA", []):
        try:
            source_id = value(row, "id")
            patient_source_id = value(row, "paciente_id")
            patient_membership = reference(patient_memberships, patient_source_id, "paciente_id")
            therapist_membership = reference(
                therapist_memberships, row.get("terapeuta_id", ""), "terapeuta_id"
            )
            therapy_id = reference(therapy_ids, row.get("terapia_id", ""), "terapia_id")
            starts_at = parse_date(row.get("dt_inicio", ""))
            ends_at = parse_date(row.get("dt_fim", ""))
            if starts_at == ends_at:
                raise ImportIssue("MISSING_TIME_OF_DAY", "dt_inicio", "dt_fim")
            if starts_at > ends_at:
                raise ImportIssue("INVALID_DATE_RANGE", "dt_inicio", "dt_fim")
            status = parse_status(row.get("status", ""), appointment_mapping, "CONFIRMED")
            appointment_id = target_id(source_name, "AGENDA", row)
            insert(
                connection,
                "AGENDA",
                ("id", "clinic_id", "patient_membership_id", "therapist_membership_id",
                 "terapia_id", "dt_inicio", "dt_fim", "status", "cancellation_reason",
                 "created_at", "updated_at", "patient_chart_id", "paciente_id", "terapeuta_id"),
                (
                    appointment_id, clinic_id, patient_membership, therapist_membership,
                    therapy_id, starts_at, ends_at, status, None, now, now,
                    charts_by_patient.get(patient_source_id),
                    stable_id(source_name, "PACIENTE", patient_source_id),
                    stable_id(source_name, "TERAPEUTA", row.get("terapeuta_id", "").strip()),
                ),
            )
            appointment_ids[source_id] = appointment_id
            counts["AGENDA"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "AGENDA", row, issue)

    encounter_ids: dict[str, str] = {}
    encounter_therapists: dict[str, str] = {}
    for row in sheets.get("ATENDIMENTO", []):
        try:
            source_id = value(row, "id")
            patient_source_id = value(row, "paciente_id")
            patient_membership = reference(patient_memberships, patient_source_id, "paciente_id")
            therapist_membership = reference(
                therapist_memberships, row.get("terapeuta_id", ""), "terapeuta_id"
            )
            therapy_id = reference(therapy_ids, row.get("terapia_id", ""), "terapia_id")
            chart_id = reference(chart_ids, row.get("prontuario_id", ""), "prontuario_id")
            attended_at = parse_date(row.get("dt_atend", ""))
            status = parse_status(
                row.get("status", ""),
                status_map(("Ativo", "ACTIVE"), ("Realizado", "COMPLETED"), ("Cancelado", "CANCELLED")),
                "ACTIVE",
            )
            encounter_id = target_id(source_name, "ATENDIMENTO", row)
            insert(
                connection,
                "ATENDIMENTO",
                ("id", "clinic_id", "prontuario_id", "patient_membership_id",
                 "therapist_membership_id", "terapia_id", "agenda_id", "dt_atend",
                 "status", "notes", "created_at", "updated_at", "paciente_id", "terapeuta_id"),
                (
                    encounter_id, clinic_id, chart_id, patient_membership,
                    therapist_membership, therapy_id, None, attended_at, status,
                    None, now, now,
                    stable_id(source_name, "PACIENTE", patient_source_id),
                    stable_id(source_name, "TERAPEUTA", row.get("terapeuta_id", "").strip()),
                ),
            )
            encounter_ids[source_id] = encounter_id
            encounter_therapists[source_id] = therapist_membership
            counts["ATENDIMENTO"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "ATENDIMENTO", row, issue)

    anamnesis_ids: dict[str, str] = {}
    for row in sheets.get("ANAMNESE", []):
        try:
            source_id = value(row, "id")
            encounter_id = reference(encounter_ids, row.get("atendimento_id", ""), "atendimento_id")
            source_encounter_id = value(row, "atendimento_id")
            creator_id = reference(encounter_therapists, source_encounter_id, "created_by_membership_id")
            registered_at = parse_date(row.get("dt_registro", ""))
            anamnesis_id = target_id(source_name, "ANAMNESE", row)
            insert(
                connection,
                "ANAMNESE",
                ("id", "clinic_id", "atendimento_id", "tipo", "descricao",
                 "dt_registro", "created_by_membership_id"),
                (
                    anamnesis_id, clinic_id, encounter_id,
                    value(row, "tipo"), row.get("descricao", "").strip() or None,
                    registered_at, creator_id,
                ),
            )
            anamnesis_ids[source_id] = anamnesis_id
            counts["ANAMNESE"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "ANAMNESE", row, issue)

    question_ids: dict[str, str] = {}
    for index, row in enumerate(sheets.get("PERGUNTAS", []), start=1):
        try:
            source_id = value(row, "id")
            question_id = target_id(source_name, "PERGUNTAS", row)
            insert(
                connection,
                "PERGUNTAS",
                ("id", "clinic_id", "specialty_id", "descricao", "ativo", "display_order"),
                (question_id, clinic_id, None, value(row, "descricao"), 1, index),
            )
            question_ids[source_id] = question_id
            counts["PERGUNTAS"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "PERGUNTAS", row, issue)

    for row in sheets.get("ANAMNESE_PERGUNTAS", []):
        try:
            source_id = value(row, "id")
            source_anamnesis = value(row, "anamnese_id")
            anamnesis_id = reference(anamnesis_ids, source_anamnesis, "anamnese_id")
            source_question = value(row, "pergunta_id")
            question_id = reference(question_ids, source_question, "pergunta_id")
            insert(
                connection,
                "ANAMNESE_PERGUNTAS",
                ("id", "clinic_id", "anamnese_id", "pergunta_id", "Resposta", "created_at"),
                (
                    target_id(source_name, "ANAMNESE_PERGUNTAS", row),
                    clinic_id,
                    anamnesis_id,
                    question_id,
                    row.get("resposta", "").strip() or None,
                    now,
                ),
            )
            counts["ANAMNESE_PERGUNTAS"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "ANAMNESE_PERGUNTAS", row, issue)

    for row in sheets.get("ANEXO", []):
        issue = ImportIssue("FILE_CONTENT_NOT_IN_WORKBOOK", "arquivo")
        add_rejection(connection, batch_id, source_name, counts, "ANEXO", row, issue)

    assessment_ids: dict[str, str] = {}
    for row in sheets.get("BIOWELL_AVALIACAO", []):
        try:
            source_id = value(row, "id")
            patient_source_id = value(row, "paciente_id")
            patient_membership = reference(patient_memberships, patient_source_id, "paciente_id")
            chart_id = ensure_chart(patient_source_id)
            encounter_id = reference(
                encounter_ids, row.get("atendimento_id", ""), "atendimento_id", required=False
            )
            assessor = (
                encounter_therapists.get(row.get("atendimento_id", "").strip())
                or admin_membership_id
            )
            assessed_at = parse_date(row.get("dt_avaliacao", ""))
            assessment_id = target_id(source_name, "BIOWELL_AVALIACAO", row)
            insert(
                connection,
                "BIOWELL_AVALIACAO",
                ("id", "clinic_id", "patient_chart_id", "patient_membership_id",
                 "atendimento_id", "assessed_by_membership_id", "dt_avaliacao",
                 "indice_energetico", "indice_estresse", "source_reference", "paciente_id"),
                (
                    assessment_id, clinic_id, chart_id, patient_membership,
                    encounter_id, assessor, assessed_at,
                    parse_number(row.get("indice_energetico", "")),
                    parse_number(row.get("indice_estresse", "")),
                    None,
                    stable_id(source_name, "PACIENTE", patient_source_id),
                ),
            )
            assessment_ids[source_id] = assessment_id
            counts["BIOWELL_AVALIACAO"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "BIOWELL_AVALIACAO", row, issue)

    for row in sheets.get("BIOWELL_CHAKRA", []):
        try:
            source_id = value(row, "id")
            assessment_id = reference(assessment_ids, row.get("avaliacao_id", ""), "avaliacao_id")
            insert(
                connection,
                "BIOWELL_CHAKRA",
                ("id", "clinic_id", "avaliacao_id", "chakra", "valor", "equilibrio"),
                (
                    target_id(source_name, "BIOWELL_CHAKRA", row), clinic_id,
                    assessment_id, value(row, "chakra"),
                    parse_number(row.get("valor", "")),
                    row.get("equilibrio", "").strip() or None,
                ),
            )
            counts["BIOWELL_CHAKRA"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "BIOWELL_CHAKRA", row, issue)

    for sheet_name in ("ANALISE_LINGUA", "RELATORIO", "PAGAMENTO", "PACOTE"):
        for row in sheets.get(sheet_name, []):
            if sheet_name in {"ANALISE_LINGUA", "RELATORIO"}:
                add_rejection(
                    connection, batch_id, source_name, counts, sheet_name, row,
                    ImportIssue("FILE_CONTENT_NOT_IN_WORKBOOK", "imagem" if sheet_name == "ANALISE_LINGUA" else "arquivo_pdf"),
                )
                continue
            try:
                source_id = value(row, "id")
                patient_source_id = value(row, "paciente_id")
                patient_membership = reference(patient_memberships, patient_source_id, "paciente_id")
                if sheet_name == "PAGAMENTO":
                    appointment_id = reference(
                        appointment_ids, row.get("agenda_id", ""), "agenda_id", required=False
                    )
                    status = parse_status(
                        row.get("status", ""),
                        status_map(
                            ("Pendente", "PENDING"), ("Ativo", "PENDING"),
                            ("Pago", "PAID"), ("Reembolsado", "REFUNDED"),
                            ("Cancelado", "CANCELLED"),
                        ),
                        "PENDING",
                    )
                    paid_at = parse_date(row.get("dt_pagamento", ""), required=False)
                    insert(
                        connection,
                        "PAGAMENTO",
                        ("id", "clinic_id", "patient_membership_id", "agenda_id",
                         "package_id", "valor", "forma_pagamento", "status", "paid_at", "created_at", "updated_at", "paciente_id"),
                        (
                            target_id(source_name, "PAGAMENTO", row), clinic_id,
                            patient_membership, appointment_id, None,
                            parse_number(row.get("valor", ""), required=True),
                            value(row, "forma_pagamento"), status, paid_at, now, now,
                            stable_id(source_name, "PACIENTE", patient_source_id),
                        ),
                    )
                else:
                    quantity = parse_integer(row.get("quantidade_sessoes", ""))
                    valid_until = parse_date(row.get("validade", ""), required=False)
                    insert(
                        connection,
                        "PACOTE",
                        ("id", "clinic_id", "patient_membership_id", "nome",
                         "quantidade_sessoes", "valor", "validade", "status", "created_at", "updated_at", "paciente_id"),
                        (
                            target_id(source_name, "PACOTE", row), clinic_id,
                            patient_membership, value(row, "nome"), quantity,
                            parse_number(row.get("valor", ""), required=True),
                            valid_until, "ACTIVE", now, now,
                            stable_id(source_name, "PACIENTE", patient_source_id),
                        ),
                    )
                counts[sheet_name]["imported"] += 1
            except ImportIssue as issue:
                add_rejection(connection, batch_id, source_name, counts, sheet_name, row, issue)

    for row in sheets.get("AUDITORIA", []):
        try:
            source_id = value(row, "id")
            actor_id = reference(
                user_ids, row.get("usuario_id", ""), "usuario_id", required=False
            )
            created_at = parse_date(row.get("dt_hora", ""))
            insert(
                connection,
                "AUDITORIA",
                ("id", "clinic_id", "usuario_id", "acao", "entidade",
                 "registro_id", "metadata", "dt_hora", "ip"),
                (
                    target_id(source_name, "AUDITORIA", row), clinic_id, actor_id,
                    value(row, "acao"), value(row, "entidade"),
                    row.get("registro_id", "").strip() or None,
                    None, created_at, row.get("ip", "").strip() or None,
                ),
            )
            counts["AUDITORIA"]["imported"] += 1
        except ImportIssue as issue:
            add_rejection(connection, batch_id, source_name, counts, "AUDITORIA", row, issue)

    for sheet_name, rows in sheets.items():
        if sheet_name not in counts:
            counts[sheet_name] = Counter()
        if sheet_name not in {
            "CLINICA", "PERFIL", "USUARIO", "PACIENTE", "TERAPEUTA",
            "ESPECIALIDADE", "TERAPEUTA_ESPECIALIDADE", "TERAPIA", "PROTOCOLO",
            "PROTOCOLO_ETAPA", "PRONTUARIO", "DIAGNOSTICO", "DIAGNOSTICO_PROTOCOLO",
            "EVOLUCAO", "AGENDA", "ATENDIMENTO", "ANAMNESE", "PERGUNTAS",
            "ANAMNESE_PERGUNTAS",
            "ANEXO", "BIOWELL_AVALIACAO", "BIOWELL_CHAKRA", "ANALISE_LINGUA",
            "RELATORIO", "PAGAMENTO", "PACOTE", "AUDITORIA",
        }:
            for row in rows:
                add_rejection(
                    connection, batch_id, source_name, counts, sheet_name, row,
                    ImportIssue("NO_TARGET_TABLE"),
                )

    totals: Counter[str] = Counter()
    for item in counts.values():
        totals.update({key: value for key, value in item.items() if not key.startswith("reason_")})
    summary = {
        "mode": "replacement",
        "source": source_name,
        "source_sha256": source_hash,
        "source_rows": sum(len(rows) for rows in sheets.values()),
        "inserted": sum(value for key, value in totals.items() if key.startswith("imported")),
        "staged": totals["staged"],
        "profiles_reused": counts.get("PERFIL", Counter())["reused"],
        "users_imported_active": counts.get("USUARIO", Counter())["imported_active"],
        "admin_preserved": 1,
        "tables": {sheet: dict(item) for sheet, item in counts.items()},
    }
    return {"clinic_id": clinic_id, "summary": summary, "credentials": credentials}


def apply_pending_migration(connection: sqlite3.Connection, migration_name: str) -> None:
    applied = {
        row["version"] for row in connection.execute("SELECT version FROM schema_migrations")
    }
    if migration_name in applied:
        return
    path = ROOT / "apps" / "api" / "src" / "db" / "migrations" / migration_name
    statements = []
    current = ""
    for line in path.read_text(encoding="utf-8").splitlines():
        current += line + "\n"
        if sqlite3.complete_statement(current):
            statements.append(current.strip())
            current = ""
    if current.strip():
        raise RuntimeError(f"Incomplete SQL migration: {migration_name}")
    connection.execute("BEGIN IMMEDIATE")
    try:
        for statement in statements:
            connection.execute(statement)
        connection.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            (migration_name, utc_now()),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def apply_pending_migrations(connection: sqlite3.Connection) -> None:
    migrations_directory = ROOT / "apps" / "api" / "src" / "db" / "migrations"
    for migration_path in sorted(migrations_directory.glob("*.sql")):
        apply_pending_migration(connection, migration_path.name)


def backup_database(database_path: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = database_path.with_name(
        f"{database_path.stem}.before-replacement-{timestamp}{database_path.suffix}"
    )
    counter = 1
    while backup_path.exists():
        backup_path = database_path.with_name(
            f"{database_path.stem}.before-replacement-{timestamp}-{counter}{database_path.suffix}"
        )
        counter += 1
    source = sqlite3.connect(database_path)
    destination = sqlite3.connect(backup_path)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    return backup_path


def run_replace(
    database_path: Path,
    workbook_path: Path,
    force: bool = False,
) -> dict[str, Any]:
    source_name = workbook_path.name
    source_hash = hashlib.sha256(workbook_path.read_bytes()).hexdigest()
    sheets = read_workbook(workbook_path)
    if "senha" in {
        key.strip().casefold()
        for rows in sheets.values()
        for row in rows
        for key in row
    }:
        raise RuntimeError("Password columns must not be loaded.")

    connection = sqlite3.connect(database_path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    try:
        applied = {
            row["version"] for row in connection.execute("SELECT version FROM schema_migrations")
        }
        if "0001_workbook_clinical_domain.sql" not in applied:
            raise RuntimeError("Apply the QIConect base migration before replacement.")

        backup_path = backup_database(database_path)
        try:
            apply_pending_migrations(connection)

            existing_batch = connection.execute(
                """
                SELECT summary_json FROM workbook_import_batches
                WHERE source_name = ? AND source_sha256 = ?
                """,
                (source_name, source_hash),
            ).fetchone()
            if existing_batch:
                previous = json.loads(existing_batch["summary_json"])
                if previous.get("mode") == "replacement" and "users_imported_active" in previous and not force:
                    previous["mode"] = "already replaced; no database writes"
                    return {"summary": previous, "credentials": []}

            admins = connection.execute(
                """
                SELECT DISTINCT u.id
                FROM USUARIO u JOIN memberships m ON m.user_id = u.id
                WHERE m.role = 'CLINIC_ADMIN' AND u.ativo = 1
                """
            ).fetchall()
            if len(admins) != 1:
                raise RuntimeError("Exactly one active clinic administrator must be preserved.")
            admin_user_id = admins[0]["id"]

            connection.execute("BEGIN IMMEDIATE")
            batch_id = str(uuid.uuid4())
            ensure_patient_contact_columns(connection)
            delete_existing_data(connection, admin_user_id)
            insert(
                connection,
                "workbook_import_batches",
                ("id", "source_name", "source_sha256", "clinic_id", "imported_at",
                 "imported_rows", "reused_rows", "skipped_rows", "summary_json"),
                (batch_id, source_name, source_hash, None, utc_now(), 0, 0, 0, "{}"),
            )
            result = import_workbook(
                connection, batch_id, source_name, source_hash, sheets, admin_user_id
            )
            clinic_id = result["clinic_id"]
            summary = result["summary"]
            summary["backup"] = str(backup_path)
            summary["batch"] = batch_id
            inserted = summary["inserted"]
            reused = summary["profiles_reused"]
            staged = summary["staged"]
            connection.execute(
                """
                UPDATE workbook_import_batches
                SET clinic_id = ?, imported_at = ?, imported_rows = ?,
                    reused_rows = ?, skipped_rows = ?, summary_json = ?
                WHERE id = ?
                """,
                (
                    clinic_id, utc_now(), inserted, reused, staged,
                    json.dumps(summary, ensure_ascii=False, sort_keys=True), batch_id,
                ),
            )
            violations = connection.execute("PRAGMA foreign_key_check").fetchall()
            if violations:
                raise RuntimeError("Foreign-key validation failed; replacement was rolled back.")
            connection.commit()
            return {"summary": summary, "credentials": result["credentials"]}
        except Exception:
            connection.rollback()
            print(f"Replacement rolled back; backup retained at {backup_path}", file=sys.stderr)
            raise
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Path to the .xlsx workbook")
    parser.add_argument("--database", help="SQLite database path (defaults to DATABASE_PATH or data/qiconect.sqlite)")
    parser.add_argument("--apply", action="store_true", help="Replace database records; preserves one active clinic admin")
    parser.add_argument("--force", action="store_true", help="Repeat replacement even if this workbook was already imported")
    args = parser.parse_args()
    workbook_path = args.input.resolve()
    if not workbook_path.is_file():
        parser.error(f"Workbook not found: {workbook_path}")
    if not args.apply:
        parser.error("Replacement is destructive. Re-run with --apply after reviewing the workbook.")

    try:
        database_path = safe_database_path(args.database)
        if not database_path.is_file():
            raise FileNotFoundError(f"Database not found: {database_path}")
        report = run_replace(database_path, workbook_path, force=args.force)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except (OSError, sqlite3.Error, ValueError, RuntimeError, ImportIssue) as error:
        print(f"Replacement failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
